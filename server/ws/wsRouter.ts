import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
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

export function setupWsRouter(wss: WebSocketServer, aiService: AIService, auth: AuthContext) {
  // Active mock terminals, shared across connections
  const mockSessions = new Map<string, MockSessionEntry>();

  // Dependencies injected into handlers (instead of importing singletons) so
  // they stay unit-testable — see tests/wsHandlers.test.ts
  const deps: WsDependencies = {
    aiService,
    sshManager,
    storage: localStorageManager,
    mockSessions,
    demoHost: DEMO_HOST,
    createMockSession: (sessionId: string): MockSessionEntry => {
      const mockFs = new MockFileSystem();
      const term = new MockTerminalSession(sessionId, mockFs);
      return { term, fs: mockFs };
    },
    localPtyManager: new LocalPtyManager(),
    localFsManager: new LocalFsManager()
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Handshake trust boundary: Host/Origin allowlist + ?token= bearer
    if (!checkWsAuth(req, auth)) {
      ws.close(4401, 'unauthorized');
      return;
    }

    const clientSessions = new Set<string>();
    const conn: WsConnection = {
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
        mockSessions.delete(sid);
        sshManager.closeSession(sid);
        deps.localPtyManager.closeSession(sid);
      }
    });
  });
}
