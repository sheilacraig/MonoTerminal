import { spawn } from 'child_process';
import path from 'path';
import { errorMessage } from '../../../shared/errors';
import { splitShellSegments, tokenize } from '../../../shared/guardrail';
import type { GuardrailAction } from '../../domain/security/types';
import {
  type DefaultSessionManager,
  sanitizeBroadcastTerminalOutput
} from '../../application/session/DefaultSessionManager';
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

export { sanitizeBroadcastTerminalOutput };

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
const DEFAULT_OSC133_PROBE_TIMEOUT_MS = 800;
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
  /**
   * Maximum time (in ms) to wait for an OSC 133 marker (`133;C` / `133;E` / `133;D`)
   * in an attached PowerShell session before concluding the OSC 133 hook is missing
   * and degrading to isolated `-NoProfile -NonInteractive` execution (P1-2).
   */
  osc133ProbeTimeoutMs?: number;
}

/**
 * Isolated non-interactive ShellTool (Phase 8 / P1-6 / P0-B).
 * Never writes into the user's interactive PTY stream (`LocalPtyManager` / `SshManager.writeToShell`)
 * unless an attached PowerShell session has an active OSC 133 hook, and automatically
 * degrades to isolated execution when the OSC 133 hook is absent (P1-2).
 */
export class ShellTool implements Tool<ShellToolInput, ShellToolOutput> {
  public readonly name = 'shell';
  public readonly description =
    'Execute a non-interactive shell command in an isolated background channel with timeout protection.';
  public readonly schema = shellToolSchema;

  /**
   * Sessions where interactive PowerShell lacked the OSC 133 hook (e.g. blocked
   * by ExecutionPolicy or custom `$PROFILE` prompt). Once degraded, subsequent
   * Agent steps go straight to `executeLocalCommand` without waiting for probe
   * or command timeouts (P1-2).
   */
  private readonly degradedOsc133Sessions = new Set<string>();

  constructor(private readonly deps: ShellToolDeps) {}

