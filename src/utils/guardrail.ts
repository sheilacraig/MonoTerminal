export interface GuardrailCheckResult {
  isDangerous: boolean;
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'SAFE';
  reason?: string;
  matchedRule?: string;
}

export const DANGEROUS_PATTERNS = [
  {
    regex: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|--recursive\s+--force)\s+(\/|\/\*|~\/|~|\$HOME)(?:\s|$|;)/i,
    reason: '试图递归强制删除根目录或主目录全部数据，将导致系统瞬间崩溃。',
    level: 'CRITICAL' as const
  },
  {
    regex: /\bmkfs(\.[a-z0-9]+)?(?:\s+|$)/i,
    reason: '试图格式化底层磁盘或文件系统，会导致磁盘全部数据丢失。',
    level: 'CRITICAL' as const
  },
  {
    regex: /\bdd\s+.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9]|vd[a-z]|hd[a-z])/i,
    reason: '试图直接向物理或虚拟磁盘覆写底层原始二进制数据。',
    level: 'CRITICAL' as const
  },
  {
    regex: /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?(777|000)\s+(\/|\/\*)(?:\s|$|;)/i,
    reason: '全盘修改根目录权限为 777 或 000，会导致系统安全模型彻底损坏。',
    level: 'CRITICAL' as const
  },
  {
    regex: /(:(){:|:&};:|:\(\)\s*\{\s*:\|:&\s*\};:)/,
    reason: 'Bash Fork 炸弹攻击代码，会导致系统进程耗尽并卡死。',
    level: 'CRITICAL' as const
  },
  {
    regex: /\biptables\s+(-F|-X|--flush)\b/i,
    reason: '清空防火墙规则可能导致系统完全暴露或远程管理连接失联。',
    level: 'HIGH' as const
  },
  {
    regex: />\s*\/etc\/(passwd|shadow|sudoers)\b/i,
    reason: '试图覆盖关键系统身份验证文件。',
    level: 'CRITICAL' as const
  }
];

export function checkCommandSafety(command: string): GuardrailCheckResult {
  if (!command || !command.trim()) {
    return { isDangerous: false, level: 'SAFE' };
  }

  const clean = command.trim();
  for (const item of DANGEROUS_PATTERNS) {
    if (item.regex.test(clean)) {
      return {
        isDangerous: true,
        level: item.level,
        reason: item.reason
      };
    }
  }

  return { isDangerous: false, level: 'SAFE' };
}
