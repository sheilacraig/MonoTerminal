import type { SessionType } from '../session/types';
import type { Unsubscribe } from '../terminal/types';

export interface BaseMonoEvent {
  sessionId: string;
  timestamp: number;
}

export interface CommandStartedEvent extends BaseMonoEvent {
  type: 'command:started';
  commandId: string;
  command: string;
  cwd?: string;
}

export interface CommandOutputEvent extends BaseMonoEvent {
  type: 'command:output';
  commandId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface CommandFinishedEvent extends BaseMonoEvent {
  type: 'command:finished';
  commandId: string;
  command: string;
  exitCode: number;
  cwd?: string;
  durationMs: number;
}

export interface CommandFailedEvent extends BaseMonoEvent {
  type: 'command:failed';
  commandId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  cwd?: string;
}

export interface DirectoryChangedEvent extends BaseMonoEvent {
  type: 'directory:changed';
  cwd: string;
}

export interface FileOpenedEvent extends BaseMonoEvent {
  type: 'file:opened';
  path: string;
}

export interface FileChangedEvent extends BaseMonoEvent {
  type: 'file:changed';
  path: string;
  operation: 'delete' | 'rename' | 'mkdir' | 'chmod';
  targetPath?: string;
}

export interface FileSavedEvent extends BaseMonoEvent {
  type: 'file:saved';
  path: string;
  byteLength: number;
}

export interface SessionConnectedEvent extends BaseMonoEvent {
  type: 'session:connected';
  sessionType: SessionType;
  hostId: string;
  cwd: string;
}

export interface SessionDisconnectedEvent extends BaseMonoEvent {
  type: 'session:disconnected';
  reason: 'detached' | 'closed';
}

export interface AgentStartedEvent extends BaseMonoEvent {
  type: 'agent:started';
  planId: string;
  goal: string;
}

export interface AgentToolCallEvent extends BaseMonoEvent {
  type: 'agent:tool_call';
  planId?: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface AgentToolResultEvent extends BaseMonoEvent {
  type: 'agent:tool_result';
  planId?: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface AgentFinishedEvent extends BaseMonoEvent {
  type: 'agent:finished';
  planId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
}

export type MonoEvent =
  | CommandStartedEvent
  | CommandOutputEvent
  | CommandFinishedEvent
  | CommandFailedEvent
  | DirectoryChangedEvent
  | FileOpenedEvent
  | FileChangedEvent
  | FileSavedEvent
  | SessionConnectedEvent
  | SessionDisconnectedEvent
  | AgentStartedEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentFinishedEvent;

export interface EventBus {
  publish(event: MonoEvent): void;
  subscribe<T extends MonoEvent['type']>(
    type: T,
    listener: (event: Extract<MonoEvent, { type: T }>) => void
  ): Unsubscribe;
  subscribeAll(listener: (event: MonoEvent) => void): Unsubscribe;
}
