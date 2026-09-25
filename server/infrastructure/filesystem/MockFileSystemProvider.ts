import type { MockSessionEntry } from '../../ws/types';
import type {
  FileEntry,
  FileReadOptions,
  FileStat,
  FileSystemProvider
} from '../../domain/filesystem/types';

/**
 * FileSystemProvider backed by MockFileSystem (shared per mock session).
 * Singleton for SessionType 'mock'.
 */
export class MockFileSystemProvider implements FileSystemProvider {
  public readonly type = 'mock' as const;

  constructor(private readonly mockSessions: Map<string, MockSessionEntry>) {}

  private getFs(sessionId: string) {
    const entry = this.mockSessions.get(sessionId);
    if (!entry) {
      throw new Error(`仿真会话不存在: ${sessionId}`);
    }
    return entry.fs;
  }

  public async list(sessionId: string, dirPath: string): Promise<FileEntry[]> {
    return this.getFs(sessionId).list(dirPath);
  }

  public async stat(sessionId: string, targetPath: string): Promise<FileStat> {
    const fs = this.getFs(sessionId);
    const clean = targetPath.replace(/\/+$/, '') || '/';
    if (clean === '/') {
      return {
        path: '/',
        isDirectory: true,
        size: 4096,
        modifyTime: Date.now(),
        permissions: '0755'
      };
    }

    const lastSlash = clean.lastIndexOf('/');
    const parentDir = lastSlash <= 0 ? '/' : clean.slice(0, lastSlash);
    const baseName = clean.slice(lastSlash + 1);
    const items = fs.list(parentDir);
    const found = items.find(i => i.name === baseName || i.path === clean);
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
    sessionId: string,
    filePath: string,
    _options?: FileReadOptions
  ): Promise<string> {
    return this.getFs(sessionId).readFile(filePath);
  }

  public async write(sessionId: string, filePath: string, content: string): Promise<void> {
    this.getFs(sessionId).writeFile(filePath, content);
  }

  public async mkdir(sessionId: string, dirPath: string): Promise<void> {
    this.getFs(sessionId).mkdir(dirPath);
  }

  public async delete(
    sessionId: string,
    targetPath: string,
    _isDirectory: boolean
  ): Promise<void> {
    this.getFs(sessionId).delete(targetPath);
  }

  public async rename(sessionId: string, from: string, to: string): Promise<void> {
    this.getFs(sessionId).rename(from, to);
  }

  public async chmod(sessionId: string, targetPath: string, mode: number): Promise<void> {
    const modeOctal = '0' + (mode & 0o777).toString(8).padStart(3, '0');
    this.getFs(sessionId).chmod(targetPath, modeOctal);
  }
}
