export type PlanStepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export type PlanStatus =
  | 'planning'
  | 'running'
  | 'awaiting_approval'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type VerificationSpec =
  | {
      type: 'command_exit_code';
      command: string;
      expectedExitCode?: number;
      expectedOutputContains?: string;
    }
  | {
      type: 'file_mutation';
      path: string;
      mustContain?: string;
      mustNotContain?: string;
    }
  | {
      type: 'service_active';
      serviceName: string;
    };

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  toolName: 'shell' | 'file' | 'git' | 'ssh';
  input: Record<string, unknown>;
  status: PlanStepStatus;
  outputSummary?: string;
  error?: string;
  approvalId?: string;
  verifier?: VerificationSpec;
}

export interface AgentPlan {
  id: string;
  sessionId: string;
  goal: string;
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  summary?: string;
}

export interface DerivePlanStatusFlags {
  isPlanning?: boolean;
  isVerifying?: boolean;
  isCancelled?: boolean;
}

/**
 * Pure function deriving the overall `PlanStatus` from `steps` and lifecycle flags (P1-G).
 * Eliminates dual-state drift between `plan.status` and `steps[i].status`.
 */
export function derivePlanStatus(
  steps: readonly PlanStep[],
  flags: DerivePlanStatusFlags = {}
): PlanStatus {
  if (flags.isCancelled) {
    return 'cancelled';
  }
  if (flags.isPlanning || steps.length === 0) {
    return 'planning';
  }
  if (steps.some(s => s.status === 'awaiting_approval')) {
    return 'awaiting_approval';
  }
  if (flags.isVerifying) {
    return 'verifying';
  }
  if (steps.some(s => s.status === 'running')) {
    return 'running';
  }
  if (steps.some(s => s.status === 'failed')) {
    return 'failed';
  }
  if (steps.every(s => s.status === 'completed' || s.status === 'skipped')) {
    return 'completed';
  }
  return 'running';
}

export function withDerivedPlanStatus(
  plan: Omit<AgentPlan, 'status'> & { status?: PlanStatus },
  flags: DerivePlanStatusFlags = {}
): AgentPlan {
  return {
    ...plan,
    status: derivePlanStatus(plan.steps, flags),
    updatedAt: Date.now()
  };
}
