import os from 'os';
import path from 'path';
import { CRITICAL_ABSOLUTE_DIRS, isRootLikePath } from '../../../shared/guardrail';
import type { GuardrailAction, RiskAssessment } from '../../domain/security/types';

function normalizePosixLike(rawPath: string): string {
  const trimmed = (rawPath || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    return trimmed.replace(/\/+$/, '');
  }
  return trimmed;
}

function expandTildePosix(normPath: string): string {
  const home = normalizePosixLike(os.homedir());
  if (!home) return normPath;
  if (normPath === '~' || normPath === '$HOME' || normPath === '${HOME}') {
    return home;
  }
  if (normPath.startsWith('~/')) {
    return `${home}/${normPath.slice(2)}`;
  }
  return normPath;
}

/**
 * Resolve a path before applying security rules. SFTP accepts relative paths,
 * so checking only the submitted string lets `../../etc/shadow` evade the
 * protected-file rules. Resolve relative paths against the session workspace;
 * absolute POSIX and Windows paths keep their own root semantics.
 */
function canonicalizeActionPath(rawPath: string, sessionRoot?: string): string {
  const normalized = normalizePosixLike(rawPath);
  if (!normalized) return normalized;

  const expanded = expandTildePosix(normalized);
  const isAbsolute =
    expanded.startsWith('/') || /^[a-zA-Z]:(?:\/|$)/.test(expanded);
  if (isAbsolute) {
    return path.posix.normalize(expanded);
  }

  if (sessionRoot?.trim()) {
    const root = expandTildePosix(normalizePosixLike(sessionRoot));
    if (root.startsWith('/') || /^[a-zA-Z]:(?:\/|$)/.test(root)) {
      return path.posix.resolve(root, expanded);
    }
  }
  return expanded;
}

function canonicalizeActionPaths(action: GuardrailAction): GuardrailAction {
  if (action.kind === 'shell:exec') return action;
  switch (action.kind) {
    case 'fs:rename':
      return {
        ...action,
        oldPath: canonicalizeActionPath(action.oldPath, action.sessionRoot),
        newPath: canonicalizeActionPath(action.newPath, action.sessionRoot)
      };
    default:
      return { ...action, path: canonicalizeActionPath(action.path, action.sessionRoot) };
  }
}

function hasParentTraversal(rawPath: string): boolean {
  return /(?:^|\/)\.\.(?:\/|$)/.test(normalizePosixLike(rawPath));
}

/**
 * Checks if a path is a root directory, critical OS directory, exact user home
 * directory, or credential directory (`~/.ssh`, `~/.gnupg`, `/root/.ssh`, `/home/<user>/.ssh`)
 * while allowing normal files/subdirectories inside `~/...` (P0-1 / P0-2 / P2-I).
 */
