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
  pattern: RegExp;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  ruleName: string;
  reason: string;
}

export const DANGEROUS_RULES: DangerousRule[] = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|--recursive\s+--force)\s+(\/|\/\*|~\/|~|\$HOME)(?:\s|$|;)/i,
    level: 'CRITICAL',
    ruleName: 'RM_ROOT_RECURSIVE',
    reason: '试图递归强制删除根目录或主目录全部数据，将导致系统瞬间损毁。'
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|\/\*|~\/|~)(?:\s|$|;)/i,
    level: 'CRITICAL',
    ruleName: 'RM_ROOT_RECURSIVE_BASIC',
    reason: '试图递归删除根目录或主目录。'
  },
  {
    pattern: /\bmkfs(\.[a-z0-9]+)?(?:\s+|$)/i,
    level: 'CRITICAL',
    ruleName: 'FORMAT_DISK',
    reason: '试图格式化磁盘分区，会导致该磁盘上的全部数据丢失。'
  },
  {
    pattern: /\bdd\s+.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|vd[a-z]|hd[a-z])/i,
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
    pattern: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?(777|000)\s+(\/|\/\*)(?:\s|$|;)/i,
    level: 'CRITICAL',
    ruleName: 'CHMOD_ROOT_777',
    reason: '全盘修改根目录权限为 777 或 000 会彻底破坏系统权限模型与 sudo 功能。'
  },
  {
    pattern: /\bchown\s+-[a-zA-Z]*R[a-zA-Z]*\s+.*\s+(\/|\/\*)(?:\s|$|;)/i,
    level: 'HIGH',
    ruleName: 'CHOWN_ROOT_RECURSIVE',
    reason: '递归改变根目录所有者会导致系统关键程序权限异常。'
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
  }
];

export function checkCommandSafety(command: string): GuardrailCheckResult {
  if (!command || !command.trim()) {
    return { isDangerous: false, level: 'SAFE' };
  }

  const cleanCmd = command.trim();

  for (const rule of DANGEROUS_RULES) {
    if (rule.pattern.test(cleanCmd)) {
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
