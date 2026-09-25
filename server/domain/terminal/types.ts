import type { HostAsset } from '../../storage';
import type { SessionType } from '../session/types';

export type Unsubscribe = () => void;

export interface TerminalCreateOptions {
  sessionId: string;
  host: HostAsset;
  cols: number;
  rows: number;
  cwd?: string;
  credentials?: {
    password?: string;
    passphrase?: string;
    privateKey?: string;
  };
}

export interface TerminalHandle {
  id: string;
  initialCwd: string;
  shellCommand?: string;
}

export type TerminalDataListener = (sessionId: string, data: string) => void;
export type TerminalExitListener = (sessionId: string, exitCode?: number) => void;
export type TerminalErrorListener = (sessionId: string, error: Error) => void;

export interface TerminalProvider {
  readonly type: SessionType;
  create(options: TerminalCreateOptions): Promise<TerminalHandle>;
  write(id: string, data: string): boolean;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string, signal?: string): Promise<void>;
  onData(listener: TerminalDataListener): Unsubscribe;
  onExit(listener: TerminalExitListener): Unsubscribe;
  onError(listener: TerminalErrorListener): Unsubscribe;
}
