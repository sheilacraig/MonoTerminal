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
  Square
} from 'lucide-react';
import type { AgentPlanPayload, AgentPlanStepPayload } from '../../../../shared/wsProtocol';

interface AgentPlanPanelProps {
  plan: AgentPlanPayload;
  onCancel?: () => void;
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

export const AgentPlanPanel: React.FC<AgentPlanPanelProps> = ({ plan, onCancel }) => {
  const badge = statusBadge(plan.status);
  const isActive =
    plan.status === 'planning' ||
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

        {isActive && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-900/40 hover:bg-rose-900/70 border border-rose-700/50 text-rose-200 text-[10px] transition-colors shrink-0"
          >
            <Square size={10} />
            <span>中止</span>
          </button>
        )}
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
        {plan.steps.map((step, idx) => (
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

            {step.outputSummary && (
              <div className="pl-5 text-[10px] text-emerald-300/90 font-mono truncate">
                ✓ {step.outputSummary}
              </div>
            )}

            {step.error && (
              <div className="pl-5 text-[10px] text-rose-300 font-mono break-all">
                ✗ {step.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {plan.summary && (
        <div className="text-[11px] text-orca-muted border-t border-orca-border/50 pt-1.5">
          {plan.summary}
        </div>
      )}
    </div>
  );
};
