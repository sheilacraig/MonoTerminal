import type { SshManager } from '../../sshManager';
import type {
  FileEntry,
  FileReadOptions,
  FileStat,
  FileSystemProvider
} from '../../domain/filesystem/types';

/**
 * FileSystemProvider backed by SshManager SFTP subsystem.
 * Singleton for SessionType 'ssh'.
 */
export class SftpFileSystemProvider implements FileSystemProvider {
  public readonly type = 'ssh' as const;

  constructor(private readonly sshManager: SshManager) {}

  public async list(sessionId: string, dirPath: string): Promise<FileEntry[]> {
    return this.sshManager.sftpList(sessionId, dirPath);
  }

  public async stat(sessionId: string, targetPath: string): Promise<FileStat> {
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
    const list = await this.sshManager.sftpList(sessionId, parentDir);
    const found = list.find(item => item.name === baseName || item.path === clean);
    if (!found) {
      throw new Error(`远端路径不存在: ${targetPath}`);
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
    return this.sshManager.sftpReadFile(sessionId, filePath);
  }

  public async write(sessionId: string, filePath: string, content: string): Promise<void> {
    await this.sshManager.sftpWriteFile(sessionId, filePath, content);
  }

  public async mkdir(sessionId: string, dirPath: string): Promise<void> {
    await this.sshManager.sftpMkdir(sessionId, dirPath);
  }

  public async delete(
    sessionId: string,
    targetPath: string,
    isDirectory: boolean
  ): Promise<void> {
    await this.sshManager.sftpDelete(sessionId, targetPath, isDirectory);
  }

  public async rename(sessionId: string, from: string, to: string): Promise<void> {
    await this.sshManager.sftpRename(sessionId, from, to);
  }

  public async chmod(sessionId: string, targetPath: string, mode: number): Promise<void> {
    const modeOctal = mode.toString(8);
    await this.sshManager.sftpChmod(sessionId, targetPath, modeOctal);
  }
}