export function isProtectedSystemOrHomePath(rawPath: string): boolean {
  if (!rawPath || !rawPath.trim()) return true;
  const trimmed = rawPath.trim();

  if (isRootLikePath(trimmed)) return true;

  const norm = normalizePosixLike(trimmed);
  const lower = norm.toLowerCase();

  // Windows drive root or critical Windows system directories (exact match for c:/users per P2-I)
  if (/^[a-z]:$/i.test(lower) || /^[a-z]:\/\*?$/i.test(lower)) return true;
  if (
    lower === 'c:/windows' ||
    lower.startsWith('c:/windows/') ||
    lower === 'c:/program files' ||
    lower === 'c:/program files (x86)' ||
    lower === 'c:/system32' ||
    lower === 'c:/users'
  ) {
    return true;
  }

  // Exact POSIX critical system directories
  for (const dir of CRITICAL_ABSOLUTE_DIRS) {
    if (lower === `/${dir}`) return true;
  }

  // Exact user home directory or ~/.ssh and ~/.gnupg (local & remote SSH paths)
  if (norm === '~' || norm === '$HOME' || norm === '${HOME}') return true;
  if (
    norm === '~/.ssh' ||
    norm.startsWith('~/.ssh/') ||
    norm === '~/.gnupg' ||
    norm.startsWith('~/.gnupg/')
  ) {
    return true;
  }

  // Remote or local absolute .ssh / .gnupg under /root, /home/<user>, /Users/<user>, C:/Users/<user>
  if (
    /^\/root\/\.(ssh|gnupg)(\/|$)/i.test(norm) ||
    /^\/(?:home|users)\/[^/]+\/\.(ssh|gnupg)(\/|$)/i.test(norm) ||
    /^[a-z]:\/users\/[^/]+\/\.(ssh|gnupg)(\/|$)/i.test(lower)
  ) {
    return true;
  }

  const home = normalizePosixLike(os.homedir());
  if (home) {
    const resolved = normalizePosixLike(path.resolve(trimmed));
    const homeCmp = process.platform === 'win32' ? home.toLowerCase() : home;
    const resCmp = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (resCmp === homeCmp) return true;
    if (
      resCmp === `${homeCmp}/.ssh` ||
      resCmp.startsWith(`${homeCmp}/.ssh/`) ||
      resCmp === `${homeCmp}/.gnupg` ||
      resCmp.startsWith(`${homeCmp}/.gnupg/`)
    ) {
      return true;
    }
  }

  return false;
}

function isCriticalAuthFile(rawPath: string): boolean {
  const norm = normalizePosixLike(rawPath).toLowerCase();
  if (
    norm === '/etc/passwd' ||
    norm === '/etc/shadow' ||
    norm === '/etc/gshadow' ||
    norm === '/etc/sudoers' ||
    norm.startsWith('/etc/sudoers.d/') ||
    norm.startsWith('/etc/ssl/private/')
  ) {
    return true;
  }
  if (
    norm.endsWith('/.ssh/authorized_keys') ||
    norm.endsWith('/.ssh/id_rsa') ||
    norm.endsWith('/.ssh/id_ed25519') ||
    norm.endsWith('/.ssh/id_ecdsa') ||
    norm.endsWith('/.ssh/id_dsa')
  ) {
    return true;
  }
  return false;
}

/**
 * Extended sensitive credential files in dev/ops workspaces (P2-10).
 */
function isSensitiveCredentialFile(rawPath: string): boolean {
  if (isCriticalAuthFile(rawPath)) return true;
  const norm = normalizePosixLike(rawPath).toLowerCase();
  if (
    norm.endsWith('/.aws/credentials') ||
    norm.endsWith('/.kube/config') ||
    norm.endsWith('/.docker/config.json') ||
    norm.endsWith('/.npmrc') ||
    norm.endsWith('/.git-credentials') ||
    norm.endsWith('/.config/gh/hosts.yml') ||
    norm.endsWith('.pem') ||
    norm.endsWith('.key')
  ) {
    return true;
  }
  return false;
}

function isSystemConfigArea(rawPath: string): boolean {
  const norm = normalizePosixLike(rawPath).toLowerCase();
  return (
    norm.startsWith('/etc/') ||
    norm.startsWith('/boot/') ||
    norm.startsWith('/usr/') ||
    norm.startsWith('/lib/systemd/') ||
    norm.startsWith('c:/windows/')
  );
}

/**
 * Checks if a target path escapes the session's initial workspace directory `sessionRoot` (P1-3).
 */
