import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'node-pty';
import type { IPty } from 'node-pty';

/**
 * A live local pseudo-terminal (PTY). Mirrors the shape of an SSH shell
 * session so the terminal ws-handler can bind `data` / `exit` events the
 * same way it binds ssh `data` / `close` events.
 */
export interface LocalPtySession {
  /** The underlying node-pty process handle. */
  pty: IPty;
  /** Emits `data` (stdout chunk) and `exit` (process terminated). */
  events: EventEmitter;
  /** Directory the shell was spawned in (initial cwd). */
  initialCwd: string;
  /** Resolved shell command, e.g. `pwsh.exe` / `/bin/bash`. */
  shellCommand: string;
}

/** Injected (rather than imported) so ws handlers stay unit-testable. */
export interface LocalPtyManagerApi {
  createSession(sessionId: string, cols: number, rows: number, cwd?: string): LocalPtySession;
  getSession(sessionId: string): LocalPtySession | undefined;
  has(sessionId: string): boolean;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  closeSession(sessionId: string): void;
}

/**
 * Resolve an executable by name: check the well-known install locations
 * first, then scan the PATH entries (avoids spawning `where`/`which`).
 */
function resolveExecutable(name: string, wellKnown: string[]): string | null {
  const isWindows = process.platform === 'win32';
  const candidates = isWindows
    ? [name, ...wellKnown]
    : [...wellKnown.filter(p => fs.existsSync(p)), name];

  if (!isWindows) {
    for (const c of candidates) {
      if (path.isAbsolute(c) && fs.existsSync(c)) return c;
    }
    return name; // let the OS resolve it via execvp
  }

  for (const p of wellKnown) {
    if (fs.existsSync(p)) return p;
  }
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Detect the best interactive shell available on this machine.
 * Windows: pwsh.exe → powershell.exe → cmd.exe
 * Linux / macOS: $SHELL → /bin/bash → /bin/sh
 */
export function detectDefaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    const pwsh = resolveExecutable('pwsh.exe', [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')
    ]);
    if (pwsh) return { command: pwsh, args: [] };
    const powershell = resolveExecutable('powershell.exe', [
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
    ]);
    if (powershell) return { command: powershell, args: [] };
    const cmd = resolveExecutable('cmd.exe', [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    ]);
    if (cmd) return { command: cmd, args: [] };
    throw new Error('未在本机找到可用的 Shell（pwsh / powershell / cmd 均不可用）');
  }
  const shell = process.env.SHELL || '/bin/bash';
  return { command: fs.existsSync(shell) ? shell : '/bin/sh', args: [] };
}

/**
 * Manages local PTY sessions backed by node-pty. Replaces child_process-based
 * shells with true pseudo-terminals so interactive features (Tab completion,
 * ANSI colors, vim/less, cursor control) behave like a real terminal.
 */
/** Resolve `~` to the user home directory for friendlier path inputs. */
function expandHome(p?: string): string {
  if (!p) return os.homedir();
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export class LocalPtyManager implements LocalPtyManagerApi {
  private sessions = new Map<string, LocalPtySession>();

  public createSession(
    sessionId: string,
    cols: number,
    rows: number,
    cwd?: string
  ): LocalPtySession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const shell = detectDefaultShell();
    const resolvedCwd = expandHome(cwd);
    const initialCwd = resolvedCwd && fs.existsSync(resolvedCwd) ? resolvedCwd : os.homedir();

    let pty: IPty;
    try {
      pty = spawn(shell.command, shell.args, {
        name: 'xterm-256color',
        cols: Math.max(1, cols),
        rows: Math.max(1, rows),
        cwd: initialCwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        } as Record<string, string>
      });
    } catch (err) {
      // node-pty 原生模块缺失 / 与本机 Node 版本不匹配时给出可执行的修复建议，
      // 而不是把一句原生报错直接抛给用户。
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `终端组件 (node-pty) 初始化失败：${reason}。` +
          `请先执行 npm rebuild node-pty 后重试；若仍失败，可改用「新建 SSH 主机」连接远程服务器。`,
        { cause: err }
      );
    }

    const events = new EventEmitter();
    const session: LocalPtySession = {
      pty,
      events,
      initialCwd,
      shellCommand: shell.command
    };

    pty.onData(data => events.emit('data', data));
    pty.onExit(() => {
      events.emit('exit');
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  public getSession(sessionId: string): LocalPtySession | undefined {
    return this.sessions.get(sessionId);
  }

  public has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  public write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty.write(data);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.pty.resize(Math.max(1, cols), Math.max(1, rows));
  }

  public closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    try {
      session.pty.kill();
    } catch {
      // Process may have already exited — nothing to clean up
    }
  }
}

export const localPtyManager = new LocalPtyManager();