  public isSessionOsc133Degraded(sessionId: string): boolean {
    return this.degradedOsc133Sessions.has(sessionId);
  }

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
    const hasAttachedTerminal =
      typeof this.deps.sessionManager.hasAttachedConnections === 'function'
        ? this.deps.sessionManager.hasAttachedConnections(ctx.sessionId)
        : Boolean(session && session.attachedConnections.size > 0);

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
        if (hasAttachedTerminal) {
          this.deps.sessionManager.broadcastTerminalData?.(
            ctx.sessionId,
            sanitizeBroadcastTerminalOutput(
              `\r\n\x1b[1;36m[Agent 执行]\x1b[0m ${input.command}\r\n`
            )
          );
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
        if (hasAttachedTerminal) {
          const combinedOut = sanitizeBroadcastTerminalOutput(
            [execRes.stdout, execRes.stderr].filter(Boolean).join('')
          );
          if (combinedOut) {
            this.deps.sessionManager.broadcastTerminalData?.(
              ctx.sessionId,
              combinedOut.replace(/\r?\n/g, '\r\n')
            );
          }
          this.deps.sessionManager.writeTerminal(ctx.sessionId, '\r');
        }
      } else if (sessionType === 'mock') {
        if (hasAttachedTerminal) {
          this.deps.sessionManager.writeTerminal(ctx.sessionId, `${input.command}\r`);
        }
        result = await this.executeMockCommand(ctx.sessionId, input.command, cwd);
      } else if (
        hasAttachedTerminal &&
        !this.degradedOsc133Sessions.has(ctx.sessionId) &&
        isPowerShellExecutable(session?.terminal.shell || '') &&
        typeof this.deps.sessionManager.onTerminalData === 'function'
      ) {
        result = await this.executeInteractivePowerShellCommand(
          ctx.sessionId,
          input.command,
          cwd,
          session?.terminal.cwd,
          timeoutMs,
          ctx.abortSignal
        );
      } else {
        if (hasAttachedTerminal) {
          this.deps.sessionManager.broadcastTerminalData?.(
            ctx.sessionId,
            sanitizeBroadcastTerminalOutput(
              `\r\n\x1b[1;36m[Agent 执行]\x1b[0m ${input.command}\r\n`
            )
          );
        }
        result = await this.executeLocalCommand(input.command, cwd, timeoutMs, ctx.abortSignal);
        if (hasAttachedTerminal) {
          const combinedOut = sanitizeBroadcastTerminalOutput(
            [result.stdout, result.stderr].filter(Boolean).join('')
          );
          if (combinedOut) {
            this.deps.sessionManager.broadcastTerminalData?.(
              ctx.sessionId,
              combinedOut.replace(/\r?\n/g, '\r\n')
            );
          }
          this.deps.sessionManager.writeTerminal(ctx.sessionId, '\r');
        }
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

  /**
   * Execute a command directly inside the user's attached interactive PowerShell PTY
   * and observe completion, exitCode, output, and CWD via the OSC 133 / OSC 7 stream.
   *
   * P1-2: If the OSC 133 hook is absent (e.g. blocked by ExecutionPolicy, PS5 without
   * hook, or custom `$PROFILE` prompt), detects the missing hook via unhooked prompt
   * pattern or fast probe timer (`osc133ProbeTimeoutMs`), marks the session degraded,
   * emits a terminal notice, and falls back to `executeLocalCommand` so multi-step
   * plans never stall on repeated full timeouts.
   */
  private executeInteractivePowerShellCommand(
    sessionId: string,
    command: string,
    cwd: string | undefined,
    sessionCwd: string | undefined,
    timeoutMs: number,
    abortSignal?: AbortSignal
  ): Promise<ShellToolOutput> {
    const singleLine = command
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .join('; ');

    const norm = (p?: string) =>
      p && p !== '~' ? path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase() : '';
    const needCd = Boolean(cwd && cwd !== '~' && norm(cwd) !== norm(sessionCwd));
    const fullLine = needCd
      ? `Set-Location -LiteralPath '${cwd!.replace(/'/g, "''")}'; ${singleLine || command}`
      : singleLine || command;

    return new Promise(resolve => {
      let rawBuffer = '';
      let settled = false;
      let hasSeenOsc133 = false;

      const stripTerminalSequences = (raw: string): string =>
        raw
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\][^\x07]*\x07/g, '')
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
          .replace(/\r\n/g, '\n')
          .trim();

      const cleanup = (
        unsub: () => void,
        timer: ReturnType<typeof setTimeout>,
        probeTimer: ReturnType<typeof setTimeout>
      ) => {
        unsub();
        clearTimeout(timer);
        clearTimeout(probeTimer);
        abortSignal?.removeEventListener('abort', onAbort);
      };

      const degradeToIsolatedExecution = () => {
        if (settled) return;
        settled = true;
        cleanup(unsub, timer, probeTimer);
        this.degradedOsc133Sessions.add(sessionId);
        this.deps.sessionManager.writeTerminal(sessionId, '\x03');
        this.deps.sessionManager.broadcastTerminalData?.(
          sessionId,
          sanitizeBroadcastTerminalOutput(
            '\r\n\x1b[33m[Agent 提示] 未检测到 PowerShell OSC 133 语义钩子（可能受执行策略或自定义 Profile 影响），已自动降级为后台隔离执行模式\x1b[0m\r\n'
          )
        );
        void this.executeLocalCommand(command, cwd, timeoutMs, abortSignal).then(res => {
          const combinedOut = sanitizeBroadcastTerminalOutput(
            [res.stdout, res.stderr].filter(Boolean).join('')
          );
          if (combinedOut) {
            this.deps.sessionManager.broadcastTerminalData?.(
              sessionId,
              combinedOut.replace(/\r?\n/g, '\r\n')
            );
          }
          this.deps.sessionManager.writeTerminal(sessionId, '\r');
          resolve(res);
        });
      };

      const unsub = this.deps.sessionManager.onTerminalData(sessionId, chunk => {
        if (settled) return;
        rawBuffer += chunk;
        if (rawBuffer.length > MAX_CAPTURE_BYTES * 2) {
          rawBuffer = rawBuffer.slice(-MAX_CAPTURE_BYTES * 2);
        }

        // Look for OSC 133;C (command start) or OSC 133;E (command line echo in prompt)
        const cMarker = '\x1b]133;C\x07';
        const cIdx = rawBuffer.indexOf(cMarker);
        // eslint-disable-next-line no-control-regex
        const hasFallbackEcho = /\x1b\]133;E;(?!Import-Module PSReadLine)[^\x07]+\x07\x1b\]133;D;/.test(
          rawBuffer
        );
        if (cIdx >= 0 || hasFallbackEcho || rawBuffer.includes('\x1b]133;')) {
          hasSeenOsc133 = true;
          clearTimeout(probeTimer);
        }

        if (cIdx < 0 && !hasFallbackEcho) {
          // Fast-path detection for unhooked PowerShell prompt returning after command echo
          const plainText = stripTerminalSequences(rawBuffer);
          if (
            !hasSeenOsc133 &&
            /(?:^|\n)PS (?:[A-Za-z]:\\[^\n>]*|[^\n>]*)>\s*$/.test(plainText)
          ) {
            degradeToIsolatedExecution();
          }
          return;
        }

        const tail = cIdx >= 0 ? rawBuffer.slice(cIdx + cMarker.length) : rawBuffer;
        // eslint-disable-next-line no-control-regex
        const dMatch = /\x1b\]133;D;(-?\d+)\x07([\s\S]*?\x1b\]133;B\x07)/.exec(tail);
        if (!dMatch) {
          return;
        }