export function isOutsideSessionWorkspace(targetPath: string, sessionRoot?: string): boolean {
  if (!sessionRoot || !sessionRoot.trim()) return false;
  const rawRoot = normalizePosixLike(sessionRoot);
  if (!rawRoot || rawRoot === '~' || rawRoot === '/') return false;

  const expandedRoot = path.posix.normalize(expandTildePosix(rawRoot));
  const rawTarget = normalizePosixLike(targetPath);
  if (!rawTarget) return false;

  let expandedTarget = expandTildePosix(rawTarget);
  const isAbsoluteTarget =
    expandedTarget.startsWith('/') || /^[a-zA-Z]:(\/|$)/.test(expandedTarget);

  if (!isAbsoluteTarget) {
    expandedTarget = path.posix.join(expandedRoot, expandedTarget);
  }
  const normalizedTarget = path.posix.normalize(expandedTarget);

  const isWinStyle =
    /^[a-zA-Z]:/.test(expandedRoot) || /^[a-zA-Z]:/.test(normalizedTarget);
  const rootCmp = (isWinStyle ? expandedRoot.toLowerCase() : expandedRoot).replace(/\/+$/, '');
  const targetCmp = (isWinStyle ? normalizedTarget.toLowerCase() : normalizedTarget).replace(
    /\/+$/,
    ''
  );

  if (targetCmp === rootCmp || targetCmp.startsWith(`${rootCmp}/`)) {
    return false;
  }
  return true;
}

