import path from 'path';
import {
  checkCommandSafety,
  extractCommandInvocation,
  PRIVILEGE_ESCALATORS,
  splitShellSegments,
  tokenize
} from '../../../shared/guardrail';
import type { RiskAssessment, ShellExecAction } from '../../domain/security/types';

const READ_ONLY_SYSTEMCTL_SUBCOMMANDS = new Set([
  'status',
  'is-active',
  'is-enabled',
  'is-failed',
  'list-units',
  'list-unit-files',
  'list-timers',
  'show',
  'cat',
  'help'
]);

const READ_ONLY_DOCKER_SUBCOMMANDS = new Set([
  'ps',
  'logs',
  'inspect',
  'stats',
  'images',
  'version',
  'info',
  'top',
  'port',
  'network',
  'volume'
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'branch',
  'show',
  'rev-parse',
  'remote',
  'tag',
  'describe'
]);

const HIGH_RISK_BINARIES = new Set([
  'rm',
  'rmdir',
  'rd',
  'del',
  'erase',
  'remove-item',
  'ri',
  'kill',
  'pkill',
  'killall',
  'stop-process',
  'spps',
  'taskkill',
  'reboot',
  'shutdown',
  'poweroff',
  'halt',
  'init',
  'restart-computer',
  'stop-computer',
  'userdel',
  'usermod',
  'passwd',
  'chown',
  'icacls',
  'takeown',
  // Windows & PowerShell disk/boot/registry/service/policy high-risk commands (P1-2)
  'format-volume',
  'clear-disk',
  'initialize-disk',
  'diskpart',
  'bcdedit',
  'vssadmin',
  'reg',
  'sc',
  'sc.exe',
  'set-executionpolicy',
  'invoke-expression',
  'iex'
]);

/**
 * Wrapper / indirect command executors whose real payload is hidden in arguments or stdin (P1-2).
 * Always elevated to HIGH so human approval is required.
 */
const WRAPPER_EXECUTORS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'csh',
  'cmd',
  'powershell',
  'pwsh',
  'eval',
  'iex',
  'invoke-expression',
  'xargs',
  'find'
]);

const MEDIUM_RISK_BINARIES = new Set([
  'mv',
  'move',
  'move-item',
  'mi',
  'cp',
  'copy',
  'copy-item',
  'cpi',
  'chmod',
  'touch',
  'mkdir',
  'md',
  'new-item',
  'ni',
  'set-content',
  'add-content',
  'ac',
  'out-file',
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'apk',
  'pacman',
  'zypper',
  'pip',
  'pip3',
  'npm',
  'pnpm',
  'yarn',
  'useradd',
  'groupadd',
  'crontab',
  'sed',
  'tee'
]);

function normalizeBinaryName(rawBin: string): string {
  const base = path.posix.basename(rawBin.replace(/\\/g, '/')).toLowerCase();
  return base.endsWith('.exe') && base !== 'sc.exe' ? base.slice(0, -4) : base;
}

function hasFileWriteRedirection(segment: string): boolean {
  // Strip harmless 2>&1, >&2, >/dev/null, 2>/dev/null
  const sanitized = segment
    .replace(/[0-9]*>&[0-9]+/g, '')
    .replace(/[0-9]*>>?\s*\/dev\/null\b/g, '');
  return /(?:^|[^<>])>>?\s*[^\s&|;]+/.test(sanitized);
}

/** Remove shell compound-command markers exposed by the simple segment split. */
function normalizeShellClause(segment: string): string {
  return segment
    .trim()
    .replace(/^(?:(?:then|do|else)\b\s*|[{}()]\s*)+/i, '')
    .replace(/\s*(?:(?:fi|done|esac)\b|[{}()])+\s*$/i, '')
    .trim();
}

function hasWindowsRunAsElevation(bin: string, args: string[]): boolean {
  if (bin !== 'start-process' && bin !== 'saps' && bin !== 'start') {
    return false;
  }
  for (let i = 0; i < args.length; i++) {
    const lower = args[i].toLowerCase();
    if (lower === '-verb' && args[i + 1]?.toLowerCase() === 'runas') {
      return true;
    }
    if (lower === '-verbrunas' || lower === 'runas') {
      return true;
    }
  }
  return false;
}

