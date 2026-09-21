import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { generateId } from '../../shared/id';
import {
  WsInboundMessage,
  WsOutboundMessage,
  SftpRequestType,
  ChatPayload,
  OpsContextPayload,
  AiStreamCallbacks
} from '../../shared/wsProtocol';
import { getAuthToken, invalidateAuthToken } from '../utils/api';

interface WebSocketContextType {
  isConnected: boolean;
  rtt: number;
  send: (msg: WsInboundMessage) => void;
  sendTermInput: (sessionId: string, data: string) => void;
  resizeTerm: (sessionId: string, cols: number, rows: number) => void;
  requestSftp: <T = unknown>(type: SftpRequestType, payload: Record<string, unknown>) => Promise<T>;
  streamAI: (
    messages: ChatPayload[],
    opsContext: OpsContextPayload | undefined,
    callbacks: AiStreamCallbacks
  ) => () => void;
  registerTermHandler: (sessionId: string, handler: (data: string) => void) => () => void;
  registerTermErrorHandler: (sessionId: string, handler: (err: string) => void) => () => void;
}

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const isStaticDemo =
  typeof window !== 'undefined' &&
  (window.location.hostname.includes('github.io') || window.location.protocol === 'file:');

/**
 * Upper bound on messages buffered while the socket is not yet OPEN.
 * Guards against unbounded growth if the backend stays unreachable —
 * once exceeded, oldest entries are dropped so a long-offline tab does
 * not OOM when it eventually reconnects.
 */
