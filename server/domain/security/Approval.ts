import type { GuardrailAction, RiskAssessment } from './types';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

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
