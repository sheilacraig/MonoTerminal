import type { HostAsset } from '../../storage';
import type { WsOutboundMessage } from '../../../shared/wsProtocol';

export type SessionType = 'local' | 'ssh' | 'mock';

export type SessionStatus =
  | 'creating'
  | 'active'
  | 'detached'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface HostRef {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent' | 'mock' | 'local';
  initialDir?: string;
}

export interface TerminalRef {
  id: string;
  providerType: SessionType;
  cols: number;
  rows: number;
  cwd: string;
  shell?: string;
}

export interface FileSystemRef {
  id: string;
  providerType: SessionType;
  rootPath: string;
  ready: boolean;
}

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  host: HostRef;
  terminal: TerminalRef;
  filesystem: FileSystemRef;
  attachedConnections: Set<string>;
  createdAt: number;
  lastActiveAt: number;
}

export interface CreateSessionRequest {
  id: string;
  host: HostAsset;
  cols: number;
  rows: number;
  credentials?: {
    password?: string;
    passphrase?: string;
    privateKey?: string;
  };
}

export type SessionOutboundSender = (msg: WsOutboundMessage) => void;

export interface SessionManager {
  create(request: CreateSessionRequest): Promise<Session>;
  getOrCreate(request: CreateSessionRequest): Promise<Session>;
  get(id: string): Session | undefined;
  attach(id: string, connectionId: string, send?: SessionOutboundSender): void;
  detach(id: string, connectionId: string): void;
  close(id: string): Promise<void>;
  list(): Session[];
  writeTerminal(id: string, data: string): boolean;
  resizeTerminal(id: string, cols: number, rows: number): boolean;
  updateCwd(id: string, cwd: string): void;
}
