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
  stat?(targetPath: string): LocalFileItem;
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
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

const POSIX_PROTECTED_DIRS = new Set([
  '/etc',
  '/usr',
  '/var',
  '/bin',
  '/sbin',
  '/boot',
  '/lib',
  '/lib64',
  '/dev',
  '/proc',
  '/sys',
  '/home',
  '/root',
  '/opt',
  '/srv',
  '/run'
]);

function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved || '/';
}

/**
 * Check whether a target path is a protected root, OS critical directory,
 * exact user home root, or sensitive credential directory (`~/.ssh`, `~/.gnupg`).
 * Normal subdirectories inside the user's home directory (e.g. `~/old-project`) are allowed.
 */
export function isProtectedLocalDeletePath(rawPath: string): { blocked: boolean; reason?: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { blocked: true, reason: '拒绝删除空路径' };
  }

  // Raw POSIX root or top-level system dir checks (works cross-platform in unit tests)
  const cleanPosix = trimmed.replace(/\/+$/, '') || '/';
  if (cleanPosix === '/' || /^[a-zA-Z]:[\\/]?$/.test(trimmed)) {
    return { blocked: true, reason: `拒绝删除文件系统根目录: ${rawPath}` };
  }
  if (POSIX_PROTECTED_DIRS.has(cleanPosix)) {
    return { blocked: true, reason: `拒绝删除系统关键目录: ${rawPath}` };
  }

  // Windows critical paths (even when tested on non-Windows or vice-versa)
  const lowerBackslash = trimmed.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  if (
    /^[a-z]:\\(windows|program files|program files \(x86\)|users|system32)$/.test(lowerBackslash)
  ) {
    return { blocked: true, reason: `拒绝删除 Windows 系统关键目录: ${rawPath}` };
  }

  const expanded = expandHome(trimmed);
  const resolved = path.resolve(expanded);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    return { blocked: true, reason: `拒绝删除文件系统根目录: ${rawPath}` };
  }

  const normTarget = normalizeForCompare(resolved);
  const homeDir = os.homedir();
  const normHome = normalizeForCompare(homeDir);

  if (normTarget === normHome) {
    return { blocked: true, reason: `拒绝直接删除用户主目录根路径: ${homeDir}` };
  }

  const protectedHomeSubdirs = ['.ssh', '.gnupg'].map(sub =>
    normalizeForCompare(path.join(homeDir, sub))
  );
  if (protectedHomeSubdirs.includes(normTarget)) {
    return { blocked: true, reason: `拒绝删除主目录敏感凭据目录: ${rawPath}` };
  }

  return { blocked: false };
}

/**
 * Maps the SFTP message protocol onto the local filesystem via Node's
 * `fs` module, giving the file tree native local-disk access.
 */
export class LocalFsManager implements LocalFsManagerApi {
  public list(dirPath: string): LocalFileItem[] {
    const dir = expandHome(dirPath);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const MAX_DIR_ENTRIES = 2000;
    const limitedEntries =
      entries.length > MAX_DIR_ENTRIES ? entries.slice(0, MAX_DIR_ENTRIES) : entries;
    const items: LocalFileItem[] = [];
    for (const entry of limitedEntries) {
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

  public stat(targetPath: string): LocalFileItem {
    const target = path.resolve(expandHome(targetPath));
    const stats = fs.statSync(target);
    return {
      name: path.basename(target) || target,
      path: target,
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modifyTime: stats.mtimeMs,
      permissions: formatPermissions(stats),
      owner: os.userInfo().username
    };
  }

  public readFile(filePath: string): string {
    const target = expandHome(filePath);
    const stats = fs.statSync(target);
    const MAX_READ_SIZE = 10 * 1024 * 1024; // 10MB
    if (stats.size > MAX_READ_SIZE) {
      throw new Error(
        `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，在线编辑最大支持 10MB，请使用下载查看`
      );
    }
    return fs.readFileSync(target, 'utf8');
  }

  public writeFile(filePath: string, content: string): void {
    const target = expandHome(filePath);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(target)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
  }

  public delete(targetPath: string, isDirectory: boolean): void {
    const check = isProtectedLocalDeletePath(targetPath);
    if (check.blocked) {
      throw new Error(check.reason || `禁止删除受保护路径: ${targetPath}`);
    }

    const resolved = path.resolve(expandHome(targetPath));
    const stats = fs.lstatSync(resolved);
    const actualIsDir = stats.isDirectory();
    if (actualIsDir !== Boolean(isDirectory)) {
      throw new Error(
        actualIsDir
          ? `目标路径是目录而非文件，已拒绝按普通文件删除: ${targetPath}`
          : `目标路径是文件而非目录，已拒绝按目录删除: ${targetPath}`
      );
    }

    fs.rmSync(resolved, { recursive: actualIsDir, force: false });
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

