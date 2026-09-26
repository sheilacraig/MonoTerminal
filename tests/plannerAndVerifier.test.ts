import { describe, it, expect } from 'vitest';
import { derivePlanStatus, type PlanStep } from '../server/agent/planner/Plan';
import { Planner } from '../server/agent/planner/Planner';
import { VerifierRegistry } from '../server/agent/runtime/Verifier';
import { AgentRuntime } from '../server/agent/runtime/AgentRuntime';
import { GuardrailPipeline } from '../server/application/security/GuardrailPipeline';
import { ApprovalManager } from '../server/application/security/ApprovalManager';
import { InMemoryEventBus } from '../server/application/events/InMemoryEventBus';
import { EventEmittingFsProvider } from '../server/infrastructure/filesystem/EventEmittingFsProvider';
import { MockFileSystemProvider } from '../server/infrastructure/filesystem/MockFileSystemProvider';
import { MockTerminalProvider } from '../server/infrastructure/terminal/MockTerminalProvider';
import { DefaultSessionManager } from '../server/application/session/DefaultSessionManager';
import { CommandEngine } from '../server/application/command/CommandEngine';
import { ContextEngine } from '../server/application/context/ContextEngine';
import { ShellTool } from '../server/agent/tools/ShellTool';
import { FileTool } from '../server/agent/tools/FileTool';
import { GitTool } from '../server/agent/tools/GitTool';
import { SshTool } from '../server/agent/tools/SshTool';
import { MockFileSystem, MockTerminalSession } from '../server/mockServer';
import type { MockSessionEntry } from '../server/ws/types';

function createPlanVerifierHarness() {
  const eventBus = new InMemoryEventBus();
  const mockSessions = new Map<string, MockSessionEntry>();
  const createMockSession = (sessionId: string): MockSessionEntry => {
    const fs = new MockFileSystem();
    const term = new MockTerminalSession(sessionId, fs);
    return { term, fs };
  };

  const mockTermProvider = new MockTerminalProvider(mockSessions, createMockSession);
  const fsProvider = new EventEmittingFsProvider(new MockFileSystemProvider(mockSessions), eventBus);

  const sessionManager = new DefaultSessionManager({
    terminalProviders: {
      local: mockTermProvider,
      ssh: mockTermProvider,
      mock: mockTermProvider
    },
    fileSystemProviders: {
      local: fsProvider,
      ssh: fsProvider,
      mock: fsProvider
    }
  });

  const commandEngine = new CommandEngine(eventBus);
  const contextEngine = new ContextEngine(sessionManager, commandEngine, eventBus);
  const guardrailPipeline = new GuardrailPipeline();
  const approvalManager = new ApprovalManager();
  const shellTool = new ShellTool({ sessionManager, commandEngine });
  const fileTool = new FileTool(sessionManager);
  const gitTool = new GitTool(shellTool);
  const sshTool = new SshTool(shellTool);
  const verifierRegistry = new VerifierRegistry({ sessionManager, shellTool });
  const planner = new Planner();

  const agentRuntime = new AgentRuntime({
    sessionManager,
    contextEngine,
    eventBus,
    guardrailPipeline,
    approvalManager,
    tools: [shellTool, fileTool, gitTool, sshTool],
    planner,
    verifierRegistry
  });

  return {
    eventBus,
    sessionManager,
    fsProvider,
    contextEngine,
    verifierRegistry,
    planner,
    agentRuntime
  };
}

describe('Phase 11: derivePlanStatus pure function & Planner (P1-G)', () => {
  const makeStep = (id: string, status: PlanStep['status']): PlanStep => ({
    id,
    title: `Step ${id}`,
    toolName: 'shell',
    input: { command: 'pwd' },
    status
  });

  it('derives PlanStatus deterministically from steps and flags without state drift (P1-G)', () => {
    expect(derivePlanStatus([])).toBe('planning');
    expect(derivePlanStatus([makeStep('1', 'pending')], { isPlanning: true })).toBe('planning');
    expect(derivePlanStatus([makeStep('1', 'running'), makeStep('2', 'pending')])).toBe('running');
    expect(
      derivePlanStatus([makeStep('1', 'completed'), makeStep('2', 'awaiting_approval')])
    ).toBe('awaiting_approval');
    expect(
      derivePlanStatus([makeStep('1', 'running')], { isVerifying: true })
    ).toBe('verifying');
    expect(derivePlanStatus([makeStep('1', 'completed'), makeStep('2', 'failed')])).toBe('failed');
    expect(derivePlanStatus([makeStep('1', 'completed'), makeStep('2', 'skipped')])).toBe(
      'completed'
    );
    expect(
      derivePlanStatus([makeStep('1', 'running')], { isCancelled: true })
    ).toBe('cancelled');
  });

  it('P2-1: createPlanWithModel returns a failed plan (via createFailedPlan) instead of silently falling back to heuristic steps when model fails', async () => {
    const { sessionManager, contextEngine } = createPlanVerifierHarness();
    await sessionManager.create({
      id: 'sess-fail-model',
      host: {
        id: 'mock-fail',
        name: 'Fail Host',
        group: 'Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      },
      cols: 80,
      rows: 24
    });

    const brokenPlanner = new Planner(async () => {
      throw new Error('401 Invalid API Key');
    });

    const context = await contextEngine.buildContext('sess-fail-model');
    const plan = await brokenPlanner.createPlanWithModel(
      '排查 nginx 配置与运行状态',
      context,
      []
    );

    expect(plan.status).toBe('failed');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].status).toBe('failed');
    expect(plan.steps[0].title).toContain('无法生成执行计划');
    expect(plan.steps[0].error).toContain('401 Invalid API Key');
  });
});

