import type {
  AgentApproveMessage,
  AgentCancelMessage,
  AgentPlanPayload,
  AgentRejectMessage,
  AgentRunMessage,
  ApprovalRequestPayload
} from '../../../shared/wsProtocol';
import type { AgentPlan } from '../../agent/planner/Plan';
import type { ApprovalRequest } from '../../domain/security/Approval';
import type { WsHandler } from '../types';

function toPlanPayload(plan: AgentPlan): AgentPlanPayload {
  return {
    id: plan.id,
    sessionId: plan.sessionId,
    goal: plan.goal,
    status: plan.status,
    steps: plan.steps.map(s => ({
      id: s.id,
      title: s.title,
      description: s.description,
      toolName: s.toolName,
      input: s.input,
      status: s.status,
      outputSummary: s.outputSummary,
      error: s.error,
      approvalId: s.approvalId
    })),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    summary: plan.summary
  };
}

function toApprovalPayload(req: ApprovalRequest): ApprovalRequestPayload {
  return {
    id: req.id,
    sessionId: req.sessionId,
    planId: req.planId,
    stepId: req.stepId,
    toolName: req.toolName,
    action: req.action as unknown as Record<string, unknown>,
    assessment: {
      level: req.assessment.level,
      reason: req.assessment.reason,
      matchedRule: req.assessment.matchedRule
    },
    status: req.status,
    createdAt: req.createdAt,
    expiresAt: req.expiresAt,
    resolvedAt: req.resolvedAt,
    reason: req.reason
  };
}

export const handleAgentRun: WsHandler<AgentRunMessage> = async (msg, conn, deps) => {
  if (!deps.agentRuntime) return;

  const pushTimeline = () => {
    if (!deps.timelineService) return;
    conn.send({
      type: 'agent:timeline',
      sessionId: msg.sessionId,
      entries: deps.timelineService.getTimeline(msg.sessionId)
    });
  };

  await deps.agentRuntime.runPlan(msg.sessionId, msg.goal, {
    onPlanUpdate: plan => {
      conn.send({
        type: 'agent:plan',
        sessionId: msg.sessionId,
        plan: toPlanPayload(plan)
      });
      pushTimeline();
    },
    onApprovalRequest: req => {
      conn.send({
        type: 'agent:approval_request',
        sessionId: msg.sessionId,
        approval: toApprovalPayload(req)
      });
    }
  });

  pushTimeline();
};

export const handleAgentApprove: WsHandler<AgentApproveMessage> = (msg, conn, deps) => {
  if (!deps.approvalManager) return;
  const ok = deps.approvalManager.approve(msg.approvalId);
  if (ok) {
    conn.send({
      type: 'agent:approval_resolved',
      sessionId: msg.sessionId,
      approvalId: msg.approvalId,
      status: 'approved'
    });
  }
};

export const handleAgentReject: WsHandler<AgentRejectMessage> = (msg, conn, deps) => {
  if (!deps.approvalManager) return;
  const ok = deps.approvalManager.reject(msg.approvalId, msg.reason);
  if (ok) {
    conn.send({
      type: 'agent:approval_resolved',
      sessionId: msg.sessionId,
      approvalId: msg.approvalId,
      status: 'rejected',
      reason: msg.reason
    });
  }
};

export const handleAgentCancel: WsHandler<AgentCancelMessage> = (msg, conn, deps) => {
  if (!deps.agentRuntime) return;
  const plan = deps.agentRuntime.cancel(msg.sessionId);
  if (plan) {
    conn.send({
      type: 'agent:plan',
      sessionId: msg.sessionId,
      plan: toPlanPayload(plan)
    });
  }
};
