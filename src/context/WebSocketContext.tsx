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

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [rtt, setRtt] = useState<number>(12);
  const wsRef = useRef<WebSocket | null>(null);

  const pendingRequests = useRef<Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>>(new Map());
  const termHandlers = useRef<Map<string, Set<(data: string) => void>>>(new Map());
  const termErrorHandlers = useRef<Map<string, Set<(err: string) => void>>>(new Map());
  const aiCallbacks = useRef<Map<string, any>>(new Map());

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // In dev Vite proxy forwards /ws to ws://localhost:3001/ws
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
    send({ type: 'term:input', sessionId, data });
  }, [send]);

  const resizeTerm = useCallback((sessionId: string, cols: number, rows: number) => {
    send({ type: 'term:resize', sessionId, cols, rows });
  }, [send]);

  const requestSftp = useCallback((type: string, payload: any): Promise<any> => {
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
    messages: any[],
    opsContext: any,
    callbacks: {
      onThinking?: (delta: string) => void;
      onContent?: (delta: string) => void;
      onDone?: (fullContent: string, fullThinking?: string) => void;
      onError?: (err: string) => void;
    }
  ) => {
    const requestId = 'ai-' + Math.random().toString(36).slice(2, 10);
    aiCallbacks.current.set(requestId, callbacks);
    send({ type: 'ai:chat', requestId, messages, opsContext });

    return () => {
      aiCallbacks.current.delete(requestId);
    };
  }, [send]);

  const registerTermHandler = useCallback((sessionId: string, handler: (data: string) => void) => {
    if (!termHandlers.current.has(sessionId)) {
      termHandlers.current.set(sessionId, new Set());
    }
    termHandlers.current.get(sessionId)!.add(handler);
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