describe('Phase 12: Deterministic VerifierRegistry & Plan-Execute-Verify Loop (P1-9)', () => {
  it('verifies command_exit_code, file_mutation (without emitting file:opened), and service_active', async () => {
    const { eventBus, sessionManager, fsProvider, verifierRegistry } = createPlanVerifierHarness();

    await sessionManager.create({
      id: 'sess-ver',
      host: {
        id: 'mock-ver',
        name: 'Verify Host',
        group: 'Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      },
      cols: 80,
      rows: 24
    });

    const openedFiles: string[] = [];
    eventBus.subscribe('file:opened', e => openedFiles.push(e.path));

    // 1. CommandExitCodeVerifier
    const cmdOk = await verifierRegistry.verify(
      {
        type: 'command_exit_code',
        command: 'nginx -t',
        expectedExitCode: 0,
        expectedOutputContains: 'syntax is ok'
      },
      { sessionId: 'sess-ver', cwd: '/etc/nginx' }
    );
    expect(cmdOk.passed).toBe(true);

    // 2. FileMutationVerifier (uses internal: true so openedFiles stays empty per P1-E)
    await fsProvider.write('sess-ver', '/etc/nginx/conf.d/app.conf', 'listen 8080;');
    const fileOk = await verifierRegistry.verify(
      {
        type: 'file_mutation',
        path: '/etc/nginx/conf.d/app.conf',
        mustContain: 'listen 8080;',
        mustNotContain: 'listen 80;'
      },
      { sessionId: 'sess-ver', cwd: '/etc/nginx' }
    );
    expect(fileOk.passed).toBe(true);
    expect(openedFiles).toHaveLength(0);

    // 3. ServiceActiveVerifier
    const svcOk = await verifierRegistry.verify(
      {
        type: 'service_active',
        serviceName: 'nginx'
      },
      { sessionId: 'sess-ver', cwd: '/etc/nginx' }
    );
    expect(svcOk.passed).toBe(true);
  });

  it('executes full Plan-Execute-Verify loop via AgentRuntime.runPlan and marks plan failed when verification fails', async () => {
    const { sessionManager, agentRuntime } = createPlanVerifierHarness();

    await sessionManager.create({
      id: 'sess-plan',
      host: {
        id: 'mock-plan',
        name: 'Plan Host',
        group: 'Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      },
      cols: 80,
      rows: 24
    });

    const seenStatuses: string[] = [];
    const completedPlan = await agentRuntime.runPlan('sess-plan', '排查 nginx 配置与运行状态', {
      onPlanUpdate: p => seenStatuses.push(p.status)
    });

    expect(completedPlan.status).toBe('completed');
    expect(completedPlan.steps.every(s => s.status === 'completed')).toBe(true);
    expect(seenStatuses).toContain('verifying');

    // Now run a plan where the verifier fails (mustContain a string that does not exist)
    const failingPlan = await agentRuntime.runPlan('sess-plan', {
      id: 'plan-fail-verify',
      sessionId: 'sess-plan',
      goal: '验证不存在的配置项',
      status: 'planning',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        {
          id: 'step-v1',
          title: '读取 nginx.conf 并验证特定上游',
          toolName: 'file',
          input: { operation: 'read', path: '/etc/nginx/nginx.conf' },
          status: 'pending',
          verifier: {
            type: 'file_mutation',
            path: '/etc/nginx/nginx.conf',
            mustContain: 'upstream non_existent_cluster_9999'
          }
        },
        {
          id: 'step-v2',
          title: '后续步骤应被跳过',
          toolName: 'shell',
          input: { command: 'pwd' },
          status: 'pending'
        }
      ]
    });

    expect(failingPlan.status).toBe('failed');
    expect(failingPlan.steps[0].status).toBe('failed');
    expect(failingPlan.steps[0].error).toContain('未包含预期内容');
    expect(failingPlan.steps[1].status).toBe('skipped');
  });

  it('extracts fenced shell commands into shell steps and executes visibly in an attached terminal stream', async () => {
    const { sessionManager, agentRuntime } = createPlanVerifierHarness();

    await sessionManager.create({
      id: 'sess-visible-shell',
      host: {
        id: 'mock-vis',
        name: 'Visible Shell Host',
        group: 'Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      },
      cols: 80,
      rows: 24
    });

    const receivedTerminalChunks: string[] = [];
    sessionManager.attach('sess-visible-shell', 'conn-1', msg => {
      if (msg.type === 'term:data') {
        receivedTerminalChunks.push(msg.data);
      }
    });

    const goalWithCodeBlock = [
      '检查 Nginx 配置与当前目录',
      '```bash',
      'pwd',
      'nginx -t',
      '```'
    ].join('\n');

    const completedPlan = await agentRuntime.runPlan('sess-visible-shell', goalWithCodeBlock);

    expect(completedPlan.status).toBe('completed');
    expect(completedPlan.steps).toHaveLength(2);
    expect(completedPlan.steps[0]).toMatchObject({
      toolName: 'shell',
      input: { command: 'pwd' },
      status: 'completed'
    });
    expect(completedPlan.steps[1]).toMatchObject({
      toolName: 'shell',
      input: { command: 'nginx -t' },
      status: 'completed'
    });

    // Ensure commands were echoed/executed visibly in the attached terminal WebSocket stream
    const combinedStream = receivedTerminalChunks.join('');
    expect(combinedStream).toContain('pwd');
    expect(combinedStream).toContain('nginx -t');
  });
});
