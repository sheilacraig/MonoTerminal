/**
 * Semantic Shell Integration (OSC 133 & OSC 7) Protocol Handler.
 *
 * Implements modern semantic terminal protocol adopted by Ghostty, iTerm2,
 * Kitty, and VS Code.
 *
 * Protocol Specification:
 * - OSC 133 ; A ST: Prompt Start (marks the start of the shell prompt)
 * - OSC 133 ; B ST: Command Start (marks where the user types a command)
 * - OSC 133 ; C ST: Command Executed (marks the beginning of command output)
 * - OSC 133 ; D [; <exit_code>] ST: Command Finished (reports the exact exit code)
 *
 * Directory Tracking:
 * - OSC 7 ; file://<host>/<path> ST: Reports current working directory
 *
 * Key benefits for MonoTerminal:
 * 1. 100% accurate error detection: triggers "⚡ 报错排查" based on exitCode != 0,
 *    eliminating regex false-positives and false-negatives.
 * 2. Precision AI context: isolates the exact command that failed and its exact
 *    output, without guessing from rolling buffer tails.
 * 3. Dynamic CWD synchronization: updates tab and Ops context path automatically.
 */

import { FailedCommandInfo } from '../types';
import { stripAnsi } from './authPrompt';

export type CommandState = 'prompt' | 'typing' | 'running' | 'completed';

export type { FailedCommandInfo };

export interface TrackedCommand {
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
  startTime: number;
  endTime?: number;
  cwd?: string;
  state: CommandState;
}

export interface Osc133Payload {
  type: 'A' | 'B' | 'C' | 'D' | 'E' | 'P';
  exitCode?: number;
  value?: string;
}

/**
 * Parse the data portion of an OSC 133 escape sequence.
 * xterm.js calls the OSC handler with string after "133;".
 */
export function parseOsc133(data: string): Osc133Payload | null {
  if (!data) return null;

  const parts = data.split(';');
  const type = parts[0]?.trim().toUpperCase();

  switch (type) {
    case 'A':
      return { type: 'A' };
    case 'B':
      return { type: 'B' };
    case 'C':
      return { type: 'C' };
    case 'D': {
      let exitCode: number | undefined;
      if (parts.length > 1 && parts[1] !== '') {
        const parsed = parseInt(parts[1], 10);
        if (!Number.isNaN(parsed)) {
          exitCode = parsed;
        }
      }
      return { type: 'D', exitCode: exitCode ?? 0 };
    }
    case 'E':
      // Explicit command line string: 133;E;cmd
      return { type: 'E', value: parts.slice(1).join(';') };
    case 'P':
      // Property: 133;P;key=value
      return { type: 'P', value: parts.slice(1).join(';') };
    default:
      return null;
  }
}

/**
 * Parse an OSC 7 URI (file://<hostname>/<path>) and extract the local path.
 */
