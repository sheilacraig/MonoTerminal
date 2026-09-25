import type { EventBus } from '../../domain/events/types';
import type { CommandRecord, TermCmdEventPayload } from '../../domain/command/types';

interface SessionCommandState {
  currentCwd?: string;
  hasSemanticIntegration: boolean;
  currentCommand?: CommandRecord;
  lastFailedCommand?: CommandRecord;
  recentCommands: CommandRecord[];
  byIdMap: Map<string, CommandRecord>;
  lastHeuristicError?: { snippet: string; timestamp: number };
  seq: number;
}

const MAX_RECENT_COMMANDS = 100;
const MAX_OUTPUT_CHARS = 32_000;

export class CommandEngine {
  private readonly sessions = new Map<string, SessionCommandState>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly onCwdUpdate?: (sessionId: string, cwd: string) => void
  ) {}

  private getOrCreateState(sessionId: string): SessionCommandState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        hasSemanticIntegration: false,
        recentCommands: [],
        byIdMap: new Map<string, CommandRecord>(),
        seq: 0
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  public startCommand(params: {
    id?: string;
    sessionId: string;
    command: string;
    cwd?: string;
    startedAt?: number;
  }): CommandRecord {
    const state = this.getOrCreateState(params.sessionId);
    state.seq += 1;
    const id = params.id || `cmd-${params.sessionId}-${state.seq}`;
    const startedAt = params.startedAt ?? Date.now();
    const cwd = params.cwd || state.currentCwd;

    const record: CommandRecord = {
      id,
      sessionId: params.sessionId,
      command: params.command,
      cwd,
      startedAt,
      stdout: '',
      stderr: '',
      status: 'running'
    };

    state.currentCommand = record;
    state.byIdMap.set(id, record);
    this.pushRecent(state, record);

    this.eventBus.publish({
      type: 'command:started',
      sessionId: params.sessionId,
      commandId: id,
      command: params.command,
      cwd,
      timestamp: startedAt
    });

    return record;
  }

  public appendOutput(
    sessionId: string,
    commandId: string,
    chunk: string,
    stream: 'stdout' | 'stderr' = 'stdout'
  ): void {
    const state = this.sessions.get(sessionId);
    const record = state?.byIdMap.get(commandId) ?? state?.currentCommand;
    if (!record) return;

    if (stream === 'stderr') {
      record.stderr = (record.stderr + chunk).slice(-MAX_OUTPUT_CHARS);
    } else {
      record.stdout = (record.stdout + chunk).slice(-MAX_OUTPUT_CHARS);
    }

    this.eventBus.publish({
      type: 'command:output',
      sessionId,
      commandId: record.id,
      stream,
      chunk,
      timestamp: Date.now()
    });
  }

  public finishCommand(params: {
    sessionId: string;
    commandId?: string;
    command?: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
    cwd?: string;
    endedAt?: number;
  }): CommandRecord {
    const state = this.getOrCreateState(params.sessionId);
    const endedAt = params.endedAt ?? Date.now();

    let record =
      (params.commandId ? state.byIdMap.get(params.commandId) : undefined) ??
      state.currentCommand;

    if (!record) {
      state.seq += 1;
      const id = params.commandId || `cmd-${params.sessionId}-${state.seq}`;
      record = {
        id,
        sessionId: params.sessionId,
        command: params.command || '',
        cwd: params.cwd || state.currentCwd,
        startedAt: endedAt,
        stdout: '',
        stderr: '',
        status: 'running'
      };
      state.byIdMap.set(id, record);
      this.pushRecent(state, record);
    }

    if (params.command && !record.command) {
      record.command = params.command;
    }
    if (params.cwd) {
      record.cwd = params.cwd;
      state.currentCwd = params.cwd;
    }
    if (params.stdout !== undefined) {
      record.stdout = params.stdout.slice(-MAX_OUTPUT_CHARS);
    }
    if (params.stderr !== undefined) {
      record.stderr = params.stderr.slice(-MAX_OUTPUT_CHARS);
    }

    record.exitCode = params.exitCode;
    record.endedAt = endedAt;
    record.status = params.exitCode === 0 ? 'success' : 'failed';

    if (state.currentCommand?.id === record.id) {
      state.currentCommand = undefined;
    }

    const durationMs = Math.max(0, endedAt - record.startedAt);
    this.eventBus.publish({
      type: 'command:finished',
      sessionId: params.sessionId,
      commandId: record.id,
      command: record.command,
      exitCode: params.exitCode,
      cwd: record.cwd,
      durationMs,
      timestamp: endedAt
    });

    if (params.exitCode !== 0) {
      state.lastFailedCommand = record;
      this.eventBus.publish({
        type: 'command:failed',
        sessionId: params.sessionId,
        commandId: record.id,
        command: record.command,
        exitCode: params.exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        cwd: record.cwd,
        timestamp: endedAt
      });
    } else {
      state.lastFailedCommand = undefined;
      state.lastHeuristicError = undefined;
    }

    return record;
  }

  public cancelCommand(
    sessionId: string,
    commandId?: string,
    partialOutput?: { stdout?: string; stderr?: string }
  ): CommandRecord | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;

    const record =
      (commandId ? state.byIdMap.get(commandId) : undefined) ?? state.currentCommand;
    if (!record) return undefined;

    record.status = 'cancelled';
    record.endedAt = Date.now();
    if (partialOutput?.stdout !== undefined) {
      record.stdout = partialOutput.stdout.slice(-MAX_OUTPUT_CHARS);
    }
    if (partialOutput?.stderr !== undefined) {
      record.stderr = partialOutput.stderr.slice(-MAX_OUTPUT_CHARS);
    }
    if (state.currentCommand?.id === record.id) {
      state.currentCommand = undefined;
    }
    return record;
  }

  public updateCwd(sessionId: string, cwd: string): void {
    if (!cwd) return;
    const state = this.getOrCreateState(sessionId);
    const changed = state.currentCwd !== cwd;
    state.currentCwd = cwd;
    this.onCwdUpdate?.(sessionId, cwd);

    if (changed) {
      this.eventBus.publish({
        type: 'directory:changed',
        sessionId,
        cwd,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Graceful degradation when OSC 133 is not enabled in the target shell (P0-A):
   * records heuristic error snippets without fabricating fake CommandRecords on `\r`.
   */
  public noteHeuristicError(sessionId: string, snippet: string): void {
    const state = this.getOrCreateState(sessionId);
    state.lastHeuristicError = { snippet, timestamp: Date.now() };
  }

  /**
   * Ingest a semantic command event reported by the frontend xterm.js OSC 133/7 parser.
   */
  public ingestClientEvent(payload: TermCmdEventPayload): void {
    const state = this.getOrCreateState(payload.sessionId);

    switch (payload.kind) {
      case 'cwd':
        state.hasSemanticIntegration = true;
        if (payload.cwd) {
          this.updateCwd(payload.sessionId, payload.cwd);
        }
        break;

      case 'started':
        state.hasSemanticIntegration = true;
        if (payload.command !== undefined) {
          this.startCommand({
            id: payload.commandId,
            sessionId: payload.sessionId,
            command: payload.command,
            cwd: payload.cwd,
            startedAt: payload.timestamp
          });
        }
        break;

      case 'finished':
        state.hasSemanticIntegration = true;
        this.finishCommand({
          sessionId: payload.sessionId,
          commandId: payload.commandId,
          command: payload.command,
          exitCode: payload.exitCode ?? 0,
          stdout: payload.output,
          cwd: payload.cwd,
          endedAt: payload.timestamp
        });
        break;

      case 'heuristic_error':
        if (payload.output) {
          this.noteHeuristicError(payload.sessionId, payload.output);
        }
        break;
    }
  }

  private pushRecent(state: SessionCommandState, record: CommandRecord): void {
    const existingIdx = state.recentCommands.findIndex(r => r.id === record.id);
    if (existingIdx >= 0) {
      state.recentCommands[existingIdx] = record;
      return;
    }
    state.recentCommands.push(record);
    if (state.recentCommands.length > MAX_RECENT_COMMANDS) {
      const evicted = state.recentCommands.shift();
      if (evicted) {
        state.byIdMap.delete(evicted.id);
      }
    }
  }

  public current(sessionId: string): CommandRecord | undefined {
    return this.sessions.get(sessionId)?.currentCommand;
  }

  public recent(sessionId: string, limit = 20): CommandRecord[] {
    const list = this.sessions.get(sessionId)?.recentCommands ?? [];
    return list.slice(-limit);
  }

  public failed(sessionId: string): CommandRecord | undefined {
    return this.sessions.get(sessionId)?.lastFailedCommand;
  }

  public byId(sessionId: string, commandId: string): CommandRecord | undefined {
    return this.sessions.get(sessionId)?.byIdMap.get(commandId);
  }

  public getCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.currentCwd;
  }

  public hasSemanticIntegration(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.hasSemanticIntegration);
  }

  public getHeuristicError(sessionId: string): { snippet: string; timestamp: number } | undefined {
    return this.sessions.get(sessionId)?.lastHeuristicError;
  }

  public restoreHistory(sessionId: string, records: CommandRecord[], cwd?: string): void {
    const state = this.getOrCreateState(sessionId);
    if (cwd) {
      state.currentCwd = cwd;
    }
    for (const r of records) {
      state.byIdMap.set(r.id, r);
      this.pushRecent(state, r);
      if (r.status === 'failed') {
        state.lastFailedCommand = r;
      }
    }
  }
}
