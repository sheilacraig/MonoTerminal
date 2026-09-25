export type CommandStatus = 'running' | 'success' | 'failed' | 'cancelled';

export interface CommandRecord {
  id: string;
  sessionId: string;
  command: string;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  status: CommandStatus;
}

export type TermCmdEventKind = 'started' | 'finished' | 'cwd' | 'heuristic_error';

export interface TermCmdEventPayload {
  sessionId: string;
  kind: TermCmdEventKind;
  commandId?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  output?: string;
  timestamp?: number;
}
