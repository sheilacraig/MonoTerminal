import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import { localStorageManager, HostAsset } from '../storage';
import { sshManager } from '../sshManager';
import { MockFileSystem, MockTerminalSession } from '../mockServer';
import { AIService } from '../aiService';
import { LocalPtyManager } from '../localPtyManager';
import { LocalFsManager } from '../localFsManager';
import { errorMessage } from '../../shared/errors';
import {
  WsInboundMessage,
  WsOutboundMessage,
  validateWsInboundMessage
} from '../../shared/wsProtocol';
import { AuthContext, checkWsAuth } from '../auth';
import os from 'os';
import { dispatchWsMessage } from './handlers';
import type { WsConnection, WsDependencies, MockSessionEntry } from './types';
import { DefaultSessionManager } from '../application/session/DefaultSessionManager';
import { LocalTerminalProvider } from '../infrastructure/terminal/LocalTerminalProvider';
import { SshTerminalProvider } from '../infrastructure/terminal/SshTerminalProvider';
import { MockTerminalProvider } from '../infrastructure/terminal/MockTerminalProvider';
import { LocalFileSystemProvider } from '../infrastructure/filesystem/LocalFileSystemProvider';
import { SftpFileSystemProvider } from '../infrastructure/filesystem/SftpFileSystemProvider';
import { MockFileSystemProvider } from '../infrastructure/filesystem/MockFileSystemProvider';
import { EventEmittingFsProvider } from '../infrastructure/filesystem/EventEmittingFsProvider';
import { InMemoryEventBus } from '../application/events/InMemoryEventBus';
import { CommandEngine } from '../application/command/CommandEngine';
import { ContextEngine } from '../application/context/ContextEngine';
import { GuardrailPipeline } from '../application/security/GuardrailPipeline';
import { ApprovalManager } from '../application/security/ApprovalManager';
import { ShellTool } from '../agent/tools/ShellTool';
import { FileTool } from '../agent/tools/FileTool';
import { GitTool } from '../agent/tools/GitTool';
import { SshTool } from '../agent/tools/SshTool';
import { VerifierRegistry } from '../agent/runtime/Verifier';
import { AgentRuntime } from '../agent/runtime/AgentRuntime';
import { SessionStore } from '../application/session/SessionStore';
import { CommandTimelineService } from '../application/command/CommandTimelineService';
import type { EventBus } from '../domain/events/types';
import type { FileSystemProvider } from '../domain/filesystem/types';

/** Decode raw WebSocket frames (Buffer / ArrayBuffer / fragments) to text. */
function rawToText(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf-8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf-8');
  return Buffer.from(raw).toString('utf-8');
}

const DEMO_HOST: HostAsset = {
  id: 'local-shell',
  name: '本机终端 (Local Shell)',
  group: '本地',
  host: 'localhost',
  port: 0,
  username: os.userInfo().username || 'local',
  authType: 'local',
  initialDir: os.homedir(),
  createdAt: 0
};

function wrapFsProvider(provider: FileSystemProvider, eventBus?: EventBus): FileSystemProvider {
  if (!eventBus) return provider;
  return new EventEmittingFsProvider(provider, eventBus);
}

export function createDefaultSessionManager(params: {
  localPtyManager: LocalPtyManager;
  localFsManager: LocalFsManager;
  sshManager: typeof sshManager;
  mockSessions: Map<string, MockSessionEntry>;
  createMockSession: (sessionId: string) => MockSessionEntry;
  detachGracePeriodMs?: number;
  eventBus?: EventBus;
}): DefaultSessionManager {
  const { eventBus } = params;
  return new DefaultSessionManager({
    terminalProviders: {
      local: new LocalTerminalProvider(params.localPtyManager),
      ssh: new SshTerminalProvider(params.sshManager),
      mock: new MockTerminalProvider(params.mockSessions, params.createMockSession)
    },
    fileSystemProviders: {
      local: wrapFsProvider(new LocalFileSystemProvider(params.localFsManager), eventBus),
      ssh: wrapFsProvider(new SftpFileSystemProvider(params.sshManager), eventBus),
      mock: wrapFsProvider(new MockFileSystemProvider(params.mockSessions), eventBus)
    },
    detachGracePeriodMs: params.detachGracePeriodMs,
    hooks: eventBus
      ? {
          onSessionConnected: session => {
            eventBus.publish({
              type: 'session:connected',
              sessionId: session.id,
              sessionType: session.type,
              hostId: session.host.id,
              cwd: session.terminal.cwd,
              timestamp: Date.now()
            });
          },
          onSessionDisconnected: (session, reason) => {
            eventBus.publish({
              type: 'session:disconnected',
              sessionId: session.id,
              reason,
              timestamp: Date.now()
            });
          }
        }
      : undefined
  });
}

