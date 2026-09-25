export type TimelineEntryKind = 'command' | 'file' | 'agent' | 'session';

export type TimelineEntryStatus = 'running' | 'success' | 'failed' | 'info';

export interface TimelineEntry {
  id: string;
  sessionId: string;
  kind: TimelineEntryKind;
  title: string;
  detail?: string;
  status?: TimelineEntryStatus;
  exitCode?: number;
  cwd?: string;
  durationMs?: number;
  timestamp: number;
}
