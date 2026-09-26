import type { GuardrailAction, RiskAssessment } from './types';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'expired';

/**
 * Terminal outcome of an approval request, as observed by the awaiting caller.
 * `skipped` means the user chose to bypass this single step and let the plan
 * continue with the remaining steps.
 */
export type ApprovalDecision = 'approved' | 'rejected' | 'skipped' | 'expired';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  planId?: string;
  stepId?: string;
  toolName: string;
  action: GuardrailAction;
  assessment: RiskAssessment;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  reason?: string;
}
