import crypto from 'crypto';
import type { ApprovalRequest } from '../../domain/security/Approval';
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
  timeoutMs?: number;
}

export interface ApprovalManagerOptions {
  defaultTimeoutMs?: number;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalManager {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly resolvers = new Map<string, (approved: boolean) => void>();
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
    decisionPromise: Promise<boolean>;
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
      status: 'pending',
      createdAt: now,
      expiresAt: now + timeoutMs
    };

    this.requests.set(id, request);

    const decisionPromise = new Promise<boolean>(resolve => {
      this.resolvers.set(id, resolve);

      const timer = setTimeout(() => {
        this.timers.delete(id);
        const current = this.requests.get(id);
        if (current && current.status === 'pending') {
          current.status = 'expired';
          current.resolvedAt = Date.now();
          current.reason = '审批超时未确认';
          const res = this.resolvers.get(id);
          this.resolvers.delete(id);
          this.notify(current);
          res?.(false);
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
    const resolve = this.resolvers.get(approvalId);
    this.resolvers.delete(approvalId);
    this.notify(request);
    resolve?.(true);
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
    const resolve = this.resolvers.get(approvalId);
    this.resolvers.delete(approvalId);
    this.notify(request);
    resolve?.(false);
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
