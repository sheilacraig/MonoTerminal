import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'http';
import { localStorageManager, HostAsset } from '../storage';
import { sshManager } from '../sshManager';
import { MockFileSystem, MockTerminalSession } from '../mockServer';
import { AIService } from '../aiService';
import { errorMessage } from '../../shared/errors';
import {
  WsInboundMessage,
  WsOutboundMessage,
  validateWsInboundMessage
} from '../../shared/wsProtocol';
import { AuthContext, checkWsAuth } from '../auth';
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
  id: 'mock-local-demo',
  name: 'Demo Linux',
  group: '演示',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'mock',
  initialDir: '/etc/nginx',
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
    }
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
      }
    });
  });
}
