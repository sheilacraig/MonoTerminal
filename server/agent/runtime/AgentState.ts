import type { AgentPlan, PlanStatus } from '../planner/Plan';

export type AgentLifecycleStatus = 'idle' | PlanStatus;

export interface AgentState {
  sessionId: string;
  status: AgentLifecycleStatus;
  activePlan?: AgentPlan;
  cwd?: string;
  updatedAt: number;
  lastError?: string;
}
