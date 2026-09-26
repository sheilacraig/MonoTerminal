import crypto from 'crypto';
import type { ApprovalDecision, ApprovalRequest } from '../../domain/security/Approval';
import type { GuardrailAction, RiskAssessment } from '../../domain/security/types';
import type { Unsubscribe } from '../../domain/terminal/types';

export interface CreateApprovalParams {
  id?: string;
  sessionId: string;
  planId?: string;
  stepId?: string;
  toolName: string;
  action: GuardrailAction;
  assessment: RiskAssessment;
  relatedSteps?: Array<{ stepId: string; title: string }>;
  timeoutMs?: number;
}

export interface ApprovalManagerOptions {
  defaultTimeoutMs?: number;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalManager {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly resolvers = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(request: ApprovalRequest) => void>();
  private readonly defaultTimeoutMs: number;

  constructor(options?: ApprovalManagerOptions) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  }

  public onApprovalChange(listener: (request: ApprovalRequest) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(request: ApprovalRequest): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(request);
      } catch (err) {
        console.error('[ApprovalManager] Error in approval listener:', err);
      }
    }
  }

  public requestApproval(params: CreateApprovalParams): {
    request: ApprovalRequest;
    decisionPromise: Promise<ApprovalDecision>;
  } {
    const now = Date.now();
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;
    const id = params.id || `appr-${crypto.randomUUID()}`;

    const request: ApprovalRequest = {
      id,
      sessionId: params.sessionId,
      planId: params.planId,
      stepId: params.stepId,
      toolName: params.toolName,
      action: params.action,
      assessment: params.assessment,
      relatedSteps: params.relatedSteps?.map(step => ({ ...step })),
      status: 'pending',
      createdAt: now,
      expiresAt: now + timeoutMs
    };

    this.requests.set(id, request);

    const decisionPromise = new Promise<ApprovalDecision>(resolve => {
      this.resolvers.set(id, resolve);

      const timer = setTimeout(() => {
        this.timers.delete(id);
        const current = this.requests.get(id);
        if (current && current.status === 'pending') {
          current.status = 'expired';
          current.resolvedAt = Date.now();
          current.reason = '审批超时未确认';
          // Review-3 R5: resolved entries are removed so a long-lived desktop
          // process cannot accumulate approval objects (with their full
          // GuardrailAction payloads) forever. The request object itself is
          // still alive for callers holding a reference.
          this.requests.delete(id);
          const res = this.resolvers.get(id);
          this.resolvers.delete(id);
          this.notify(current);
          res?.('expired');
        }
      }, timeoutMs);
      timer.unref?.();
      this.timers.set(id, timer);
    });

    this.notify(request);
    return { request, decisionPromise };
  }

  public approve(approvalId: string): boolean {
    const request = this.requests.get(approvalId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.clearTimer(approvalId);
    request.status = 'approved';
    request.resolvedAt = Date.now();
    this.requests.delete(approvalId); // review-3 R5: no unbounded retention
    const resolve = this.resolvers.get(approvalId);
    this.resolvers.delete(approvalId);
    this.notify(request);
    resolve?.('approved');
    return true;
  }

  /**
   * UX round-1 ②: mark the approval as skipped — the user chose to bypass this
   * single step. The awaiting tool call resolves with `skipped`, and the plan
   * loop marks the step as skipped and continues with the remaining steps.
   */
  public skip(approvalId: string): boolean {
    const request = this.requests.get(approvalId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.clearTimer(approvalId);
    request.status = 'skipped';
    request.resolvedAt = Date.now();
    request.reason = '用户跳过此步';
    this.requests.delete(approvalId); // review-3 R5: no unbounded retention
    const resolve = this.resolvers.get(approvalId);
    this.resolvers.delete(approvalId);
    this.notify(request);
    resolve?.('skipped');
    return true;
  }

  public reject(approvalId: string, reason?: string): boolean {
    const request = this.requests.get(approvalId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    this.clearTimer(approvalId);
    request.status = 'rejected';
    request.resolvedAt = Date.now();
    request.reason = reason || '用户拒绝执行';
    this.requests.delete(approvalId); // review-3 R5: no unbounded retention
    const resolve = this.resolvers.get(approvalId);
    this.resolvers.delete(approvalId);
    this.notify(request);
    resolve?.('rejected');
    return true;
  }

  public get(approvalId: string): ApprovalRequest | undefined {
    return this.requests.get(approvalId);
  }

  public listPending(sessionId?: string): ApprovalRequest[] {
    const all = Array.from(this.requests.values()).filter(r => r.status === 'pending');
    if (sessionId) {
      return all.filter(r => r.sessionId === sessionId);
    }
    return all;
  }

  public cancelSessionApprovals(sessionId: string): void {
    for (const req of this.requests.values()) {
      if (req.sessionId === sessionId && req.status === 'pending') {
        this.reject(req.id, '会话已取消或关闭');
      }
    }
  }

  private clearTimer(approvalId: string): void {
    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }
  }
}