export function setupWsRouter(wss: WebSocketServer, aiService: AIService, auth: AuthContext) {
  // Active mock terminals, shared across connections
  const mockSessions = new Map<string, MockSessionEntry>();
  const localPtyManager = new LocalPtyManager();
  const localFsManager = new LocalFsManager();
  const eventBus = new InMemoryEventBus();
  const createMockSession = (sessionId: string): MockSessionEntry => {
    const mockFs = new MockFileSystem();
    const term = new MockTerminalSession(sessionId, mockFs);
    return { term, fs: mockFs };
  };

  const sessionManager = createDefaultSessionManager({
    localPtyManager,
    localFsManager,
    sshManager,
    mockSessions,
    createMockSession,
    eventBus
  });

  const commandEngine = new CommandEngine(eventBus, (sessionId, cwd) => {
    sessionManager.updateCwd(sessionId, cwd);
  });
  const contextEngine = new ContextEngine(sessionManager, commandEngine, eventBus);
  const guardrailPipeline = new GuardrailPipeline();
  const approvalManager = new ApprovalManager();
  const sessionStore = new SessionStore();
  const timelineService = new CommandTimelineService(eventBus);

  const shellTool = new ShellTool({ sessionManager, sshManager, commandEngine });
  const fileTool = new FileTool(sessionManager);
  const gitTool = new GitTool(shellTool);
  const sshTool = new SshTool(shellTool);
  const verifierRegistry = new VerifierRegistry({ sessionManager, shellTool });

  const agentRuntime = new AgentRuntime({
    sessionManager,
    contextEngine,
    eventBus,
    guardrailPipeline,
    approvalManager,
    tools: [shellTool, fileTool, gitTool, sshTool],
    verifierRegistry
  });

  // Dependencies injected into handlers (instead of importing singletons) so
  // they stay unit-testable — see tests/wsHandlers.test.ts
  const deps: WsDependencies = {
    aiService,
    sshManager,
    storage: localStorageManager,
    mockSessions,
    demoHost: DEMO_HOST,
    createMockSession,
    localPtyManager,
    localFsManager,
    sessionManager,
    eventBus,
    commandEngine,
    contextEngine,
    agentRuntime,
    approvalManager,
    guardrailPipeline,
    sessionStore,
    timelineService
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Handshake trust boundary: Host/Origin allowlist + ?token= bearer
    if (!checkWsAuth(req, auth)) {
      ws.close(4401, 'unauthorized');
      return;
    }

    const connectionId = `conn-${crypto.randomUUID()}`;
    const clientSessions = new Set<string>();
    const conn: WsConnection = {
      connectionId,
      clientSessions,
      socket: ws,
      send: (msg: WsOutboundMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    };

    ws.on('message', async (raw: RawData) => {
      // Trust boundary: parse, then field-validate and rebuild the message
      // (unknown properties are stripped; malformed messages are rejected)
      let msg: WsInboundMessage;
      try {
        const parsed: unknown = JSON.parse(rawToText(raw));
        const check = validateWsInboundMessage(parsed);
        if (!check.ok) {
          console.warn(`[wsRouter] 拒绝非法 WebSocket 消息: ${check.reason}`);
          return;
        }
        msg = check.msg;
      } catch (err) {
        console.warn('[wsRouter] 无法解析的 WebSocket 消息:', errorMessage(err));
        return;
      }

      try {
        await dispatchWsMessage(msg, conn, deps);
      } catch (err) {
        console.error('WebSocket message handling error:', err);
      }
    });

    ws.on('close', () => {
      for (const sid of clientSessions) {
        sessionManager.detach(sid, connectionId);
      }
    });
  });
}