const MAX_OUTBOX = 200;

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(isStaticDemo);
  const [rtt, setRtt] = useState<number>(isStaticDemo ? 1 : 12);
  const wsRef = useRef<WebSocket | null>(null);

  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());
  const termHandlers = useRef<Map<string, Set<(data: string) => void>>>(new Map());
  const termErrorHandlers = useRef<Map<string, Set<(err: string) => void>>>(new Map());
  const aiCallbacks = useRef<Map<string, AiStreamCallbacks>>(new Map());
  // Messages emitted while the socket is still CONNECTING (or between
  // reconnect attempts) are parked here and flushed on `ws.onopen` in FIFO
  // order. Without this buffer, `SessionContext.createSession` and
  // `useSftp.loadDirectory` — which fire during the initial render before
  // `getAuthToken()` resolves — would silently drop `term:init` / `sftp:list`,
  // leaving the terminal blank and the SFTP panel hanging on a 20s timeout.
  const outboxRef = useRef<WsInboundMessage[]>([]);

  // Lifecycle guards against the React 18 StrictMode / HMR ghost-reconnect
  // loop. Without these, `useEffect` cleanup calls `ws.close()`, whose async
  // `onclose` handler then schedules `setTimeout(connect, 2000)`. Two seconds
  // later that timer creates a second live socket while the remounted effect
  // has already created its own — leaking a duplicate connection and double
  // heartbeat pings. `disposedRef` blocks reconnects after unmount,
  // `reconnectTimerRef` lets cleanup cancel an in-flight timer, and the
  // socket identity check (`wsRef.current === ws`) makes stale `onclose`
  // callbacks from a superseded socket no-op.
  const disposedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const flushOutbox = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const queued = outboxRef.current;
    if (queued.length === 0) return;
    outboxRef.current = [];
    for (const msg of queued) {
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        console.error('WS flush failed, requeueing', err);
        // Requeue the remainder so a transient send error does not lose
        // subsequent messages; the socket will retry on the next open.
        outboxRef.current = queued.slice(queued.indexOf(msg));
        break;
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    if (isStaticDemo) {
      setIsConnected(true);
      setRtt(1);
      return;
    }

    // Concurrency guard: if a socket is already connecting or open, this
    // call is a duplicate (e.g. stray reconnect timer firing alongside a
    // fresh mount). Bail out instead of creating a parallel connection.
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Handshake carries the bootstrap token (query param — browsers cannot
    // set headers on WebSocket upgrades)
    void (async () => {
      const token = await getAuthToken();
      // The await above can outlive the component (StrictMode double-invoke,
      // route change, HMR). If we were disposed mid-flight, do not create
      // the socket — otherwise it becomes an untracked leak.
      if (disposedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // If a newer socket has already superseded this one (rare race
        // during fast remounts), close the orphan and ignore its events.
        if (disposedRef.current || wsRef.current !== ws) {
          try {
            ws.close();
          } catch {
            /* already closing */
          }
          return;
        }
        setIsConnected(true);
        // Drain any messages buffered during CONNECTING / previous outage
        flushOutbox();
      };

      ws.onclose = ev => {
        // Stale socket (superseded by a newer connect() or detached by
        // cleanup): drop all bookkeeping so it cannot mutate state or
        // schedule a reconnect for a lifecycle it no longer belongs to.
        if (wsRef.current !== ws) return;

        setIsConnected(false);
        // 4401: server rejected the token (typically a backend restart with a
        // fresh token) — drop the stale one so the next attempt re-bootstraps
        if (ev.code === 4401) {
          invalidateAuthToken();
        }
        // Fail any in-flight SFTP requests immediately — otherwise callers
        // would sit on their 20s timeout waiting for a response that can
        // never arrive on this socket instance.
        if (pendingRequests.current.size > 0) {
          const err = new Error('WebSocket 连接已断开');
          pendingRequests.current.forEach(req => req.reject(err));
          pendingRequests.current.clear();
        }
        // Same for streaming AI requests
        if (aiCallbacks.current.size > 0) {
          aiCallbacks.current.forEach(cb => cb.onError?.('WebSocket 连接已断开'));
          aiCallbacks.current.clear();
        }

        // Do NOT reconnect if the provider has been unmounted — cleanup
        // intentionally closed this socket.
        if (disposedRef.current) return;

        // Detach so the identity check above fails if this handler somehow
        // re-fires, and so the next connect() concurrency guard sees null.
        wsRef.current = null;
        cancelReconnect();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, 2000);
      };

      ws.onerror = () => {
        if (wsRef.current === ws) setIsConnected(false);
      };

      ws.onmessage = event => {
        // Single trust-boundary cast; branches below narrow via msg.type
        let msg: WsOutboundMessage;
        try {
          msg = JSON.parse(event.data as string) as WsOutboundMessage;
        } catch (err) {
          console.error('WS parse error', err);
          return;
        }

        switch (msg.type) {
          case 'pong': {
            const latency = Math.max(1, Date.now() - msg.clientTime);
            setRtt(latency);
            return;
          }

          case 'term:data': {
            const handlers = termHandlers.current.get(msg.sessionId);
            handlers?.forEach(h => h(msg.data));
            return;
          }

          case 'term:error': {
            const handlers = termErrorHandlers.current.get(msg.sessionId);
            handlers?.forEach(h => h(msg.message));
            return;
          }

          case 'sftp:response': {
            const req = pendingRequests.current.get(msg.requestId);
            if (req) {
              pendingRequests.current.delete(msg.requestId);
              if (msg.success) {
                req.resolve(msg.data);
              } else {
                req.reject(new Error(msg.error || 'SFTP request failed'));
              }
            }
            return;
          }

          case 'ai:thinking':
          case 'ai:content':
          case 'ai:done':
          case 'ai:error': {
            const cb = aiCallbacks.current.get(msg.requestId);
            if (!cb) return;
            switch (msg.type) {
              case 'ai:thinking':
                cb.onThinking?.(msg.delta);
                break;
              case 'ai:content':
                cb.onContent?.(msg.delta);
                break;
              case 'ai:done':
                cb.onDone?.(msg.fullContent, msg.fullThinking);
                aiCallbacks.current.delete(msg.requestId);
                break;
              case 'ai:error':
                cb.onError?.(msg.error);
                aiCallbacks.current.delete(msg.requestId);
                break;
            }
            return;
          }

          default: {
            // term:ready / term:close currently need no client-side dispatch
            return;
          }
        }
      };
    })();
  }, [flushOutbox, cancelReconnect]);

  useEffect(() => {
    // Reset the disposal flag on every (re)mount so StrictMode's
    // mount → cleanup → mount sequence re-arms the provider correctly.
    disposedRef.current = false;
    connect();

    if (isStaticDemo) return;

    // RTT Heartbeat ping every 3 seconds
    const pingInterval = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() } satisfies WsInboundMessage));
      }
    }, 3000);

    return () => {
      // Order matters:
      // 1. Mark disposed so any in-flight `await getAuthToken()` bails and
      //    no future `onclose` schedules a reconnect.
      // 2. Cancel a pending reconnect timer left over from a prior drop.
      // 3. Detach wsRef BEFORE close() so the socket's async `onclose`
      //    handler fails its identity check and becomes a no-op.
      // 4. Close the socket.
      // 5. Clear interval + outbox.
      disposedRef.current = true;
      cancelReconnect();
      clearInterval(pingInterval);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closing/closed */
        }
      }
      outboxRef.current = [];
    };
  }, [connect, cancelReconnect]);

  const send = useCallback((msg: WsInboundMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return;
    }
    // Not yet OPEN (CONNECTING, or socket not created because getAuthToken
    // is still resolving, or CLOSING/reconnecting after a drop). Buffer for
    // later flush instead of silently dropping — critical for the first-load
    // `term:init` / `sftp:list` race.
    outboxRef.current.push(msg);
    if (outboxRef.current.length > MAX_OUTBOX) {
      outboxRef.current.splice(0, outboxRef.current.length - MAX_OUTBOX);
    }
  }, []);

  const sendTermInput = useCallback(
    (sessionId: string, data: string) => {
      if (isStaticDemo) {
        const handlers = termHandlers.current.get(sessionId);
        if (data === '\r' || data === '\n') {
          handlers?.forEach(h => h('\r\nroot@prod-web01:/etc/nginx# '));
        } else if (data === '\x7f' || data === '\b') {
          handlers?.forEach(h => h('\b \b'));
        } else {
          handlers?.forEach(h => h(data));
        }
        return;
      }
      send({ type: 'term:input', sessionId, data });
    },
    [send]
  );

  const resizeTerm = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      if (isStaticDemo) return;
      send({ type: 'term:resize', sessionId, cols, rows });
    },
    [send]
  );

  const requestSftp = useCallback(
    <T = unknown,>(type: SftpRequestType, payload: Record<string, unknown>): Promise<T> => {
      if (isStaticDemo) {
        if (type === 'sftp:list') {
          return Promise.resolve([
            {
              name: 'conf.d',
              path: '/etc/nginx/conf.d',
              isDirectory: true,
              size: 4096,
              modifyTime: Date.now() - 3600000,
              permissions: '0755',
              owner: 'root'
            },
            {
              name: 'ssl',
              path: '/etc/nginx/ssl',
              isDirectory: true,
              size: 4096,
              modifyTime: Date.now() - 3600000,
              permissions: '0755',
              owner: 'root'
            },
            {
              name: 'nginx.conf',
              path: '/etc/nginx/nginx.conf',
              isDirectory: false,
              size: 842,
              modifyTime: Date.now() - 1800000,
              permissions: '0644',
              owner: 'root'
            }
          ] as unknown as T);
        }
        if (type === 'sftp:read') {
          return Promise.resolve(
            `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  server {
    listen 80;
    server_name localhost;

    location / {
      proxy_pass http://127.0.0.1:3000;
    }
  }
}` as unknown as T
          );
        }
        return Promise.resolve({ success: true } as unknown as T);
      }

      return new Promise<T>((resolve, reject) => {
        const requestId = generateId('req-');
        pendingRequests.current.set(requestId, {
          resolve: val => resolve(val as T),
          reject
        });
        // Dynamically assembled request: `type` + payload fields together form
        // one of the Sftp*Message union members (see shared/wsProtocol.ts)
        send({ type, requestId, ...payload } as unknown as WsInboundMessage);

        // Timeout after 20s
        setTimeout(() => {
          if (pendingRequests.current.has(requestId)) {
            pendingRequests.current.delete(requestId);
            reject(new Error('SFTP 请求超时'));
          }
        }, 20000);
      });
    },
    [send]
  );

  const streamAI = useCallback(
    (
      messages: ChatPayload[],
      opsContext: OpsContextPayload | undefined,
      callbacks: AiStreamCallbacks
    ) => {
      if (isStaticDemo) {
        const diagnosis = `经排查分析，80 端口已被外部进程占用，导致 Nginx 服务启动失败（(98: Address already in use)）。

建议执行以下命令排查占用进程并释放端口：

\`\`\`bash
sudo lsof -i :80
\`\`\`

确认占用进程 PID 后，释放端口并重启服务：

\`\`\`bash
sudo kill -9 $(sudo lsof -t -i :80)
sudo systemctl restart nginx
\`\`\``;
        callbacks.onThinking?.('正在分析终端日志上下文与 Nginx 启动异常...');
        const timer = setTimeout(() => {
          callbacks.onContent?.(diagnosis);
          callbacks.onDone?.(diagnosis, '已分析最近 50 行终端输出与错误日志');
        }, 500);
        return () => clearTimeout(timer);
      }

      const requestId = generateId('ai-');
      aiCallbacks.current.set(requestId, callbacks);
      send({ type: 'ai:chat', requestId, messages, opsContext });

      return () => {
        aiCallbacks.current.delete(requestId);
      };
    },
    [send]
  );

  const registerTermHandler = useCallback((sessionId: string, handler: (data: string) => void) => {
    if (!termHandlers.current.has(sessionId)) {
      termHandlers.current.set(sessionId, new Set());
    }
    termHandlers.current.get(sessionId)!.add(handler);

    if (isStaticDemo) {
      setTimeout(() => {
        handler(
          '\x1b[32m=== MonoTerminal 演示环境 (Ubuntu 22.04 LTS) ===\x1b[0m\r\n' +
            '\x1b[90m当前页面运行在 GitHub Pages 静态演示环境中。\x1b[0m\r\n' +
            '\x1b[90m提示：按 [Ctrl + \\] 呼出 AI 排错助手，即可自动提取报错上下文并生成修复命令。\x1b[0m\r\n\r\n' +
            '\x1b[31m2026-09-20 18:42:12 [emerg] 1042#1042: bind() to 0.0.0.0:80 failed (98: Address already in use)\x1b[0m\r\n' +
            "\x1b[31mnginx.service: Failed with result 'exit-code'.\x1b[0m\r\n\r\n" +
            'root@prod-web01:/etc/nginx# '
        );
      }, 200);
    }

    return () => {
      termHandlers.current.get(sessionId)?.delete(handler);
    };
  }, []);

  const registerTermErrorHandler = useCallback(
    (sessionId: string, handler: (err: string) => void) => {
      if (!termErrorHandlers.current.has(sessionId)) {
        termErrorHandlers.current.set(sessionId, new Set());
      }
      termErrorHandlers.current.get(sessionId)!.add(handler);
      return () => {
        termErrorHandlers.current.get(sessionId)?.delete(handler);
      };
    },
    []
  );

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        rtt,
        send,
        sendTermInput,
        resizeTerm,
        requestSftp,
        streamAI,
        registerTermHandler,
        registerTermErrorHandler
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within WebSocketProvider');
  return context;
};
