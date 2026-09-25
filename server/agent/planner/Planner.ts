import crypto from 'crypto';
import type { WorkspaceContext } from '../../domain/context/types';
import {
  type AgentPlan,
  type PlanStep,
  withDerivedPlanStatus
} from './Plan';

export class Planner {
  /**
   * Build a structured `AgentPlan` for a user goal based on `WorkspaceContext`.
   */
  public createPlan(goal: string, context: WorkspaceContext): AgentPlan {
    const planId = `plan-${crypto.randomUUID()}`;
    const now = Date.now();
    const steps = this.synthesizeSteps(goal, context);

    return withDerivedPlanStatus({
      id: planId,
      sessionId: context.session.id,
      goal,
      steps,
      createdAt: now,
      updatedAt: now
    });
  }

  private synthesizeSteps(goal: string, context: WorkspaceContext): PlanStep[] {
    const lowerGoal = goal.toLowerCase();
    const failedCmd = context.command.failed?.command?.toLowerCase() || '';
    const combined = `${lowerGoal} ${failedCmd}`;
    const cwd = context.terminal.cwd || '/etc/nginx';

    if (combined.includes('nginx')) {
      return [
        {
          id: 'step-1',
          title: '检查 Nginx 配置文件语法',
          description: '执行 nginx -t 验证配置文件是否存在语法错误',
          toolName: 'shell',
          input: { command: 'nginx -t', cwd },
          status: 'pending'
        },
        {
          id: 'step-2',
          title: '读取 Nginx 主配置文件',
          description: '读取 /etc/nginx/nginx.conf 检查监听端口与上游配置',
          toolName: 'file',
          input: { operation: 'read', path: '/etc/nginx/nginx.conf' },
          status: 'pending'
        },
        {
          id: 'step-3',
          title: '检查 Nginx 服务状态并验证',
          description: '查询 systemd 中 nginx 服务是否处于运行状态',
          toolName: 'shell',
          input: { command: 'systemctl status nginx', cwd },
          status: 'pending',
          verifier: {
            type: 'service_active',
            serviceName: 'nginx'
          }
        }
      ];
    }

    if (combined.includes('git')) {
      return [
        {
          id: 'step-1',
          title: '检查 Git 工作区状态',
          description: '查看当前分支及未提交变更',
          toolName: 'git',
          input: { operation: 'status', cwd },
          status: 'pending'
        },
        {
          id: 'step-2',
          title: '查看最近提交记录',
          description: '获取最近 10 条 Git 提交历史',
          toolName: 'git',
          input: { operation: 'log', cwd },
          status: 'pending'
        }
      ];
    }

    // If the goal explicitly specifies a shell command in backticks, e.g. `rm /tmp/test`
    const backtickMatch = goal.match(/`([^`]+)`/);
    if (backtickMatch && backtickMatch[1].trim()) {
      const cmd = backtickMatch[1].trim();
      return [
        {
          id: 'step-1',
          title: `执行命令: ${cmd}`,
          description: `在 ${cwd} 下执行目标命令`,
          toolName: 'shell',
          input: { command: cmd, cwd },
          status: 'pending'
        }
      ];
    }

    // Default baseline system inspection plan
    return [
      {
        id: 'step-1',
        title: '检查当前工作目录内容',
        description: `列出 ${cwd} 下的文件条目`,
        toolName: 'file',
        input: { operation: 'list', path: cwd },
        status: 'pending'
      },
      {
        id: 'step-2',
        title: '执行工作空间状态检查',
        description: '验证当前工作目录路径',
        toolName: 'shell',
        input: { command: 'pwd', cwd },
        status: 'pending',
        verifier: {
          type: 'command_exit_code',
          command: 'pwd',
          expectedExitCode: 0
        }
      }
    ];
  }
}
