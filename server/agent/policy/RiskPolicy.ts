import type {
  ExecutionDecision,
  GuardrailAction,
  RiskAssessment,
  RiskLevel
} from '../../domain/security/types';
import type { PermissionPolicy } from './PermissionPolicy';

export interface RiskPolicyOptions {
  levelDecisions?: Partial<Record<RiskLevel, ExecutionDecision>>;
}

const DEFAULT_DECISIONS: Record<RiskLevel, ExecutionDecision> = {
  SAFE: 'allow',
  LOW: 'allow',
  MEDIUM: 'ask',
  HIGH: 'ask',
  CRITICAL: 'deny'
};

export class RiskPolicy implements PermissionPolicy {
  private readonly decisions: Record<RiskLevel, ExecutionDecision>;

  constructor(options?: RiskPolicyOptions) {
    this.decisions = {
      ...DEFAULT_DECISIONS,
      ...options?.levelDecisions
    };
  }

  public evaluate(_action: GuardrailAction, assessment: RiskAssessment): ExecutionDecision {
    return this.decisions[assessment.level] ?? 'ask';
  }
}
