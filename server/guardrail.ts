/**
 * Backend guardrail entry — re-exports the shared single-source-of-truth rules
 * so server code and existing imports keep working unchanged.
 */
export {
  checkCommandSafety,
  DANGEROUS_RULES,
  type GuardrailCheckResult,
  type DangerousRule
} from '../shared/guardrail';
