import type {
  ExecutionDecision,
  GuardrailAction,
  RiskAssessment
} from '../../domain/security/types';

export interface PermissionPolicy {
  evaluate(action: GuardrailAction, assessment: RiskAssessment): ExecutionDecision;
}
