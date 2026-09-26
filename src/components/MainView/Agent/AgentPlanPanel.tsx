import React from 'react';
import {
  CheckCircle2,
  Circle,
  Loader2,
  ShieldAlert,
  XCircle,
  SkipForward,
  Terminal,
  FileText,
  GitBranch,
  Server,
  Square,
  Play,
  RotateCcw
} from 'lucide-react';
import type { AgentPlanPayload, AgentPlanStepPayload } from '../../../../shared/wsProtocol';

interface AgentPlanPanelProps {
  plan: AgentPlanPayload;
  onCancel?: () => void;
  /** UX round-1 ①: emitted when the user clicks 确认执行 on an awaiting_confirmation plan. */
  onConfirm?: (planId: string) => void;
  onRetry?: (planId: string) => void;
}

function renderStepIcon(status: AgentPlanStepPayload['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
    case 'running':
      return <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />;
    case 'awaiting_approval':
      return <ShieldAlert size={14} className="text-amber-400 animate-pulse shrink-0" />;
    case 'failed':
      return <XCircle size={14} className="text-rose-400 shrink-0" />;
    case 'skipped':
      return <SkipForward size={14} className="text-orca-muted shrink-0" />;
    case 'pending':
    default:
      return <Circle size={14} className="text-orca-muted/60 shrink-0" />;
  }
}

function renderToolIcon(toolName: AgentPlanStepPayload['toolName']) {
  switch (toolName) {
    case 'shell':
      return <Terminal size={11} className="text-blue-300" />;
    case 'file':
      return <FileText size={11} className="text-emerald-300" />;
    case 'git':
      return <GitBranch size={11} className="text-purple-300" />;
    case 'ssh':
      return <Server size={11} className="text-amber-300" />;
  }
}

function statusBadge(status: AgentPlanPayload['status']) {
  switch (status) {
    case 'planning':
      return { label: '规划中', cls: 'bg-purple-900/40 text-purple-300 border-purple-700/50' };
    case 'awaiting_confirmation':
      return {
        label: '等待确认',
        cls: 'bg-violet-900/40 text-violet-300 border-violet-700/50'
      };
    case 'running':
      return { label: '执行中', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/50' };
    case 'awaiting_approval':
      return { label: '等待审批', cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50' };
    case 'verifying':
      return { label: '验证中', cls: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/50' };
    case 'completed':
      return { label: '已完成', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50' };
    case 'failed':
      return { label: '执行失败', cls: 'bg-rose-900/40 text-rose-300 border-rose-700/50' };
    case 'cancelled':
      return { label: '已取消', cls: 'bg-slate-800 text-orca-muted border-orca-border' };
  }
}

export const AgentPlanPanel: React.FC<AgentPlanPanelProps> = ({
  plan,
  onCancel,
  onConfirm,
  onRetry
}) => {
  const badge = statusBadge(plan.status);
  const isAwaitingConfirmation = plan.status === 'awaiting_confirmation';
  const isActive =
    plan.status === 'planning' ||
    isAwaitingConfirmation ||
    plan.status === 'running' ||
    plan.status === 'awaiting_approval' ||
    plan.status === 'verifying';

  const completedCount = plan.steps.filter(s => s.status === 'completed').length;
  const totalCount = plan.steps.length || 1;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="rounded-lg border border-purple-800/50 bg-[#131822] p-3 text-xs space-y-2.5 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="font-semibold text-purple-200 truncate">🧭 执行计划: {plan.goal}</span>
          <span className={`px-1.5 py-0.5 text-[10px] rounded border shrink-0 ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {plan.status === 'failed' &&
            plan.steps.some(step => step.status === 'failed') &&
            onRetry && (
              <button
                type="button"
                onClick={() => onRetry(plan.id)}
                className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-blue-900/50 hover:bg-blue-900/80 border border-blue-600/60 text-blue-200 text-[10px] font-medium transition-colors"
                title="保留已完成步骤和输出，从失败步骤继续"
              >
                <RotateCcw size={10} />
                <span>从失败处继续</span>
              </button>
            )}
          {isAwaitingConfirmation && onConfirm && (
            <button
              type="button"
              onClick={() => onConfirm(plan.id)}
              className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-emerald-900/50 hover:bg-emerald-900/80 border border-emerald-600/60 text-emerald-200 text-[10px] font-medium transition-colors"
            >
              <Play size={10} />
              <span>确认执行</span>
            </button>
          )}

          {isActive && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-900/40 hover:bg-rose-900/70 border border-rose-700/50 text-rose-200 text-[10px] transition-colors"
            >
              <Square size={10} />
              <span>中止</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-orca-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps List */}
      <div className="space-y-1.5">
        {plan.status === 'planning' && plan.steps.length === 0 && (
          <div className="flex items-center space-x-2 rounded bg-orca-bg/70 border border-orca-border/60 px-2.5 py-2 text-[11px] text-purple-300">
            <Loader2 size={13} className="text-purple-400 animate-spin shrink-0" />
            <span>正在根据终端环境与目标拆解执行步骤...</span>
          </div>
        )}

        {isAwaitingConfirmation && (
          <div className="flex items-center space-x-2 rounded bg-violet-950/50 border border-violet-700/40 px-2.5 py-2 text-[11px] text-violet-200">
            <ShieldAlert size={13} className="text-violet-300 animate-pulse shrink-0" />
            <span>
              计划已生成，等待您确认后开始执行。请检查以上步骤是否符合预期。
            </span>
          </div>
        )}

        {plan.steps.map((step, idx) => {
          const shellCmd =
            step.toolName === 'shell' && typeof step.input?.command === 'string'
              ? step.input.command
              : undefined;
          return (
            <div
              key={step.id}
              className="flex flex-col space-y-1 rounded bg-orca-bg/70 border border-orca-border/60 px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 min-w-0">
                  {renderStepIcon(step.status)}
                  <span className="text-[11px] font-medium text-orca-text truncate">
                    {idx + 1}. {step.title}
                  </span>
                </div>
                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-orca-surface border border-orca-border text-[10px] text-orca-muted shrink-0">
                  {renderToolIcon(step.toolName)}
                  <span>{step.toolName}</span>
                </span>
              </div>

              {shellCmd && shellCmd !== step.title && (
                <div className="pl-5 text-[10px] text-blue-300/80 font-mono truncate">
                  $ {shellCmd}
                </div>
              )}

              {step.outputSummary && (
                <div
                  className="pl-5 text-[10px] text-emerald-300/90 font-mono whitespace-pre-wrap break-all line-clamp-3"
                  title={step.outputSummary}
                >
                  ✓ {step.outputSummary}
                </div>
              )}

              {step.error && (
                <div className="pl-5 text-[10px] text-rose-300 font-mono break-all">
                  ✗ {step.error}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.summary && (
        <div className="text-[11px] text-orca-muted border-t border-orca-border/50 pt-1.5">
          {plan.summary}
        </div>
      )}
    </div>
  );
};
