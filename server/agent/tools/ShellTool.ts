import { spawn } from 'child_process';
import path from 'path';
import { errorMessage } from '../../../shared/errors';
import { splitShellSegments, tokenize } from '../../../shared/guardrail';
import type { GuardrailAction } from '../../domain/security/types';
import type { DefaultSessionManager } from '../../application/session/DefaultSessionManager';
import type { CommandEngine } from '../../application/command/CommandEngine';
import { isPowerShellExecutable } from '../../infrastructure/terminal/powershellOsc133Hook';
import { detectDefaultShell } from '../../localPtyManager';
import type { SshManager } from '../../sshManager';
import {
  isPlainObject,
  type Tool,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSchema
} from './Tool';

export interface ShellToolInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellToolOutput {
  command: string;
  cwd?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_BYTES = 64_000;
const PWD_SENTINEL_REGEX = /__MONO_PWD__:([^\r\n]*):__END_PWD__\r?\n?$/;

/**
 * Resolve explicit `cd` / `Set-Location` / `sl` / `chdir` directory transitions
 * across command segments so multi-step Agent plans preserve CWD (P1-4).
 */
export function resolveCommandCwdChange(
  command: string,
  currentCwd?: string
): string | undefined {
  let workingCwd = currentCwd;
  for (const seg of splitShellSegments(command)) {
    const tokens = tokenize(seg);
    if (tokens.length === 0) continue;
    const cmd = tokens[0].toLowerCase();
    if (cmd !== 'cd' && cmd !== 'chdir' && cmd !== 'set-location' && cmd !== 'sl') {
      continue;
    }
    // Skip flags like `cd -P /path` or `Set-Location -Path /path`
    let target: string | undefined;
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.toLowerCase() === '-path' || tok.toLowerCase() === '-literalpath') {
        target = tokens[i + 1];
        break;
      }
      if (!tok.startsWith('-')) {
        target = tok;
        break;
      }
    }
    if (!target) continue;

    const isWinStyle =
      /^[a-zA-Z]:/.test(target) ||
      target.includes('\\') ||
      (workingCwd ? /^[a-zA-Z]:/.test(workingCwd) || workingCwd.includes('\\') : false);

    if (isWinStyle) {
      if (/^[a-zA-Z]:[\\/]/.test(target)) {
        workingCwd = path.win32.normalize(target);
      } else if (workingCwd && workingCwd !== '~') {
        workingCwd = path.win32.resolve(workingCwd, target);
      } else {
        workingCwd = target;
      }
    } else {
      if (target.startsWith('/')) {
        workingCwd = path.posix.normalize(target);
      } else if (workingCwd && workingCwd.startsWith('/')) {
        workingCwd = path.posix.resolve(workingCwd, target);
      } else {
        workingCwd = target;
      }
    }
  }
  return workingCwd;
}

export const shellToolSchema: ToolSchema<ShellToolInput> = {
  jsonSchema: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string', description: 'Non-interactive shell command to execute' },
      cwd: { type: 'string', description: 'Optional working directory override' },
      timeoutMs: {
        type: 'number',
        description: 'Execution timeout in milliseconds (default 15000, max 120000)'
      }
    }
  },
  validate(raw: unknown) {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'ShellTool 参数必须是对象' };
    }
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      return { ok: false, error: 'ShellTool.command 必须是非空字符串' };
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== 'string') {
      return { ok: false, error: 'ShellTool.cwd 必须是字符串' };
    }
    if (
      raw.timeoutMs !== undefined &&
      (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0)
    ) {
      return { ok: false, error: 'ShellTool.timeoutMs 必须是正数' };
    }
    return {
      ok: true,
      data: {
        command: raw.command.trim(),
        cwd: raw.cwd,
        timeoutMs:
          raw.timeoutMs !== undefined
            ? Math.min(MAX_TIMEOUT_MS, Math.max(50, Math.floor(raw.timeoutMs)))
            : undefined
      }
    };
  }
};

export interface ShellToolDeps {
  sessionManager: DefaultSessionManager;
  sshManager?: Pick<SshManager, 'execCommand'>;
  commandEngine?: CommandEngine;
}

/**
 * Isolated non-interactive ShellTool (Phase 8 / P1-6 / P0-B).
 * Never writes into the user's interactive PTY stream (`LocalPtyManager` / `SshManager.writeToShell`).
 */
export class ShellTool implements Tool<ShellToolInput, ShellToolOutput> {
  public readonly name = 'shell';
  public readonly description =
    'Execute a non-interactive shell command in an isolated background channel with timeout protection.';
  public readonly schema = shellToolSchema;

  constructor(private readonly deps: ShellToolDeps) {}

  public toGuardrailAction(input: ShellToolInput, ctx: ToolExecutionContext): GuardrailAction {
    return {
      kind: 'shell:exec',
      sessionId: ctx.sessionId,
      command: input.command,
      cwd: input.cwd || ctx.cwd
    };
  }

