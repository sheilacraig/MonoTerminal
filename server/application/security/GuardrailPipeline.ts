import type {
  GuardrailAction,
  PolicyDecision,
  RiskAssessment
} from '../../domain/security/types';
import type { PermissionPolicy } from '../../agent/policy/PermissionPolicy';
import { RiskPolicy } from '../../agent/policy/RiskPolicy';
import { ShellRiskAnalyzer } from './ShellRiskAnalyzer';
import { FileSystemRiskAnalyzer } from './FileSystemRiskAnalyzer';

export class GuardrailPipeline {
  private readonly shellAnalyzer: ShellRiskAnalyzer;
  private readonly fsAnalyzer: FileSystemRiskAnalyzer;
  private readonly policy: PermissionPolicy;

  constructor(options?: {
    shellAnalyzer?: ShellRiskAnalyzer;
    fsAnalyzer?: FileSystemRiskAnalyzer;
    policy?: PermissionPolicy;
  }) {
    this.shellAnalyzer = options?.shellAnalyzer ?? new ShellRiskAnalyzer();
    this.fsAnalyzer = options?.fsAnalyzer ?? new FileSystemRiskAnalyzer();
    this.policy = options?.policy ?? new RiskPolicy();
  }

  public assessRisk(action: GuardrailAction): RiskAssessment {
    if (action.kind === 'shell:exec') {
      return this.shellAnalyzer.analyze(action);
    }
    return this.fsAnalyzer.analyze(action);
  }

  public evaluate(action: GuardrailAction): PolicyDecision {
    const assessment = this.assessRisk(action);
    const decision = this.policy.evaluate(action, assessment);
    return {
      decision,
      assessment
    };
  }
}
