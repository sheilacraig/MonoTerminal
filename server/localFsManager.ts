import fs from 'fs';
import path from 'path';
import os from 'os';

/** File item shape shared with the SFTP file tree on the frontend. */
export interface LocalFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
  owner?: string;
}

/** Injected (rather than imported) so ws handlers stay unit-testable. */
export interface LocalFsManagerApi {
  list(dirPath: string): LocalFileItem[];
  readFile(filePath: string): string;
  writeFile(filePath: string, content: string): void;
  delete(targetPath: string, isDirectory: boolean): void;
  rename(oldPath: string, newPath: string): void;
  mkdir(dirPath: string): void;
  chmod(targetPath: string, mode: string): void;
}

/** Format a mode integer as an octal permission string (e.g. "0755" or "0644"). */
function formatPermissions(stats: fs.Stats): string {
  return '0' + (stats.mode & 0o777).toString(8);
}

/** Resolve `~` to the user home directory for friendlier path inputs. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Maps the SFTP message protocol onto the local filesystem via Node's
 * `fs` module, giving the file tree native local-disk access.
 */
export class LocalFsManager implements LocalFsManagerApi {
  public list(dirPath: string): LocalFileItem[] {
    const dir = expandHome(dirPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items: LocalFileItem[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stats = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          path: fullPath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          modifyTime: stats.mtimeMs,
          permissions: formatPermissions(stats),
          owner: os.userInfo().username
        });
      } catch {
        // Unreadable entry (permission denied, broken symlink, ...) — skip it
      }
    }
    // Directories first, then files, both alphabetically (case-insensitive)
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return items;
  }

  public readFile(filePath: string): string {
    return fs.readFileSync(expandHome(filePath), 'utf8');
  }

  public writeFile(filePath: string, content: string): void {
    const target = expandHome(filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }

  public delete(targetPath: string, _isDirectory: boolean): void {
    // fs.rm handles files, directories and symlinks uniformly
    fs.rmSync(expandHome(targetPath), { recursive: true, force: false });
  }

  public rename(oldPath: string, newPath: string): void {
    fs.renameSync(expandHome(oldPath), expandHome(newPath));
  }

  public mkdir(dirPath: string): void {
    fs.mkdirSync(expandHome(dirPath), { recursive: true });
  }

  public chmod(targetPath: string, mode: string): void {
    if (process.platform === 'win32') {
      throw new Error('Windows 不支持 chmod 权限修改');
    }
    fs.chmodSync(expandHome(targetPath), parseInt(mode, 8));
  }
}

export const localFsManager = new LocalFsManager();