  public async execute(
    input: ShellToolInput,
    ctx: ToolExecutionContext
  ): Promise<ToolResult<ShellToolOutput>> {
    const startMs = Date.now();
    const session = this.deps.sessionManager.get(ctx.sessionId);
    const sessionType = session?.type ?? 'local';
    const cwd = input.cwd || ctx.cwd || session?.terminal.cwd;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const cmdRecord = this.deps.commandEngine?.startCommand({
      sessionId: ctx.sessionId,
      command: input.command,
      cwd,
      startedAt: startMs
    });

    try {
      let result: ShellToolOutput;
      if (sessionType === 'ssh') {
        if (!this.deps.sshManager) {
          throw new Error('SSH 执行器未配置');
        }
        const execRes = await this.deps.sshManager.execCommand(ctx.sessionId, input.command, {
          cwd,
          timeoutMs
        });
        const nextCwd =
          execRes.exitCode === 0 && !execRes.timedOut
            ? resolveCommandCwdChange(input.command, cwd)
            : cwd;
        result = {
          command: input.command,
          cwd: nextCwd,
          exitCode: execRes.exitCode,
          stdout: execRes.stdout,
          stderr: execRes.stderr,
          timedOut: Boolean(execRes.timedOut)
        };
      } else if (sessionType === 'mock') {
        result = await this.executeMockCommand(ctx.sessionId, input.command, cwd);
      } else {
        result = await this.executeLocalCommand(input.command, cwd, timeoutMs, ctx.abortSignal);
      }

      if (result.exitCode === 0 && !result.timedOut && result.cwd) {
        ctx.onCwdChange?.(result.cwd);
        this.deps.sessionManager.updateCwd(ctx.sessionId, result.cwd);
      }

      const endedAt = Date.now();
      this.deps.commandEngine?.finishCommand({
        sessionId: ctx.sessionId,
        commandId: cmdRecord?.id,
        command: input.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        cwd: result.cwd || cwd,
        endedAt
      });

      const success = result.exitCode === 0 && !result.timedOut;
      return {
        success,
        output: result,
        error: !success
          ? result.timedOut
            ? `命令执行超时 (${timeoutMs}ms)`
            : result.stderr || result.stdout || `Exit code ${result.exitCode}`
          : undefined,
        durationMs: Math.max(0, endedAt - startMs)
      };
    } catch (err) {
      const endedAt = Date.now();
      const msg = errorMessage(err);
      this.deps.commandEngine?.finishCommand({
        sessionId: ctx.sessionId,
        commandId: cmdRecord?.id,
        command: input.command,
        exitCode: 1,
        stderr: msg,
        cwd,
        endedAt
      });
      return {
        success: false,
        error: msg,
        durationMs: Math.max(0, endedAt - startMs)
      };
    }
  }

  private executeLocalCommand(
    command: string,
    cwd: string | undefined,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<ShellToolOutput> {
    return new Promise(resolve => {
      const isWin = process.platform === 'win32';
      let shellBin = '/bin/sh';
      let shellArgs: string[];

      if (isWin) {
        try {
          const detected = detectDefaultShell(false);
          shellBin = detected.command;
        } catch {
          shellBin = 'powershell.exe';
        }
        if (isPowerShellExecutable(shellBin)) {
          const wrappedPs = `${command}; $__mono_ec = if ($? -eq $false) { if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 } } else { 0 }; [Console]::Out.Write("__MONO_PWD__:" + $PWD.Path + ":__END_PWD__"); exit $__mono_ec`;
          shellArgs = ['-NoProfile', '-NonInteractive', '-Command', wrappedPs];
        } else {
          shellArgs = ['/d', '/s', '/c', command];
        }
      } else {
        const wrappedSh = `${command}\n__mono_ec=$?\nprintf "__MONO_PWD__:%s:__END_PWD__" "$PWD"\nexit $__mono_ec`;
        shellArgs = ['-c', wrappedSh];
      }

      const validCwd = cwd && cwd !== '~' ? cwd : undefined;

      const child = spawn(shellBin, shellArgs, {
        cwd: validCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let tailBuffer = '';
      let timedOut = false;
      let settled = false;

      const extractFinalOutputAndCwd = (): { cleanStdout: string; detectedCwd?: string } => {
        const match = stdout.match(PWD_SENTINEL_REGEX) || tailBuffer.match(PWD_SENTINEL_REGEX);
        const cleanStdout = stdout.replace(PWD_SENTINEL_REGEX, '');
        const detectedCwd =
          match?.[1]?.trim() || resolveCommandCwdChange(command, cwd);
        return { cleanStdout, detectedCwd };
      };

      const killChild = () => {
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
              windowsHide: true,
              stdio: 'ignore'
            }).unref?.();
          }
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, 100).unref?.();
        } catch {
          // ignore
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killChild();
        settled = true;
        const { cleanStdout } = extractFinalOutputAndCwd();
        resolve({
          command,
          cwd,
          exitCode: 124,
          stdout: cleanStdout,
          stderr: stderr ? `${stderr}\n[Timeout after ${timeoutMs}ms]` : `[Timeout after ${timeoutMs}ms]`,
          timedOut: true
        });
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        if (settled) return;
        timedOut = true;
        killChild();
        settled = true;
        clearTimeout(timer);
        const { cleanStdout } = extractFinalOutputAndCwd();
        resolve({
          command,
          cwd,
          exitCode: 130,
          stdout: cleanStdout,
          stderr: stderr ? `${stderr}\n[Aborted]` : '[Aborted]',
          timedOut: true
        });
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        tailBuffer = (tailBuffer + text).slice(-512);
        if (stdoutBytes >= MAX_CAPTURE_BYTES) return;
        const remaining = MAX_CAPTURE_BYTES - stdoutBytes;
        const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
        stdoutBytes += slice.byteLength;
        stdout += slice.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes >= MAX_CAPTURE_BYTES) return;
        const remaining = MAX_CAPTURE_BYTES - stderrBytes;
        const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
        stderrBytes += slice.byteLength;
        stderr += slice.toString('utf-8');
      });

