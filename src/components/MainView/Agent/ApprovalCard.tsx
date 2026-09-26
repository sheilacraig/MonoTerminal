import React from 'react';
import { ShieldAlert, Check, X, SkipForward } from 'lucide-react';
import type { ApprovalRequestPayload } from '../../../../shared/wsProtocol';

interface ApprovalCardProps {
  approval: ApprovalRequestPayload;
  onApprove: (approvalId: string, includeRelated?: boolean) => void;
  onReject: (approvalId: string, reason?: string) => void;
  /** UX round-1 ②: bypass this single step — the plan continues afterwards. */
  onSkip: (approvalId: string) => void;
}

function formatActionTarget(action: Record<string, unknown>): string {
  const kind = String(action.kind || '');
  if (kind === 'shell:exec') {
    return String(action.command || '');
  }
  if (kind === 'fs:rename') {
    return `${String(action.oldPath || '')} -> ${String(action.newPath || '')}`;
  }
  return String(action.path || '');
}

/**
 * Inline Human-in-the-Loop Approval Card for Agent tool calls (Phase 10 & 15).
 *
 * Strictly uses explicit mouse clicks (`onClick`) without binding `Alt+Y` or
 * global keyboard shortcuts so it never conflicts with `DangerConfirmModal` (P2-H).
 */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approval,
  onApprove,
  onReject,
  onSkip
}) => {
  const isHigh =
    approval.assessment.level === 'HIGH' || approval.assessment.level === 'CRITICAL';
  const targetText = formatActionTarget(approval.action);

  return (
    <div
      className={`rounded-lg border p-3 text-xs space-y-2 shadow-lg ${
        isHigh
          ? 'border-rose-600/70 bg-rose-950/30 text-rose-100'
          : 'border-amber-600/70 bg-amber-950/30 text-amber-100'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <ShieldAlert
            size={15}
            className={isHigh ? 'text-rose-400 shrink-0' : 'text-amber-400 shrink-0'}
          />
          <span className="font-bold text-[11px]">
            安全护栏审批 ({approval.assessment.level}) · 工具 [{approval.toolName}]
          </span>
        </div>
        {approval.assessment.matchedRule && (
          <span className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-[10px]">
            {approval.assessment.matchedRule}
          </span>
        )}
      </div>

      {approval.assessment.reason && (
        <div className="text-[11px] opacity-90">{approval.assessment.reason}</div>
      )}

      {targetText && (
        <div className="rounded bg-black/50 border border-white/10 px-2.5 py-1.5 font-mono text-[11px] break-all">
          {targetText}
        </div>
      )}

      {approval.relatedSteps && approval.relatedSteps.length > 0 && (
        <div className="rounded border border-white/10 bg-black/25 px-2.5 py-2">
          <div className="text-[10px] font-medium opacity-90">
            本计划还有 {approval.relatedSteps.length} 个相同风险规则的待执行步骤：
          </div>
          <ul className="mt-1 list-disc pl-4 text-[10px] opacity-75 space-y-0.5">
            {approval.relatedSteps.map(step => (
              <li key={step.stepId}>{step.title}</li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] opacity-65">
            批量授权仅适用于上列步骤，且执行前仍会重新检查安全规则。
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => onReject(approval.id, '用户手动拒绝执行')}
          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-orca-surface hover:bg-rose-900/60 border border-orca-border text-orca-text text-[11px] transition-colors"
        >
          <X size={12} />
          <span>拒绝</span>
        </button>

        {/* UX round-1 ②: skip just this step — remaining steps still run. */}
        <button
          type="button"
          onClick={() => onSkip(approval.id)}
          title="跳过此步骤，继续执行计划中的后续步骤"
          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-orca-surface hover:bg-slate-700/70 border border-orca-border text-orca-muted text-[11px] transition-colors"
        >
          <SkipForward size={12} />
          <span>跳过此步</span>
        </button>

        <button
          type="button"
          onClick={() => onApprove(approval.id)}
          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-[11px] transition-colors"
        >
          <Check size={12} />
          <span>批准执行</span>
        </button>
        {approval.relatedSteps && approval.relatedSteps.length > 0 && (
          <button
            type="button"
            onClick={() => onApprove(approval.id, true)}
            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-white font-medium text-[11px] transition-colors"
            title="仅批准上方列出的本计划相近步骤"
          >
            <Check size={12} />
            <span>批准这步及相近步骤 ({approval.relatedSteps.length + 1})</span>
          </button>
        )}
      </div>
    </div>
  );
};
