import type { CommandRecord } from '../command/types';
import type { SessionStatus, SessionType } from '../session/types';

export interface SessionContext {
  id: string;
  type: SessionType;
  status: SessionStatus;
  hostId: string;
  hostName: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface TerminalContext {
  cwd?: string;
  shell?: string;
  user?: string;
  host?: string;
  os?: string;
  hasSemanticIntegration?: boolean;
  terminalSnippet?: string;
}

export interface CommandContext {
  current?: CommandRecord;
  failed?: CommandRecord;
  recent: CommandRecord[];
}

export interface FileContext {
  openFiles: string[];
  selectedFile?: string;
  selectedText?: string;
}

export interface GitContext {
  branch?: string;
  headRef?: string;
}

export interface SystemContext {
  platform: string;
  arch: string;
  timestamp: number;
}

export interface WorkspaceContext {
  session: SessionContext;
  terminal: TerminalContext;
  command: CommandContext;
  filesystem: FileContext;
  git?: GitContext;
  system: SystemContext;
}