      child.on('error', err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        const { cleanStdout } = extractFinalOutputAndCwd();
        resolve({
          command,
          cwd,
          exitCode: 1,
          stdout: cleanStdout,
          stderr: err.message,
          timedOut: false
        });
      });

      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        const exitCode = typeof code === 'number' ? code : timedOut ? 124 : 1;
        const { cleanStdout, detectedCwd } = extractFinalOutputAndCwd();
        resolve({
          command,
          cwd: exitCode === 0 ? detectedCwd || cwd : cwd,
          exitCode,
          stdout: cleanStdout,
          stderr,
          timedOut
        });
      });
    });
  }

  private async executeMockCommand(
    sessionId: string,
    command: string,
    cwd?: string
  ): Promise<ShellToolOutput> {
    const trimmed = command.trim();
    const lower = trimmed.toLowerCase();
    const nextCwd = resolveCommandCwdChange(command, cwd) || cwd;

    if (lower === 'pwd') {
      return {
        command,
        cwd: nextCwd,
        exitCode: 0,
        stdout: `${nextCwd || '/etc/nginx'}\n`,
        stderr: '',
        timedOut: false
      };
    }

    if (lower.startsWith('cd ') || lower.startsWith('set-location ') || lower.startsWith('sl ')) {
      return {
        command,
        cwd: nextCwd,
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false
      };
    }

    if (lower === 'nginx -t') {
      try {
        const { provider } = this.deps.sessionManager.getFileSystemProvider(sessionId);
        const conf = await provider.read(sessionId, '/etc/nginx/nginx.conf', { internal: true });
        if (conf.includes('invalid_directive')) {
          return {
            command,
            cwd: nextCwd,
            exitCode: 1,
            stdout: '',
            stderr:
              'nginx: [emerg] unknown directive "invalid_directive" in /etc/nginx/nginx.conf\nnginx: configuration file /etc/nginx/nginx.conf test failed\n',
            timedOut: false
          };
        }
      } catch {
        // default ok
      }
      return {
        command,
        cwd: nextCwd,
        exitCode: 0,
        stdout:
          'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n',
        stderr: '',
        timedOut: false
      };
    }

    if (lower.startsWith('systemctl is-active') || lower.startsWith('systemctl status')) {
      return {
        command,
        cwd: nextCwd,
        exitCode: 0,
        stdout: 'active (running)\n',
        stderr: '',
        timedOut: false
      };
    }

    if (lower.startsWith('cat ')) {
      const targetPath = trimmed.slice(4).trim();
      try {
        const { provider } = this.deps.sessionManager.getFileSystemProvider(sessionId);
        const content = await provider.read(sessionId, targetPath, { internal: true });
        return {
          command,
          cwd: nextCwd,
          exitCode: 0,
          stdout: content,
          stderr: '',
          timedOut: false
        };
      } catch (err) {
        return {
          command,
          cwd: nextCwd,
          exitCode: 1,
          stdout: '',
          stderr: errorMessage(err),
          timedOut: false
        };
      }
    }

    if (lower === 'false' || lower.startsWith('exit 1')) {
      return {
        command,
        cwd,
        exitCode: 1,
        stdout: '',
        stderr: 'Command exited with status 1',
        timedOut: false
      };
    }

    return {
      command,
      cwd: nextCwd,
      exitCode: 0,
      stdout: `[mock exec] ${trimmed}: OK\n`,
      stderr: '',
      timedOut: false
    };
  }
}