export function parseOsc7(data: string): string | null {
  if (!data) return null;

  try {
    const trimmed = data.trim();
    if (trimmed.startsWith('file://')) {
      const url = new URL(trimmed);
      let pathname = decodeURIComponent(url.pathname);
      // On Windows: file:///C:/path -> C:/path
      if (/^\/[a-zA-Z]:/.test(pathname)) {
        pathname = pathname.slice(1);
      }
      return pathname || '/';
    }
  } catch {
    // If not a standard URL, try simple path extraction
    const match = data.match(/file:\/\/[^/]*(\/.*)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return null;
}

export type CommandFinishedListener = (cmd: TrackedCommand) => void;
export type CwdChangedListener = (cwd: string) => void;

interface SessionShellState {
  currentCwd: string;
  activeCommand: TrackedCommand | null;
  lastCompletedCommand: TrackedCommand | null;
  lastFailedCommand: FailedCommandInfo | null;
  hasSeenIntegration: boolean;
  commandCount: number;
  outputLimit: number;
  pendingCommandText?: string;
}

/** Max chars kept per command output buffer to avoid runaway memory. */
const DEFAULT_OUTPUT_LIMIT = 32_000;

export class ShellIntegrationTracker {
  private sessions = new Map<string, SessionShellState>();
  private finishListeners = new Map<string, Set<CommandFinishedListener>>();
  private cwdListeners = new Map<string, Set<CwdChangedListener>>();

  private getOrCreate(sessionId: string): SessionShellState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        currentCwd: '~',
        activeCommand: null,
        lastCompletedCommand: null,
        lastFailedCommand: null,
        hasSeenIntegration: false,
        commandCount: 0,
        outputLimit: DEFAULT_OUTPUT_LIMIT
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /**
   * Whether the given session has active OSC 133 integration.
   * If false, callers can safely fall back to regex heuristic detection.
   */
  public hasIntegration(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.hasSeenIntegration);
  }

  /**
   * Handle parsed OSC 133 sequences emitted by the shell.
   */
  public handleOsc133(sessionId: string, rawData: string): boolean {
    const payload = parseOsc133(rawData);
    if (!payload) return false;

    const state = this.getOrCreate(sessionId);
    state.hasSeenIntegration = true;

    switch (payload.type) {
      case 'A': {
        // Prompt start: if a previous command was running, finalize it
        if (state.activeCommand && state.activeCommand.state === 'running') {
          this.finalizeCommand(sessionId, state, 0);
        }
        break;
      }

      case 'B': {
        // Command start: user started typing or pre-exec phase
        state.commandCount += 1;
        state.activeCommand = {
          id: `cmd-${sessionId}-${state.commandCount}`,
          command: state.pendingCommandText || '',
          output: '',
          exitCode: null,
          startTime: Date.now(),
          cwd: state.currentCwd,
          state: 'typing'
        };
        state.pendingCommandText = undefined;
        break;
      }

      case 'E': {
        // Explicit command text passed via OSC 133;E;<cmd>
        if (state.activeCommand && payload.value) {
          state.activeCommand.command = payload.value;
        }
        break;
      }

      case 'C': {
        // Command executed: output begins now
        if (!state.activeCommand) {
          state.commandCount += 1;
          state.activeCommand = {
            id: `cmd-${sessionId}-${state.commandCount}`,
            command: state.pendingCommandText || '',
            output: '',
            exitCode: null,
            startTime: Date.now(),
            cwd: state.currentCwd,
            state: 'running'
          };
          state.pendingCommandText = undefined;
        } else {
          state.activeCommand.state = 'running';
        }
        break;
      }

      case 'D': {
        // Command finished with exit code
        const exitCode = payload.exitCode ?? 0;
        this.finalizeCommand(sessionId, state, exitCode);
        break;
      }

      default:
        break;
    }

    return true;
  }

  /**
   * Handle OSC 7 CWD reports.
   */
  public handleOsc7(sessionId: string, rawData: string): boolean {
    const path = parseOsc7(rawData);
    if (!path) return false;

    const state = this.getOrCreate(sessionId);
    state.hasSeenIntegration = true;
    state.currentCwd = path;

    if (state.activeCommand && !state.activeCommand.cwd) {
      state.activeCommand.cwd = path;
    }

    const listeners = this.cwdListeners.get(sessionId);
    listeners?.forEach(fn => fn(path));

    return true;
  }

  /**
   * Feed terminal output to be captured for the actively running command.
   */
  public noteOutput(sessionId: string, chunk: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.activeCommand || state.activeCommand.state !== 'running') {
      return;
    }

    // Accumulate output, capped at outputLimit
    const cur = state.activeCommand.output;
    state.activeCommand.output = (cur + chunk).slice(-state.outputLimit);
  }

  /**
   * Helper to set user-typed command string if not emitted via OSC 133;E.
   */
  public setCommandText(sessionId: string, commandText: string): void {
    const state = this.getOrCreate(sessionId);
    if (state.activeCommand) {
      state.activeCommand.command = commandText;
    }
    state.pendingCommandText = commandText;
  }

  private finalizeCommand(sessionId: string, state: SessionShellState, exitCode: number): void {
    const cmd = state.activeCommand;
    if (!cmd) return;

    cmd.exitCode = exitCode;
    cmd.endTime = Date.now();
    cmd.state = 'completed';

    state.lastCompletedCommand = cmd;
    state.activeCommand = null;
    state.pendingCommandText = undefined;

    if (exitCode !== 0) {
      state.lastFailedCommand = {
        command: cmd.command || undefined,
        exitCode,
        output: stripAnsi(cmd.output || '').trim(),
        cwd: cmd.cwd || state.currentCwd,
        timestamp: cmd.endTime
      };
    } else {
      // Successful execution clears previous failed command
      state.lastFailedCommand = null;
    }

    const listeners = this.finishListeners.get(sessionId);
    listeners?.forEach(fn => fn(cmd));
  }

  public getFailedCommand(sessionId: string): FailedCommandInfo | null {
    return this.sessions.get(sessionId)?.lastFailedCommand ?? null;
  }

  public clearFailedCommand(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.lastFailedCommand = null;
  }

  public getLastCommand(sessionId: string): TrackedCommand | null {
    return this.sessions.get(sessionId)?.lastCompletedCommand ?? null;
  }

  public getCwd(sessionId: string): string {
    return this.sessions.get(sessionId)?.currentCwd ?? '~';
  }

  public onCommandFinished(sessionId: string, listener: CommandFinishedListener): () => void {
    if (!this.finishListeners.has(sessionId)) {
      this.finishListeners.set(sessionId, new Set());
    }
    this.finishListeners.get(sessionId)!.add(listener);

    return () => {
      this.finishListeners.get(sessionId)?.delete(listener);
    };
  }

  public onCwdChanged(sessionId: string, listener: CwdChangedListener): () => void {
    if (!this.cwdListeners.has(sessionId)) {
      this.cwdListeners.set(sessionId, new Set());
    }
    this.cwdListeners.get(sessionId)!.add(listener);

    return () => {
      this.cwdListeners.get(sessionId)?.delete(listener);
    };
  }

  public dispose(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.finishListeners.delete(sessionId);
    this.cwdListeners.delete(sessionId);
  }
}

/** Global singleton tracker */
export const shellIntegrationTracker = new ShellIntegrationTracker();