function isInlineScriptExecution(bin: string, args: string[]): boolean {
  if (bin === 'python' || bin === 'python3' || bin === 'py') {
    return args.includes('-c');
  }
  if (bin === 'node' || bin === 'deno' || bin === 'bun') {
    return args.includes('-e') || args.includes('--eval');
  }
  if (bin === 'perl' || bin === 'ruby' || bin === 'php') {
    return args.includes('-e') || args.includes('-r');
  }
  return false;
}

export class ShellRiskAnalyzer {
  public analyze(action: ShellExecAction): RiskAssessment {
    const command = (action.command || '').trim();
    if (!command) {
      return { level: 'SAFE' };
    }

    // 1. Check shared catastrophic / high-risk rules first (P1-10)
    const baseCheck = checkCommandSafety(command);
    if (baseCheck.isDangerous) {
      return {
        level: baseCheck.level,
        reason: baseCheck.reason,
        matchedRule: baseCheck.matchedRule
      };
    }

    // 2. Structural segment analysis for Agent tool execution
    let highestLevel: RiskAssessment = { level: 'SAFE' };
    const elevate = (candidate: RiskAssessment) => {
      const rank: Record<RiskAssessment['level'], number> = {
        SAFE: 0,
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        CRITICAL: 4
      };
      if (rank[candidate.level] > rank[highestLevel.level]) {
        highestLevel = candidate;
      }
    };

    // Shell command substitution executes nested commands before the outer
    // command. The shared command checker tokenizes only the outer invocation,
    // so `echo $(rm -rf /)` would otherwise look like a harmless `echo`.
    // Analyze extracted payloads separately; unknown/complex substitutions
    // still require approval instead of silently receiving SAFE.
    const substitutionPattern = /\$\((?!\()([^()]*)\)|`([^`]*)`|[<>]\(([^()]*)\)/g;
    let hasSubstitution = false;
    for (const match of command.matchAll(substitutionPattern)) {
      hasSubstitution = true;
      const nestedCommand = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!nestedCommand) continue;

      const nestedAssessment = this.analyze({
        ...action,
        command: nestedCommand
      });
      if (nestedAssessment.level === 'CRITICAL') {
        return {
          ...nestedAssessment,
          reason: `命令替换中包含灾难性操作：${nestedAssessment.reason || nestedCommand}`
        };
      }
      elevate({
        level: 'HIGH',
        matchedRule: 'SHELL_COMMAND_SUBSTITUTION',
        reason: '命令包含会执行嵌套 shell 命令的替换表达式，需要人工审批确认。'
      });
    }
    if (/\$\(\(/.test(command)) {
      hasSubstitution = true;
      elevate({
        level: 'HIGH',
        matchedRule: 'SHELL_ARITHMETIC_EXPANSION',
        reason: '命令包含无法静态解析的 shell 算术展开，需要人工审批确认。'
      });
    }
    if (hasSubstitution && highestLevel.level === 'SAFE') {
      elevate({
        level: 'HIGH',
        matchedRule: 'SHELL_COMMAND_SUBSTITUTION',
        reason: '命令包含无法安全解析的替换表达式，需要人工审批确认。'
      });
    }

    for (const rawSegment of splitShellSegments(command)) {
      const segment = normalizeShellClause(rawSegment);
      if (!segment) continue;

      // Re-run catastrophic checks on each normalized shell clause. The
      // shared checker sees `then rm -rf /` as a command named `then` unless
      // compound-control markers are stripped first.
      const clauseCheck = checkCommandSafety(segment);
      if (clauseCheck.isDangerous) {
        return {
          level: clauseCheck.level,
          reason: clauseCheck.reason,
          matchedRule: clauseCheck.matchedRule
        };
      }

      const tokens = tokenize(segment);
      if (tokens.length === 0) continue;

      if (PRIVILEGE_ESCALATORS.has(tokens[0].toLowerCase())) {
        elevate({
          level: 'HIGH',
          matchedRule: 'PRIVILEGE_ESCALATION',
          reason: `命令包含提权操作 (${tokens[0]})，需要人工审批确认。`
        });
      }

      if (hasFileWriteRedirection(segment)) {
        elevate({
          level: 'MEDIUM',
          matchedRule: 'SHELL_REDIRECT_WRITE',
          reason: '命令包含重定向写入文件操作，需要确认。'
        });
      }

      const inv = extractCommandInvocation(segment);
      if (!inv) continue;

      const rawBinLower = inv.binary.toLowerCase();
      const bin = normalizeBinaryName(rawBinLower);
      const firstSub = inv.args.find(a => !a.startsWith('-'))?.toLowerCase();

      if (hasWindowsRunAsElevation(bin, inv.args)) {
        elevate({
          level: 'HIGH',
          matchedRule: 'PRIVILEGE_ESCALATION',
          reason: '命令包含 Windows UAC 提权操作 (Start-Process -Verb RunAs)，需要人工审批确认。'
        });
        continue;
      }

      if (bin === 'systemctl' || bin === 'service') {
        const sub =
          bin === 'systemctl' ? firstSub : inv.args[1]?.toLowerCase() || firstSub;
        if (!sub || !READ_ONLY_SYSTEMCTL_SUBCOMMANDS.has(sub)) {
          elevate({
            level: 'MEDIUM',
            matchedRule: 'SERVICE_STATE_MUTATION',
            reason: `变更系统服务状态 (${bin} ${sub || ''})，需要人工确认。`
          });
        }
        continue;
      }

      if (bin === 'docker' || bin === 'podman') {
        if (!firstSub || !READ_ONLY_DOCKER_SUBCOMMANDS.has(firstSub)) {
          elevate({
            level: 'MEDIUM',
            matchedRule: 'CONTAINER_MUTATION',
            reason: `容器变更操作 (${bin} ${firstSub || ''})，需要人工确认。`
          });
        }
        continue;
      }

      if (bin === 'git') {
        if (firstSub && !READ_ONLY_GIT_SUBCOMMANDS.has(firstSub)) {
          elevate({
            level: 'MEDIUM',
            matchedRule: 'GIT_MUTATION',
            reason: `Git 仓库变更操作 (git ${firstSub})，需要人工确认。`
          });
        }
        continue;
      }

      if (HIGH_RISK_BINARIES.has(bin) || HIGH_RISK_BINARIES.has(rawBinLower)) {
        elevate({
          level: 'HIGH',
          matchedRule: `SHELL_HIGH_RISK_${bin.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
          reason: `高风险系统、磁盘、注册表或文件删除命令 (${inv.binary})，需要人工审批。`
        });
        continue;
      }

      if (bin === 'find') {
        // Plain find is an inspection command. Keep approval for its action
        // predicates and command-execution forms, which can mutate state.
        const mutatingFindAction = inv.args.some(arg =>
          /^-(?:delete|exec|execdir|ok|okdir|fprint\d*|fprintf)(?:$|=)/i.test(arg)
        );
        if (!mutatingFindAction) continue;
      }

      if (WRAPPER_EXECUTORS.has(bin) || isInlineScriptExecution(bin, inv.args)) {
        elevate({
          level: 'HIGH',
          matchedRule: `SHELL_WRAPPER_${bin.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
          reason: `命令包含包裹执行器或动态脚本执行 (${inv.binary})，需要人工审批确认。`
        });
        continue;
      }

      if (MEDIUM_RISK_BINARIES.has(bin)) {
        // `sed` without `-i` is read-only stream filtering
        if (bin === 'sed' && !inv.args.some(a => a === '-i' || a.startsWith('-i'))) {
          continue;
        }
        elevate({
          level: 'MEDIUM',
          matchedRule: `SHELL_MUTATION_${bin.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
          reason: `状态或文件变更命令 (${inv.binary})，需要人工确认。`
        });
      }
    }

    return highestLevel;
  }
}
