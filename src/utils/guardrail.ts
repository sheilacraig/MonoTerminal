/**
 * Frontend guardrail entry — re-exports the shared single-source-of-truth rules
 * so the browser side can never drift from the backend rule set.
 */
export {
  checkCommandSafety,
  DANGEROUS_RULES,
  type GuardrailCheckResult,
  type DangerousRule
} from '../../shared/guardrail';
