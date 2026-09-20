import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketContextType {
  isConnected: boolean;
  rtt: number;
  send: (msg: any) => void;
  sendTermInput: (sessionId: string, data: string) => void;
  resizeTerm: (sessionId: string, cols: number, rows: number) => void;
  requestSftp: (type: string, payload: any) => Promise<any>;
  streamAI: (
    messages: any[],
    opsContext: any,
    callbacks: {
      onThinking?: (delta: string) => void;
      onContent?: (delta: string) => void;
      onDone?: (fullContent: string, fullThinking?: string) => void;
      onError?: (err: string) => void;
    }
  ) => () => void;
  registerTermHandler: (sessionId: string, handler: (data: string) => void) => () => void;
  registerTermErrorHandler: (sessionId: string, handler: (err: string) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const isStaticDemo = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') ||
  window.location.protocol === 'file:'
);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(isStaticDemo);
  const [rtt, setRtt] = useState<number>(isStaticDemo ? 1 : 12);
  const wsRef = useRef<WebSocket | null>(null);

  const pendingRequests = useRef<Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>>(new Map());
  const termHandlers = useRef<Map<string, Set<(data: string) => void>>>(new Map());
  const termErrorHandlers = useRef<Map<string, Set<(err: string) => void>>>(new Map());
  const aiCallbacks = useRef<Map<string, any>>(new Map());

  const connect = useCallback(() => {
    if (isStaticDemo) {
      setIsConnected(true);
      setRtt(1);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type } = msg;

        if (type === 'pong') {
          const now = Date.now();
          const latency = Math.max(1, now - msg.clientTime);
          setRtt(latency);
          return;
        }

        if (type === 'term:data') {
          const handlers = termHandlers.current.get(msg.sessionId);
          handlers?.forEach(h => h(msg.data));
          return;
        }

        if (type === 'term:error') {
          const handlers = termErrorHandlers.current.get(msg.sessionId);
          handlers?.forEach(h => h(msg.message));
          return;
        }

        if (type === 'sftp:response') {
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

        if (type.startsWith('ai:')) {
          const cb = aiCallbacks.current.get(msg.requestId);
          if (cb) {
            if (type === 'ai:thinking') cb.onThinking?.(msg.delta);
            if (type === 'ai:content') cb.onContent?.(msg.delta);
            if (type === 'ai:done') {
              cb.onDone?.(msg.fullContent, msg.fullThinking);
              aiCallbacks.current.delete(msg.requestId);
            }
            if (type === 'ai:error') {
              cb.onError?.(msg.error);
              aiCallbacks.current.delete(msg.requestId);
            }
          }
          return;
        }
      } catch (err) {
        console.error('WS parse error', err);
      }
    };
  }, []);

  useEffect(() => {
    connect();

    if (isStaticDemo) return;

    // RTT Heartbeat ping every 3 seconds
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      }
    }, 3000);

    return () => {
      clearInterval(pingInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const send = useCallback((msg: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendTermInput = useCallback((sessionId: string, data: string) => {
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
  }, [send]);

  const resizeTerm = useCallback((sessionId: string, cols: number, rows: number) => {
    if (isStaticDemo) return;
    send({ type: 'term:resize', sessionId, cols, rows });
  }, [send]);

  const requestSftp = useCallback((type: string, payload: any): Promise<any> => {
    if (isStaticDemo) {
      if (type === 'sftp:list') {
        return Promise.resolve([
          { name: 'conf.d', path: '/etc/nginx/conf.d', isDirectory: true, size: 4096, modifyTime: Date.now() - 3600000, permissions: '0755', owner: 'root' },
          { name: 'ssl', path: '/etc/nginx/ssl', isDirectory: true, size: 4096, modifyTime: Date.now() - 3600000, permissions: '0755', owner: 'root' },
          { name: 'nginx.conf', path: '/etc/nginx/nginx.conf', isDirectory: false, size: 842, modifyTime: Date.now() - 1800000, permissions: '0644', owner: 'root' }
        ]);
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
}`
        );
      }
      return Promise.resolve({ success: true });
    }

    return new Promise((resolve, reject) => {
      const requestId = 'req-' + Math.random().toString(36).slice(2, 10);
      pendingRequests.current.set(requestId, { resolve, reject });
      send({ type, requestId, ...payload });

      // Timeout after 20s
      setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          reject(new Error('SFTP 请求超时'));
        }
      }, 20000);
    });
  }, [send]);

  const streamAI = useCallback((
    _messages: any[],
    _opsContext: any,
    callbacks: {
      onThinking?: (delta: string) => void;
      onContent?: (delta: string) => void;
      onDone?: (fullContent: string, fullThinking?: string) => void;
      onError?: (err: string) => void;
    }
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
      callbacks.onThinking?.("正在分析终端日志上下文与 Nginx 启动异常...");
      const timer = setTimeout(() => {
        callbacks.onContent?.(diagnosis);
        callbacks.onDone?.(diagnosis, "已分析最近 50 行终端输出与错误日志");
      }, 500);
      return () => clearTimeout(timer);
    }

    const requestId = 'ai-' + Math.random().toString(36).slice(2, 10);
    aiCallbacks.current.set(requestId, callbacks);
    send({ type: 'ai:chat', requestId, messages: _messages, opsContext: _opsContext });

    return () => {
      aiCallbacks.current.delete(requestId);
    };
  }, [send]);

  const registerTermHandler = useCallback((sessionId: string, handler: (data: string) => void) => {
    if (!termHandlers.current.has(sessionId)) {
      termHandlers.current.set(sessionId, new Set());
    }
    termHandlers.current.get(sessionId)!.add(handler);

    if (isStaticDemo) {
      setTimeout(() => {
        handler(
          "\x1b[32m=== MonoTerminal 演示环境 (Ubuntu 22.04 LTS) ===\x1b[0m\r\n" +
          "\x1b[90m当前页面运行在 GitHub Pages 静态演示环境中。\x1b[0m\r\n" +
          "\x1b[90m提示：按 [Ctrl + \\] 呼出 AI 排错助手，即可自动提取报错上下文并生成修复命令。\x1b[0m\r\n\r\n" +
          "\x1b[31m2026/09/20 18:42:12 [emerg] 1042#1042: bind() to 0.0.0.0:80 failed (98: Address already in use)\x1b[0m\r\n" +
          "\x1b[31mnginx.service: Failed with result 'exit-code'.\x1b[0m\r\n\r\n" +
          "root@prod-web01:/etc/nginx# "
        );
      }, 200);
    }

    return () => {
      termHandlers.current.get(sessionId)?.delete(handler);
    };
  }, []);

  const registerTermErrorHandler = useCallback((sessionId: string, handler: (err: string) => void) => {
    if (!termErrorHandlers.current.has(sessionId)) {
      termErrorHandlers.current.set(sessionId, new Set());
    }
    termErrorHandlers.current.get(sessionId)!.add(handler);
    return () => {
      termErrorHandlers.current.get(sessionId)?.delete(handler);
    };
  }, []);

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
