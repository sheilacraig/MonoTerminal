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
  private confirmResolver: ((confirmed: boolean) => void) | null = null;
  private confirmAbortListener: (() => void) | null = null;

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
    // Preserve terminal plans (especially model/planner failures with no steps).
    // derivePlanStatus intentionally treats an empty step list as "planning",
    // which is useful for drafts but would otherwise turn a failed plan back
    // into an endless spinner when it enters the session.
    const updatedPlan =
      plan.status === 'failed' || plan.status === 'cancelled'
        ? { ...plan, updatedAt: Date.now() }
        : withDerivedPlanStatus(plan);
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

  /**
   * UX round-1 ①: mark the freshly generated plan as awaiting user
   * confirmation before the step loop starts. Re-derives the plan status via
   * the single source of truth (`derivePlanStatus` with isAwaitingConfirmation).
   */
  public setAwaitingConfirmation(): AgentPlan | undefined {
    if (!this.state.activePlan) return undefined;
    const updatedPlan = withDerivedPlanStatus(
      { ...this.state.activePlan },
      { isAwaitingConfirmation: true }
    );
    this.state = {
      ...this.state,
      status: updatedPlan.status,
      activePlan: updatedPlan,
      updatedAt: Date.now()
    };
    return updatedPlan;
  }

  /**
   * Suspend the caller until the user confirms the plan (resolves true),
   * or the run is cancelled/aborted (resolves false). Mirrors the
   * AbortController pattern used by the approval gate.
   */
  public async waitForPlanConfirmation(planId: string, abortSignal: AbortSignal): Promise<boolean> {
    if (!this.state.activePlan || this.state.activePlan.id !== planId) return false;
    if (abortSignal.aborted) return false;
    return new Promise<boolean>(resolve => {
      this.confirmResolver = resolve;
      this.confirmAbortListener = () => {
        const r = this.confirmResolver;
        this.confirmResolver = null;
        this.confirmAbortListener = null;
        r?.(false);
      };
      abortSignal.addEventListener('abort', this.confirmAbortListener, { once: true });
    });
  }

  /** Resolve the pending confirmation wait. Returns false if there is none. */
  public confirmPlan(planId: string): boolean {
    if (!this.state.activePlan || this.state.activePlan.id !== planId) return false;
    if (this.state.status !== 'awaiting_confirmation') return false;
    const resolve = this.confirmResolver;
    this.confirmResolver = null;
    if (!resolve) return false;
    if (this.confirmAbortListener && this.abortController) {
      this.abortController.signal.removeEventListener('abort', this.confirmAbortListener);
    }
    this.confirmAbortListener = null;
    resolve(true);
    return true;
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
