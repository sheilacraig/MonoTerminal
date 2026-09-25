import type { SessionType } from '../session/types';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
  owner?: string;
}

export type FileItem = FileEntry;

export interface FileStat {
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
}

export interface FileReadOptions {
  /**
   * When true, marks the read as an internal system probe (e.g. ContextEngine
   * reading `.git/HEAD` or Verifier checking file state) so EventEmittingFsProvider
   * suppresses FileOpenedEvent and avoids event self-excitation loops.
   */
  internal?: boolean;
}

export interface FileSystemProvider {
  readonly type: SessionType;
  list(sessionId: string, path: string): Promise<FileEntry[]>;
  stat(sessionId: string, path: string): Promise<FileStat>;
  read(sessionId: string, path: string, options?: FileReadOptions): Promise<string>;
  write(sessionId: string, path: string, content: string): Promise<void>;
  mkdir(sessionId: string, path: string): Promise<void>;
  delete(sessionId: string, path: string, isDirectory: boolean): Promise<void>;
  rename(sessionId: string, from: string, to: string): Promise<void>;
  chmod(sessionId: string, path: string, mode: number): Promise<void>;
}
