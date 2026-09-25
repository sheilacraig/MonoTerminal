import crypto from 'crypto';
import type { EventBus } from '../../domain/events/types';
import type { ApprovalRequest } from '../../domain/security/Approval';
import type { ApprovalManager } from '../../application/security/ApprovalManager';
import type { GuardrailPipeline } from '../../application/security/GuardrailPipeline';
import type { ContextEngine } from '../../application/context/ContextEngine';
import type { DefaultSessionManager } from '../../application/session/DefaultSessionManager';
import type { AgentPlan } from '../planner/Plan';
import { Planner } from '../planner/Planner';
import type { Tool, ToolExecutionContext, ToolResult } from '../tools/Tool';
import { VerifierRegistry } from './Verifier';
import { AgentSession } from './AgentSession';

export interface AgentRunCallbacks {
  onPlanUpdate?: (plan: AgentPlan) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onStepOutput?: (stepId: string, summary: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, any>;

export interface AgentRuntimeDeps {
  sessionManager: DefaultSessionManager;
  contextEngine: ContextEngine;
  eventBus: EventBus;
  guardrailPipeline: GuardrailPipeline;
  approvalManager: ApprovalManager;
  tools: AnyTool[];
  planner?: Planner;
  verifierRegistry?: VerifierRegistry;
}

function summarizeToolOutput(output: unknown): string {
  if (output === undefined || output === null) return '执行完成';
  if (typeof output === 'string') {
    return output.length > 240 ? `${output.slice(0, 240)}...` : output;
  }
  if (typeof output === 'object') {
    const rec = output as Record<string, unknown>;
    if (typeof rec.stdout === 'string' && rec.stdout.trim()) {
      const s = rec.stdout.trim();
      return s.length > 240 ? `${s.slice(0, 240)}...` : s;
    }
    if (Array.isArray(output)) {
      return `共 ${output.length} 项条目`;
    }
  }
  const str = JSON.stringify(output);
  return str.length > 240 ? `${str.slice(0, 240)}...` : str;
}

export class AgentRuntime {
  private readonly agentSessions = new Map<string, AgentSession>();
  private readonly toolMap = new Map<string, AnyTool>();
  private readonly planner: Planner;
  private readonly verifierRegistry?: VerifierRegistry;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.planner = deps.planner ?? new Planner();
    this.verifierRegistry = deps.verifierRegistry;
    for (const tool of deps.tools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  public getOrCreateAgentSession(sessionId: string): AgentSession {
    let sess = this.agentSessions.get(sessionId);
    if (!sess) {
      sess = new AgentSession(sessionId);
      this.agentSessions.set(sessionId, sess);
    }
    return sess;
  }

  public getActivePlan(sessionId: string): AgentPlan | undefined {
    return this.agentSessions.get(sessionId)?.getActivePlan();
  }

  public restoreSessionPlan(sessionId: string, plan: AgentPlan): void {
    this.getOrCreateAgentSession(sessionId).restorePlan(plan);
  }

  /**
   * Execute a single tool call through the mandatory security pipeline:
   * Schema Validation -> GuardrailAction -> GuardrailPipeline -> (Allow / Ask Approval / Deny) -> Execute
   */
  public async executeToolCall(
    sessionId: string,
    toolName: string,
    rawInput: unknown,
    options?: {
      planId?: string;
      stepId?: string;
      abortSignal?: AbortSignal;
      onApprovalPending?: (request: ApprovalRequest) => void;
    }
  ): Promise<ToolResult> {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `未知工具: ${toolName}`,
        durationMs: 0
      };
    }

    const validation = tool.schema.validate(rawInput);
    if (!validation.ok) {
      return {
        success: false,
        error: validation.error,
        durationMs: 0
      };
    }

    const agentSession = this.getOrCreateAgentSession(sessionId);
    const session = this.deps.sessionManager.get(sessionId);
    const effectiveCwd = agentSession.getCwd() || session?.terminal.cwd;
    const ctx: ToolExecutionContext = {
      sessionId,
      cwd: effectiveCwd,
      abortSignal: options?.abortSignal,
      onCwdChange: (newCwd: string) => {
        agentSession.setCwd(newCwd);
        this.deps.sessionManager.updateCwd(sessionId, newCwd);
      }
    };

    const action = tool.toGuardrailAction(validation.data, ctx);
    const policyResult = this.deps.guardrailPipeline.evaluate(action);

    if (policyResult.decision === 'deny') {
      return {
        success: false,
        error:
          policyResult.assessment.reason ||
          `安全策略拒绝执行高危操作 (${policyResult.assessment.level})`,
        durationMs: 0
      };
    }

    if (policyResult.decision === 'ask') {
      const { request, decisionPromise } = this.deps.approvalManager.requestApproval({
        sessionId,
        planId: options?.planId,
        stepId: options?.stepId,
        toolName,
        action,
        assessment: policyResult.assessment
      });
      options?.onApprovalPending?.(request);

      const approved = await decisionPromise;
      if (!approved) {
        return {
          success: false,
          error: request.reason || '操作未经人工批准或已拒绝',
          durationMs: 0
        };
      }
    }

    const toolCallId = `tc-${crypto.randomUUID()}`;
    this.deps.eventBus.publish({
      type: 'agent:tool_call',
      sessionId,
      planId: options?.planId,
      toolCallId,
      toolName,
      input: validation.data,
      timestamp: Date.now()
    });

    const result = await tool.execute(validation.data, ctx);

    this.deps.eventBus.publish({
      type: 'agent:tool_result',
      sessionId,
      planId: options?.planId,
      toolCallId,
      toolName,
      success: result.success,
      output: result.output,
      error: result.error,
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * Run a full Plan-Execute-Verify loop for a given session and goal (or pre-built AgentPlan).
   */
  public async runPlan(
    sessionId: string,
    goalOrPlan: string | AgentPlan,
    callbacks?: AgentRunCallbacks
  ): Promise<AgentPlan> {
    const context = await this.deps.contextEngine.buildContext(sessionId);
    const initialPlan =
      typeof goalOrPlan === 'string'
        ? this.planner.createPlan(goalOrPlan, context)
        : goalOrPlan;

    const agentSession = this.getOrCreateAgentSession(sessionId);
    const abortSignal = agentSession.startRun(initialPlan, context.terminal.cwd);

    this.deps.eventBus.publish({
      type: 'agent:started',
      sessionId,
      planId: initialPlan.id,
      goal: initialPlan.goal,
      timestamp: Date.now()
    });

    const emitPlan = (plan: AgentPlan | undefined) => {
      if (plan) {
        callbacks?.onPlanUpdate?.(plan);
      }
    };

    emitPlan(agentSession.getActivePlan());

    for (const step of initialPlan.steps) {
      if (abortSignal.aborted) {
        break;
      }

      // Mark current step running
      emitPlan(
        agentSession.updatePlanSteps(steps =>
          steps.map(s => (s.id === step.id ? { ...s, status: 'running' } : s))
        )
      );

      const res = await this.executeToolCall(sessionId, step.toolName, step.input, {
        planId: initialPlan.id,
        stepId: step.id,
        abortSignal,
        onApprovalPending: req => {
          emitPlan(
            agentSession.updatePlanSteps(steps =>
              steps.map(s =>
                s.id === step.id
                  ? { ...s, status: 'awaiting_approval', approvalId: req.id }
                  : s
              )
            )
          );
          callbacks?.onApprovalRequest?.(req);
        }
      });

      if (abortSignal.aborted) {
        break;
      }

      if (!res.success) {
        emitPlan(
          agentSession.updatePlanSteps(
            steps =>
              steps.map(s => {
                if (s.id === step.id) {
                  return { ...s, status: 'failed', error: res.error || '执行失败' };
                }
                if (s.status === 'pending') {
                  return { ...s, status: 'skipped' };
                }
                return s;
              }),
            {},
            `步骤 "${step.title}" 失败: ${res.error || '未知错误'}`
          )
        );
        break;
      }

      let stepOutputSummary = summarizeToolOutput(res.output);

      // Run deterministic Verifier if configured on this step (Phase 12 / P1-9)
      if (step.verifier && this.verifierRegistry) {
        emitPlan(
          agentSession.updatePlanSteps(steps => steps, { isVerifying: true })
        );

        const verifyRes = await this.verifierRegistry.verify(step.verifier, {
          sessionId,
          cwd: agentSession.getCwd() || context.terminal.cwd,
          abortSignal
        });

        if (!verifyRes.passed) {
          emitPlan(
            agentSession.updatePlanSteps(
              steps =>
                steps.map(s => {
                  if (s.id === step.id) {
                    return {
                      ...s,
                      status: 'failed',
                      outputSummary: stepOutputSummary,
                      error: verifyRes.message
                    };
                  }
                  if (s.status === 'pending') {
                    return { ...s, status: 'skipped' };
                  }
                  return s;
                }),
              { isVerifying: false },
              `验证未通过: ${verifyRes.message}`
            )
          );
          break;
        }
        stepOutputSummary = `${stepOutputSummary} (${verifyRes.message})`;
      }

      callbacks?.onStepOutput?.(step.id, stepOutputSummary);
      emitPlan(
        agentSession.updatePlanSteps(
          steps =>
            steps.map(s =>
              s.id === step.id
                ? { ...s, status: 'completed', outputSummary: stepOutputSummary }
                : s
            ),
          { isVerifying: false }
        )
      );
    }

    const finalPlan = agentSession.getActivePlan()!;
    this.deps.eventBus.publish({
      type: 'agent:finished',
      sessionId,
      planId: finalPlan.id,
      status:
        finalPlan.status === 'completed'
          ? 'completed'
          : finalPlan.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      summary: finalPlan.summary,
      timestamp: Date.now()
    });

    return finalPlan;
  }

  public cancel(sessionId: string): AgentPlan | undefined {
    this.deps.approvalManager.cancelSessionApprovals(sessionId);
    const plan = this.agentSessions.get(sessionId)?.cancel();
    if (plan) {
      this.deps.eventBus.publish({
        type: 'agent:finished',
        sessionId,
        planId: plan.id,
        status: 'cancelled',
        summary: plan.summary,
        timestamp: Date.now()
      });
    }
    return plan;
  }
}