        settled = true;
        cleanup(unsub, timer, probeTimer);
        this.degradedOsc133Sessions.delete(sessionId);

        const exitCode = Number(dMatch[1]) || 0;
        const cleanStdout = stripTerminalSequences(tail.slice(0, dMatch.index));
        // eslint-disable-next-line no-control-regex
        const osc7Match = /\x1b\]7;file:\/\/localhost\/([^\x07]+)\x07/.exec(dMatch[2]);
        let detectedCwd = resolveCommandCwdChange(command, cwd);
        if (osc7Match?.[1]) {
          try {
            detectedCwd = path.win32.normalize(decodeURIComponent(osc7Match[1]));
          } catch {
            detectedCwd = osc7Match[1];
          }
        }

        resolve({
          command,
          cwd: exitCode === 0 ? detectedCwd || cwd : cwd,
          exitCode,
          stdout: cleanStdout,
          stderr: '',
          timedOut: false
        });
      });

      const probeMs = Math.min(
        timeoutMs,
        Math.max(20, this.deps.osc133ProbeTimeoutMs ?? DEFAULT_OSC133_PROBE_TIMEOUT_MS)
      );
      const probeTimer = setTimeout(() => {
        if (settled || hasSeenOsc133) return;
        degradeToIsolatedExecution();
      }, probeMs);
      probeTimer.unref?.();

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup(unsub, timer, probeTimer);
        if (!rawBuffer.includes('\x1b]133;D;')) {
          this.degradedOsc133Sessions.add(sessionId);
        }
        this.deps.sessionManager.writeTerminal(sessionId, '\x03');
        resolve({
          command,
          cwd,
          exitCode: 124,
          stdout: stripTerminalSequences(rawBuffer),
          stderr: `[Timeout after ${timeoutMs}ms]`,
          timedOut: true
        });
      }, timeoutMs);
      timer.unref?.();

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup(unsub, timer, probeTimer);
        this.deps.sessionManager.writeTerminal(sessionId, '\x03');
        resolve({
          command,
          cwd,
          exitCode: 130,
          stdout: stripTerminalSequences(rawBuffer),
          stderr: '[Aborted]',
          timedOut: true
        });
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      const wrote = this.deps.sessionManager.writeTerminal(sessionId, `${fullLine}\r`);
      if (!wrote) {
        settled = true;
        cleanup(unsub, timer, probeTimer);
        void this.executeLocalCommand(command, cwd, timeoutMs, abortSignal).then(resolve);
      }
    });
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