export class FileSystemRiskAnalyzer {
  public analyze(action: Exclude<GuardrailAction, { kind: 'shell:exec' }>): RiskAssessment {
    const submittedAction = action;
    const mutationPaths =
      submittedAction.kind === 'fs:rename'
        ? [submittedAction.oldPath, submittedAction.newPath]
        : submittedAction.kind === 'fs:write' ||
            submittedAction.kind === 'fs:mkdir' ||
            submittedAction.kind === 'fs:delete' ||
            submittedAction.kind === 'fs:chmod'
          ? [submittedAction.path]
          : [];
    if (mutationPaths.some(hasParentTraversal)) {
      return {
        level: 'CRITICAL',
        matchedRule: 'FS_PARENT_PATH_TRAVERSAL',
        reason: '拒绝包含 .. 路径段的文件变更操作；请改用明确的绝对路径。'
      };
    }

    action = canonicalizeActionPaths(action) as Exclude<GuardrailAction, { kind: 'shell:exec' }>;
    switch (action.kind) {
      case 'fs:list':
      case 'fs:stat':
        return { level: 'SAFE' };

      case 'fs:read': {
        if (isSensitiveCredentialFile(action.path)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_READ_SENSITIVE_CREDENTIAL',
            reason: `读取敏感认证、凭据或私钥文件 (${action.path})，需要人工审批确认。`
          };
        }
        return { level: 'SAFE' };
      }

      case 'fs:mkdir': {
        if (isProtectedSystemOrHomePath(action.path)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_MKDIR_PROTECTED',
            reason: `在受保护系统或密钥路径创建目录 (${action.path})，需要确认。`
          };
        }
        if (isOutsideSessionWorkspace(action.path, action.sessionRoot)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_OUTSIDE_WORKSPACE',
            reason: `File mutation/deletion outside session workspace (${action.path} 不在会话工作区 ${action.sessionRoot} 内)。`
          };
        }
        return { level: 'LOW', matchedRule: 'FS_MKDIR' };
      }

      case 'fs:write': {
        if (isCriticalAuthFile(action.path) || isProtectedSystemOrHomePath(action.path)) {
          return {
            level: 'CRITICAL',
            matchedRule: 'FS_WRITE_CRITICAL_PATH',
            reason: `禁止直接覆写核心认证文件、密钥目录或系统受保护根路径 (${action.path})。`
          };
        }
        if (isSystemConfigArea(action.path) || isSensitiveCredentialFile(action.path)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_WRITE_SYSTEM_CONFIG',
            reason: `写入系统级配置文件或敏感凭据 (${action.path})，需要人工审批确认。`
          };
        }
        if (isOutsideSessionWorkspace(action.path, action.sessionRoot)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_OUTSIDE_WORKSPACE',
            reason: `File mutation/deletion outside session workspace (${action.path} 不在会话工作区 ${action.sessionRoot} 内)。`
          };
        }
        return {
          level: 'MEDIUM',
          matchedRule: 'FS_WRITE_FILE',
          reason: `写入或修改文件 (${action.path})，需要确认。`
        };
      }

      case 'fs:delete': {
        if (isCriticalAuthFile(action.path) || isProtectedSystemOrHomePath(action.path)) {
          return {
            level: 'CRITICAL',
            matchedRule: 'FS_DELETE_PROTECTED_PATH',
            reason: `禁止删除根目录、系统关键目录、用户主目录本身或密钥文件 (${action.path})。`
          };
        }
        if (
          isSystemConfigArea(action.path) ||
          isSensitiveCredentialFile(action.path) ||
          action.isDirectory
        ) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_DELETE_HIGH_RISK',
            reason: `删除目录、敏感凭据或系统配置文件 (${action.path})，需要人工审批确认。`
          };
        }
        if (isOutsideSessionWorkspace(action.path, action.sessionRoot)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_OUTSIDE_WORKSPACE',
            reason: `File mutation/deletion outside session workspace (${action.path} 不在会话工作区 ${action.sessionRoot} 内)。`
          };
        }
        return {
          level: 'MEDIUM',
          matchedRule: 'FS_DELETE_FILE',
          reason: `删除文件 (${action.path})，需要人工确认。`
        };
      }

      case 'fs:rename': {
        if (
          isCriticalAuthFile(action.oldPath) ||
          isCriticalAuthFile(action.newPath) ||
          isProtectedSystemOrHomePath(action.oldPath) ||
          isProtectedSystemOrHomePath(action.newPath)
        ) {
          return {
            level: 'CRITICAL',
            matchedRule: 'FS_RENAME_PROTECTED_PATH',
            reason: `禁止重命名或移动系统受保护路径或核心认证文件 (${action.oldPath} -> ${action.newPath})。`
          };
        }
        if (
          isSystemConfigArea(action.oldPath) ||
          isSystemConfigArea(action.newPath) ||
          isSensitiveCredentialFile(action.oldPath) ||
          isSensitiveCredentialFile(action.newPath)
        ) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_RENAME_SYSTEM_CONFIG',
            reason: `移动或重命名系统配置或敏感凭据文件 (${action.oldPath} -> ${action.newPath})，需要人工审批。`
          };
        }
        if (
          isOutsideSessionWorkspace(action.oldPath, action.sessionRoot) ||
          isOutsideSessionWorkspace(action.newPath, action.sessionRoot)
        ) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_OUTSIDE_WORKSPACE',
            reason: `File mutation/deletion outside session workspace (${action.oldPath} -> ${action.newPath} 不在会话工作区 ${action.sessionRoot} 内)。`
          };
        }
        return {
          level: 'MEDIUM',
          matchedRule: 'FS_RENAME_FILE',
          reason: `重命名文件 (${action.oldPath} -> ${action.newPath})，需要确认。`
        };
      }

      case 'fs:chmod': {
        if (isCriticalAuthFile(action.path) || isProtectedSystemOrHomePath(action.path)) {
          return {
            level: 'CRITICAL',
            matchedRule: 'FS_CHMOD_PROTECTED_PATH',
            reason: `禁止修改系统受保护根路径或核心认证文件权限 (${action.path})。`
          };
        }
        const perm = action.mode & 0o777;
        if (perm === 0o777 || perm === 0o000) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_CHMOD_EXTREME_MODE',
            reason: `将文件权限修改为 0${perm.toString(8).padStart(3, '0')} (${action.path}) 存在严重风险，需要人工审批。`
          };
        }
        if (isOutsideSessionWorkspace(action.path, action.sessionRoot)) {
          return {
            level: 'HIGH',
            matchedRule: 'FS_OUTSIDE_WORKSPACE',
            reason: `File mutation/deletion outside session workspace (${action.path} 不在会话工作区 ${action.sessionRoot} 内)。`
          };
        }
        return {
          level: 'MEDIUM',
          matchedRule: 'FS_CHMOD_FILE',
          reason: `修改文件权限 (${action.path} -> 0${perm.toString(8).padStart(3, '0')})，需要确认。`
        };
      }
    }
  }
}
