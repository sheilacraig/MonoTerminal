import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from '../server/application/events/InMemoryEventBus';
import { EventEmittingFsProvider } from '../server/infrastructure/filesystem/EventEmittingFsProvider';
import { MockFileSystemProvider } from '../server/infrastructure/filesystem/MockFileSystemProvider';
import { MockTerminalProvider } from '../server/infrastructure/terminal/MockTerminalProvider';
import { DefaultSessionManager } from '../server/application/session/DefaultSessionManager';
import { CommandEngine } from '../server/application/command/CommandEngine';
import { ContextEngine } from '../server/application/context/ContextEngine';
import { GuardrailPipeline } from '../server/application/security/GuardrailPipeline';
import { ApprovalManager } from '../server/application/security/ApprovalManager';
import { ShellTool } from '../server/agent/tools/ShellTool';
import { FileTool } from '../server/agent/tools/FileTool';
import { AgentRuntime } from '../server/agent/runtime/AgentRuntime';
import { SessionStore } from '../server/application/session/SessionStore';
import { CommandTimelineService } from '../server/application/command/CommandTimelineService';
import { MockFileSystem, MockTerminalSession } from '../server/mockServer';
import type { MockSessionEntry } from '../server/ws/types';

describe('Phase 13 & 14: SessionStore & CommandTimelineService', () => {
  it('captures and restores lightweight session state across engines without scrollback', async () => {
    const tmpFile = path.join(os.tmpdir(), `mono-session-store-${Date.now()}.json`);
    try {
      const eventBus = new InMemoryEventBus();
      const mockSessions = new Map<string, MockSessionEntry>();
      const createMockSession = (sessionId: string): MockSessionEntry => ({
        term: new MockTerminalSession(sessionId, new MockFileSystem()),
        fs: new MockFileSystem()
      });

      const mockTermProvider = new MockTerminalProvider(mockSessions, createMockSession);
      const fsProvider = new EventEmittingFsProvider(
        new MockFileSystemProvider(mockSessions),
        eventBus
      );

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

      const commandEngine = new CommandEngine(eventBus, (sid, cwd) =>
        sessionManager.updateCwd(sid, cwd)
      );
      const contextEngine = new ContextEngine(sessionManager, commandEngine, eventBus);
      const agentRuntime = new AgentRuntime({
        sessionManager,
        contextEngine,
        eventBus,
        guardrailPipeline: new GuardrailPipeline(),
        approvalManager: new ApprovalManager(),
        tools: [new ShellTool({ sessionManager, commandEngine }), new FileTool(sessionManager)]
      });

      await sessionManager.create({
        id: 'sess-persist',
        host: {
          id: 'mock-p',
          name: 'Persist Host',
          group: 'Prod',
          host: '10.0.0.8',
          port: 22,
          username: 'root',
          authType: 'mock',
          initialDir: '/etc/nginx',
          createdAt: 0
        },
        cols: 100,
        rows: 30
      });

      commandEngine.ingestClientEvent({
        sessionId: 'sess-persist',
        kind: 'cwd',
        cwd: '/var/log/nginx',
        timestamp: 1000
      });
      commandEngine.ingestClientEvent({
        sessionId: 'sess-persist',
        kind: 'finished',
        command: 'tail -n 20 error.log',
        cwd: '/var/log/nginx',
        exitCode: 0,
        output: '2026/09/25 [error] upstream timed out',
        timestamp: 2000
      });
      await fsProvider.read('sess-persist', '/etc/nginx/nginx.conf');
      await agentRuntime.runPlan('sess-persist', '检查当前目录');

      const store1 = new SessionStore({ filePath: tmpFile });
      const snap = store1.captureFromEngines('sess-persist', {
        sessionManager,
        commandEngine,
        contextEngine,
        agentRuntime
      });

      expect(snap).toBeDefined();
      expect(snap?.cwd).toBe('/var/log/nginx');
      expect(snap?.openFiles).toContain('/etc/nginx/nginx.conf');
      expect(snap?.recentCommands.length).toBeGreaterThanOrEqual(1);
      expect(snap?.activePlan?.status).toBe('completed');

      // Reload from disk in a fresh SessionStore instance and restore into fresh engines
      const store2 = new SessionStore({ filePath: tmpFile });
      const loaded = store2.getSnapshot('sess-persist');
      expect(loaded?.cwd).toBe('/var/log/nginx');

      const freshCommandEngine = new CommandEngine(eventBus);
      const freshContextEngine = new ContextEngine(sessionManager, freshCommandEngine, eventBus);
      const freshAgentRuntime = new AgentRuntime({
        sessionManager,
        contextEngine: freshContextEngine,
        eventBus,
        guardrailPipeline: new GuardrailPipeline(),
        approvalManager: new ApprovalManager(),
        tools: []
      });

      store2.restoreIntoEngines('sess-persist', {
        sessionManager,
        commandEngine: freshCommandEngine,
        contextEngine: freshContextEngine,
        agentRuntime: freshAgentRuntime
      });

      expect(freshCommandEngine.getCwd('sess-persist')).toBe('/var/log/nginx');
      expect(freshCommandEngine.recent('sess-persist').length).toBeGreaterThanOrEqual(1);
      expect(freshAgentRuntime.getActivePlan('sess-persist')?.status).toBe('completed');
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  it('aggregates unified command, file, agent, and session events in CommandTimelineService', () => {
    const eventBus = new InMemoryEventBus();
    const timeline = new CommandTimelineService(eventBus);

    eventBus.publish({
      type: 'session:connected',
      sessionId: 'sess-tl',
      sessionType: 'mock',
      hostId: 'h1',
      cwd: '/etc/nginx',
      timestamp: 100
    });

    eventBus.publish({
      type: 'command:started',
      sessionId: 'sess-tl',
      commandId: 'c1',
      command: 'nginx -t',
      cwd: '/etc/nginx',
      timestamp: 200
    });

    eventBus.publish({
      type: 'command:finished',
      sessionId: 'sess-tl',
      commandId: 'c1',
      command: 'nginx -t',
      exitCode: 0,
      cwd: '/etc/nginx',
      durationMs: 15,
      timestamp: 215
    });

    eventBus.publish({
      type: 'file:saved',
      sessionId: 'sess-tl',
      path: '/etc/nginx/nginx.conf',
      byteLength: 512,
      timestamp: 300
    });

    eventBus.publish({
      type: 'agent:started',
      sessionId: 'sess-tl',
      planId: 'p1',
      goal: '诊断 Nginx',
      timestamp: 400
    });

    eventBus.publish({
      type: 'agent:finished',
      sessionId: 'sess-tl',
      planId: 'p1',
      status: 'completed',
      summary: '全部完成',
      timestamp: 500
    });

    const entries = timeline.getTimeline('sess-tl');
    // command:started + command:finished share id `tl-cmd-c1` (updated in place),
    // agent:started + agent:finished share id `tl-plan-p1` (updated in place)
    expect(entries).toHaveLength(4);
    expect(entries.map(e => e.kind)).toEqual(['session', 'command', 'file', 'agent']);
    expect(entries[1].status).toBe('success');
    expect(entries[3].status).toBe('success');

    timeline.dispose();
  });
});
