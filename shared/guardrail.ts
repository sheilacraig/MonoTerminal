/**
 * Shared guardrail rules — single source of truth for both
 * the frontend (src/utils/guardrail.ts) and the backend (server/guardrail.ts).
 *
 * Keep all dangerous-command rules HERE so the two sides can never drift apart.
 */

export interface GuardrailCheckResult {
  isDangerous: boolean;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'SAFE';
  reason?: string;
  matchedRule?: string;
}

export interface DangerousRule {
  /**
   * Regex-based matcher. Simple, but insufficient for commands whose danger
   * depends on flag composition (e.g. `rm -r -f /` vs `rm -rf /`). Prefer
   * `match` for those cases.
   */
  pattern?: RegExp;
  /**
   * Structural matcher. Runs against the trimmed command string; return true
   * to flag as dangerous. Rules may define either `pattern` or `match` (or
   * both — `match` takes precedence when present).
   */
  match?: (cmd: string) => boolean;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  ruleName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Structural analyzers
// ---------------------------------------------------------------------------

/** Privilege escalators that may prefix a dangerous command. */
export const PRIVILEGE_ESCALATORS = new Set(['sudo', 'doas', 'pkexec']);

/**
 * Absolute paths whose recursive deletion is universally catastrophic. Matched
 * exactly (or with a trailing `/` or `/*`), never as a prefix — so `/etc/nginx`
 * stays safe while `/etc` and `/etc/*` are flagged.
 */
export const CRITICAL_ABSOLUTE_DIRS = [
  'etc',
  'usr',
  'var',
  'bin',
  'sbin',
  'boot',
  'lib',
  'lib64',
  'dev',
  'proc',
  'sys',
  'home',
  'root',
  'opt',
  'srv',
  'run'
  // `tmp` deliberately omitted — `rm -rf /tmp/*` is a common legitimate
  // cleanup and would trigger a false positive.
];

/** Split a shell command line into segments on newlines, `&&`, `||`, `;`, and `|`. */
export function splitShellSegments(cmd: string): string[] {
  return cmd
    .split(/[\r\n]+|&&|\|\||[;|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Naive whitespace tokenizer that also strips one layer of surrounding quotes. */
export function tokenize(segment: string): string[] {
  return segment
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.replace(/^["']|["']$/g, ''));
}

/** Extract the primary command binary token and argument tokens after any escalators (sudo, etc.) */
export function extractCommandInvocation(
  segment: string
): { binary: string; args: string[] } | null {
  const tokens = tokenize(segment);
  let i = 0;

  // Skip any leading privilege escalator plus its own flags
  while (i < tokens.length && PRIVILEGE_ESCALATORS.has(tokens[i].toLowerCase())) {
    i++;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      // `sudo -u <user>` / `sudo -C <fd>` take a value; skip it too
      if (/^-[a-zA-Z]*[uC]$/.test(tokens[i]) && i + 1 < tokens.length) i++;
      i++;
    }
  }
  if (i >= tokens.length) return null;
  return {
    binary: tokens[i],
    args: tokens.slice(i + 1)
  };
}

/** True if the token looks like a filesystem root or first-level wildcard. */
export function isRootLikePath(rawToken: string): boolean {
  if (!rawToken) return false;
  const t = rawToken.replace(/^["']|["']$/g, '').trim();
  if (!t) return false;

  // Bare root or root wildcard: `/`, `/*`, `/*/…`
  if (t === '/' || t === '/*') return true;
  if (/^\/\*(\/|$)/.test(t)) return true;

  // Home-directory shorthands: `~`, `~/`, `~/*`, `$HOME`, `$HOME/`, `$HOME/*`,
  // `${HOME}`, `${HOME}/`, `${HOME}/*`
  if (/^(?:~|\$HOME|\$\{HOME\})(?:\/?\*?)?$/.test(t)) return true;

  // Critical absolute system directories (exact, or with trailing / or /*)
  for (const d of CRITICAL_ABSOLUTE_DIRS) {
    if (t === `/${d}` || t === `/${d}/` || t === `/${d}/*`) return true;
  }

  return false;
}

export interface RmInvocation {
  recursive: boolean;
  force: boolean;
  noPreserveRoot: boolean;
  targets: string[];
}

/**
 * Locate the first `rm` invocation in a shell command (optionally behind a
 * privilege escalator) and aggregate its flags across separate clusters, so
 * that all of the following are recognised as recursive + force:
 *
 *   rm -rf /            rm -fr /            rm -r -f /        rm -f -r /
 *   rm --recursive --force /                rm -r --force /
 *   sudo rm -rf /       sudo -u root rm -r -f /
 *   rm -rf --no-preserve-root /
 *
 * Returns null when no `rm` invocation is present.
 */
export function analyzeRmCommand(cmd: string): RmInvocation | null {
  for (const segment of splitShellSegments(cmd)) {
    const inv = extractCommandInvocation(segment);
    if (!inv || inv.binary !== 'rm') continue;

    let recursive = false;
    let force = false;
    let noPreserveRoot = false;
    const targets: string[] = [];
    let sawDoubleDash = false;

    for (const t of inv.args) {
      if (sawDoubleDash) {
        targets.push(t);
        continue;
      }
      if (t === '--') {
        sawDoubleDash = true;
        continue;
      }
      if (t === '--recursive') {
        recursive = true;
        continue;
      }
      if (t === '--force') {
        force = true;
        continue;
      }
      if (t === '--no-preserve-root') {
        noPreserveRoot = true;
        continue;
      }
      if (t === '--preserve-root') {
        noPreserveRoot = false;
        continue;
      }
      if (t.startsWith('--')) continue; // ignore other long options (e.g. --one-file-system)
      if (t.startsWith('-') && t.length > 1) {
        // Short-flag cluster: -rf, -fr, -rvf, -R, ...
        const letters = t.slice(1);
        if (/[rR]/.test(letters)) recursive = true;
        if (letters.includes('f')) force = true;
        continue;
      }
      targets.push(t);
    }

    return { recursive, force, noPreserveRoot, targets };
  }
  return null;
}

/** True when the command performs a recursive delete against a root-like path. */
function matchesRecursiveRootDelete(cmd: string): boolean {
  const info = analyzeRmCommand(cmd);
  if (!info || !info.recursive) return false;
  return info.targets.some(isRootLikePath);
}

/** True when the command executes mkfs with a recognised filesystem driver as the command binary. */
const MKFS_FS_REGEX = /^mkfs\.(ext[234]|xfs|btrfs|vfat|fat(32)?|ntfs|exfat|cramfs|minix|msdos|f2fs|bfs|udf|jfs|reiserfs|nilfs2)$/i;

function matchesFormatDisk(cmd: string): boolean {
  for (const segment of splitShellSegments(cmd)) {
    const inv = extractCommandInvocation(segment);
    if (!inv) continue;
    const bin = inv.binary.toLowerCase();
    if (bin === 'mkfs' || MKFS_FS_REGEX.test(bin)) {
      return true;
    }
  }
  return false;
}

/** True when chmod (with or without -R on root, or with -R on critical system dirs) targets root/critical dirs with 777 or 000. */
function matchesChmodRoot(cmd: string): boolean {
  for (const segment of splitShellSegments(cmd)) {
    const inv = extractCommandInvocation(segment);
    if (!inv || inv.binary !== 'chmod') continue;
    const hasRecursive = inv.args.some(
      a => a === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(a)
    );
    const hasDangerMode = inv.args.some(
      a => a === '777' || a === '000' || a === 'a+rwx' || a.toLowerCase() === 'u=rwx,g=rwx,o=rwx'
    );
    const targetsRoot = inv.args.some(isRootLikePath);
    const targetsBareRoot = inv.args.some(a => {
      const t = a.replace(/^["']|["']$/g, '').trim();
      return t === '/' || t === '/*' || /^\/\*(\/|$)/.test(t);
    });

    if (hasDangerMode && (targetsBareRoot || (hasRecursive && targetsRoot))) {
      return true;
    }
  }
  return false;
}

/** True when dd directly overwrites raw block devices (of=/dev/sd*, etc.). */
function matchesOverwriteRawDisk(cmd: string): boolean {
  for (const segment of splitShellSegments(cmd)) {
    const inv = extractCommandInvocation(segment);
    if (!inv || inv.binary !== 'dd') continue;
    const hasRawDiskTarget = inv.args.some(a =>
      /^of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|vd[a-z]|hd[a-z])/i.test(a)
    );
    if (hasRawDiskTarget) {
      return true;
    }
  }
  return false;
}

/** True when chown -R targets root or critical system directories. */
function matchesChownRoot(cmd: string): boolean {
  for (const segment of splitShellSegments(cmd)) {
    const inv = extractCommandInvocation(segment);
    if (!inv || inv.binary !== 'chown') continue;
    const hasRecursive = inv.args.some(
      a => a === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(a)
    );
    const targetsRoot = inv.args.some(isRootLikePath);
    if (hasRecursive && targetsRoot) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rule set
// ---------------------------------------------------------------------------

export const DANGEROUS_RULES: DangerousRule[] = [
  {
    // Structural matcher — handles every split-flag / escalator / long-option
    // permutation that the previous regex-based rules missed. See
    // `analyzeRmCommand` for the recognised forms.
    match: matchesRecursiveRootDelete,
    level: 'CRITICAL',
    ruleName: 'RM_ROOT_RECURSIVE',
    reason: '试图递归删除根目录或系统关键目录，将导致系统瞬间损毁。'
  },
  {
    // `rm -rf --no-preserve-root` targeting anything at all is a red flag on
    // modern coreutils — GNU rm refuses to touch `/` unless this option is
    // given, so its presence signals deliberate destructive intent.
    match: cmd => {
      const info = analyzeRmCommand(cmd);
      return Boolean(info && info.noPreserveRoot);
    },
    level: 'CRITICAL',
    ruleName: 'RM_NO_PRESERVE_ROOT',
    reason: '使用了 --no-preserve-root 参数解除了 rm 对根目录的内建保护，极度危险。'
  },
  {
    match: matchesFormatDisk,
    level: 'CRITICAL',
    ruleName: 'FORMAT_DISK',
    reason: '试图格式化磁盘分区，会导致该磁盘上的全部数据丢失。'
  },
  {
    match: matchesOverwriteRawDisk,
    level: 'CRITICAL',
    ruleName: 'OVERWRITE_RAW_DISK',
    reason: '试图通过 dd 直接覆写物理或虚拟底层磁盘，会破坏分区表和系统。'
  },
  {
    pattern: />\s*\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|vd[a-z]|null\s+;\s*rm)/i,
    level: 'CRITICAL',
    ruleName: 'REDIRECT_TO_DISK',
    reason: '试图将重定向数据写入原始磁盘设备。'
  },
  {
    match: matchesChmodRoot,
    level: 'CRITICAL',
    ruleName: 'CHMOD_ROOT_777',
    reason: '全盘修改根目录或关键系统目录权限为 777 或 000 会彻底破坏系统权限模型与 sudo 功能。'
  },
  {
    match: matchesChownRoot,
    level: 'HIGH',
    ruleName: 'CHOWN_ROOT_RECURSIVE',
    reason: '递归改变根目录或关键系统目录所有者会导致系统关键程序权限异常。'
  },
  {
    pattern: /(:(){:|:&};:|:\(\)\s*\{\s*:\|:&\s*\};:)/,
    level: 'CRITICAL',
    ruleName: 'FORK_BOMB',
    reason: '经典的 Bash Fork 炸弹，会耗尽系统进程表导致系统冻结。'
  },
  {
    pattern: /\biptables\s+(-F|-X|--flush)\b/i,
    level: 'HIGH',
    ruleName: 'FLUSH_FIREWALL',
    reason: '清空防火墙规则可能导致服务器暴露或管理端口被封锁。'
  },
  {
    pattern: /\bufw\s+(reset|disable)\b/i,
    level: 'HIGH',
    ruleName: 'UFW_RESET',
    reason: '重置或关闭 UFW 防火墙可能导致远程连接断开。'
  },
  {
    pattern: /\b(fdisk|parted)\s+\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|vd[a-z])\b/i,
    level: 'HIGH',
    ruleName: 'PARTITION_ALTERATION',
    reason: '修改物理磁盘分区表。'
  },
  {
    pattern: />\s*\/etc\/(passwd|shadow|sudoers)\b/i,
    level: 'CRITICAL',
    ruleName: 'OVERWRITE_SYSTEM_AUTH_FILES',
    reason: '覆盖系统核心认证用户文件，将导致无法登录或权限彻底失效。'
  },
  {
    pattern:
      /\b(Remove-Item|ri)\b(?=.*-(?:Recurse|r)\b)(?=.*([a-zA-Z]:[\\/]|\b[a-zA-Z]:|\$env:(?:SystemRoot|windir|ProgramFiles)))/i,
    level: 'CRITICAL',
    ruleName: 'WIN_POWERSHELL_DELETE_ROOT',
    reason: '试图使用 PowerShell 递归删除 Windows 磁盘根目录或关键系统目录。'
  },
  {
    pattern: /\b(del|erase)\b(?=.*\/s\b)(?=.*([a-zA-Z]:[\\/]|\b[a-zA-Z]:|\\\*|\/\*))/i,
    level: 'CRITICAL',
    ruleName: 'WIN_CMD_DELETE_ROOT',
    reason: '试图在 CMD 中批量静默删除 Windows 驱动器或根目录下的全部文件。'
  },
  {
    pattern: /\b(rmdir|rd)\b(?=.*\/s\b)(?=.*([a-zA-Z]:[\\/]|\b[a-zA-Z]:))/i,
    level: 'CRITICAL',
    ruleName: 'WIN_CMD_RMDIR_ROOT',
    reason: '试图在 CMD 中递归删除 Windows 驱动器根目录或关键目录。'
  },
  {
    pattern: /\bformat\s+[a-zA-Z]:(?:\s|$)/i,
    level: 'CRITICAL',
    ruleName: 'WIN_FORMAT_DISK',
    reason: '试图格式化 Windows 驱动器分区，将导致该磁盘上的数据全部丢失。'
  },
  {
    pattern: /\b(Stop-Computer|Restart-Computer)\b(?=.*-Force\b)/i,
    level: 'HIGH',
    ruleName: 'WIN_FORCE_SHUTDOWN',
    reason: '试图强行关闭或重启系统，可能导致未保存数据丢失或服务中断。'
  }
];

export function checkCommandSafety(command: string): GuardrailCheckResult {
  if (!command || !command.trim()) {
    return { isDangerous: false, level: 'SAFE' };
  }

  const cleanCmd = command.trim();

  for (const rule of DANGEROUS_RULES) {
    const matched = rule.match
      ? rule.match(cleanCmd)
      : rule.pattern
        ? rule.pattern.test(cleanCmd)
        : false;
    if (matched) {
      return {
        isDangerous: true,
        level: rule.level,
        reason: rule.reason,
        matchedRule: rule.ruleName
      };
    }
  }

  return {
    isDangerous: false,
    level: 'SAFE'
  };
}
