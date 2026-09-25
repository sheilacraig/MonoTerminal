import path from 'path';
import type { LocalFsManagerApi } from '../../localFsManager';
import type {
  FileEntry,
  FileReadOptions,
  FileStat,
  FileSystemProvider
} from '../../domain/filesystem/types';

/**
 * FileSystemProvider backed by LocalFsManager (Node.js `fs`).
 * Singleton for SessionType 'local'. Uses UTF-8 strings for read/write
 * to stay 100% compatible with the WebSocket SFTP wire protocol and FileEditorModal.
 */
export class LocalFileSystemProvider implements FileSystemProvider {
  public readonly type = 'local' as const;

  constructor(private readonly localFsManager: LocalFsManagerApi) {}

  public async list(_sessionId: string, dirPath: string): Promise<FileEntry[]> {
    return this.localFsManager.list(dirPath);
  }

  public async stat(_sessionId: string, targetPath: string): Promise<FileStat> {
    if (typeof this.localFsManager.stat === 'function') {
      const item = this.localFsManager.stat(targetPath);
      return {
        path: item.path,
        isDirectory: item.isDirectory,
        size: item.size,
        modifyTime: item.modifyTime,
        permissions: item.permissions
      };
    }

    const parentDir = path.dirname(targetPath);
    const baseName = path.basename(targetPath);
    const entries = this.localFsManager.list(parentDir);
    const found = entries.find(e => e.name === baseName || e.path === targetPath);
    if (!found) {
      throw new Error(`文件不存在: ${targetPath}`);
    }
    return {
      path: found.path,
      isDirectory: found.isDirectory,
      size: found.size,
      modifyTime: found.modifyTime,
      permissions: found.permissions
    };
  }

  public async read(
    _sessionId: string,
    filePath: string,
    _options?: FileReadOptions
  ): Promise<string> {
    return this.localFsManager.readFile(filePath);
  }

  public async write(_sessionId: string, filePath: string, content: string): Promise<void> {
    this.localFsManager.writeFile(filePath, content);
  }

  public async mkdir(_sessionId: string, dirPath: string): Promise<void> {
    this.localFsManager.mkdir(dirPath);
  }

  public async delete(
    _sessionId: string,
    targetPath: string,
    isDirectory: boolean
  ): Promise<void> {
    this.localFsManager.delete(targetPath, isDirectory);
  }

  public async rename(_sessionId: string, from: string, to: string): Promise<void> {
    this.localFsManager.rename(from, to);
  }

  public async chmod(_sessionId: string, targetPath: string, mode: number): Promise<void> {
    const modeOctal = mode.toString(8).padStart(4, '0');
    this.localFsManager.chmod(targetPath, modeOctal);
  }
}
