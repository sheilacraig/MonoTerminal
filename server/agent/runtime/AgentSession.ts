import {
  type AgentPlan,
  type DerivePlanStatusFlags,
  type PlanStep,
  withDerivedPlanStatus
} from '../planner/Plan';
import type { AgentState } from './AgentState';

export class AgentSession {
  private state: AgentState;
  private abortController: AbortController | null = null;

  constructor(public readonly sessionId: string) {
    this.state = {
      sessionId,
      status: 'idle',
      updatedAt: Date.now()
    };
  }

  public getState(): AgentState {
    return { ...this.state };
  }

  public getCwd(): string | undefined {
    return this.state.cwd;
  }

  public setCwd(cwd: string): void {
    if (!cwd || !cwd.trim()) return;
    this.state = {
      ...this.state,
      cwd: cwd.trim(),
      updatedAt: Date.now()
    };
  }

  public getActivePlan(): AgentPlan | undefined {
    return this.state.activePlan;
  }

  public startRun(plan: AgentPlan, initialCwd?: string): AbortSignal {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const updatedPlan = withDerivedPlanStatus(plan);
    this.state = {
      sessionId: this.sessionId,
      status: updatedPlan.status,
      activePlan: updatedPlan,
      cwd: this.state.cwd || initialCwd,
      updatedAt: Date.now(),
      lastError: undefined
    };
    return this.abortController.signal;
  }

  public updatePlanSteps(
    updater: (steps: PlanStep[]) => PlanStep[],
    flags: DerivePlanStatusFlags = {},
    summary?: string
  ): AgentPlan | undefined {
    if (!this.state.activePlan) return undefined;
    const nextSteps = updater(this.state.activePlan.steps.map(s => ({ ...s })));
    const updatedPlan = withDerivedPlanStatus(
      {
        ...this.state.activePlan,
        steps: nextSteps,
        ...(summary !== undefined ? { summary } : {})
      },
      flags
    );
    this.state = {
      ...this.state,
      status: updatedPlan.status,
      activePlan: updatedPlan,
      updatedAt: Date.now()
    };
    return updatedPlan;
  }

  public restorePlan(plan: AgentPlan): void {
    this.state = {
      ...this.state,
      sessionId: this.sessionId,
      status: plan.status,
      activePlan: plan,
      updatedAt: Date.now()
    };
  }

  public cancel(): AgentPlan | undefined {
    this.abortController?.abort();
    this.abortController = null;
    if (!this.state.activePlan) {
      this.state = {
        ...this.state,
        status: 'idle',
        updatedAt: Date.now()
      };
      return undefined;
    }

    return this.updatePlanSteps(
      steps =>
        steps.map(s =>
          s.status === 'pending' || s.status === 'running' || s.status === 'awaiting_approval'
            ? { ...s, status: 'skipped' }
            : s
        ),
      { isCancelled: true },
      '任务已由用户取消'
    );
  }
}
