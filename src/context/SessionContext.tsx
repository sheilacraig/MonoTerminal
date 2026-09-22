import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { SessionTab, HostAsset } from '../types';
import { useWebSocket } from './WebSocketContext';
import { useSettings } from './SettingsContext';
import { detectTerminalError, ERROR_BUBBLE_COOLDOWN_MS } from '../utils/errorDetector';
import { checkCommandSafety } from '../utils/guardrail';
import {
  isBackslashEvent,
  isSidebarEvent,
  isNewTabEvent,
  isCloseTabEvent
} from '../constants/shortcuts';
import { generateId } from '../../shared/id';
import { apiFetch } from '../utils/api';

interface DangerPromptData {
  command: string;
  reason: string;
  level: string;
  onConfirm: () => void;
}

interface SessionContextType {
  sessions: SessionTab[];
  activeSessionId: string;
  activeSession: SessionTab | undefined;
  hosts: HostAsset[];
  isHostModalOpen: boolean;
  setIsHostModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isSnippetModalOpen: boolean;
  setIsSnippetModalOpen: (open: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  dangerPrompt: DangerPromptData | null;
  setDangerPrompt: (data: DangerPromptData | null) => void;
  createSession: (host: HostAsset) => string;
  closeSession: (sessionId: string) => void;
  setActiveSessionId: (id: string) => void;
  toggleMode: (targetMode?: 'shell' | 'agent') => void;
  toggleAgent: (forceState?: boolean) => void;
  setAgentWidth: (sessionId: string, width: number) => void;
  updateSessionTitle: (sessionId: string, newTitle: string) => void;
  updateSessionCwd: (sessionId: string, cwd: string) => void;
  updateSessionTermSize: (sessionId: string, cols: number, rows: number) => void;
  appendTerminalContext: (sessionId: string, chunk: string) => void;
  clearUnreadError: (sessionId: string) => void;
  executeCommandWithGuardrail: (command: string, executeFn: () => void) => void;
  refreshHosts: () => Promise<void>;
  saveHost: (hostData: Partial<HostAsset>) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { send, isConnected } = useWebSocket();
  const { settings } = useSettings();

  const [sessions, setSessions] = useState<SessionTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [hosts, setHosts] = useState<HostAsset[]>([]);

  // Modals
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSnippetModalOpen, setIsSnippetModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [dangerPrompt, setDangerPrompt] = useState<DangerPromptData | null>(null);

  const terminalBuffers = useRef<Map<string, string[]>>(new Map());
  // Per-session cooldown for the error bubble: same snippet won't re-trigger
  // within ERROR_BUBBLE_COOLDOWN_MS to avoid a storm of repeated popups
  const lastErrorPrompts = useRef<Map<string, { snippet: string; ts: number }>>(new Map());
  // Last-known pty dimensions per session, updated by TerminalView's
  // ResizeObserver. Kept in a ref (not state) so a resize doesn't re-render
  // the whole tree; consulted by the reconnect effect below to re-issue
  // `term:init` with the CURRENT frontend geometry rather than the default
  // 120x35, so the fresh backend pty starts at the right size.
  const termSizesRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
  // Mirror of `sessions` for the reconnect effect so it can depend only on
  // `isConnected` (session-list churn would otherwise retrigger the effect).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // Edge detector for `isConnected`. `hadDisconnectRef` distinguishes a real
  // reconnect (backend restart, network drop) from the very first handshake
  // — the latter must NOT re-init because `createSession` already emitted
  // `term:init` (which the WebSocket outbox buffers and flushes on open).
  const prevConnectedRef = useRef(isConnected);
  const hadDisconnectRef = useRef(false);

  // Fetch host assets from server
  const refreshHosts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/hosts');
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          setHosts(json.data);
          return;
        }
      }
    } catch {
      // Fallback
    }

    const defaultHost: HostAsset = {
      id: 'local-shell',
      name: '本机终端 (Local Shell)',
      group: '本地',
      host: 'localhost',
      port: 0,
      username: 'local',
      authType: 'local',
      initialDir: '~',
      createdAt: Date.now()
    };
    setHosts([defaultHost]);
  }, []);

  useEffect(() => {
    refreshHosts();
  }, [refreshHosts]);

  // Create session
  const createSession = useCallback(
    (host: HostAsset): string => {
      const id = generateId('sess-');
      const newSession: SessionTab = {
        id,
        hostId: host.id,
        title: host.name,
        status: 'connected',
        mode: 'agent',
        isAgentOpen: true,
        agentWidth: 460,
        cwd: host.initialDir || '~',
        terminalContext: '',
        unreadError: null
      };

      setSessions(prev => [...prev, newSession]);
      setActiveSessionId(id);

      // Initialize terminal on server
      send({
        type: 'term:init',
        sessionId: id,
        hostId: host.id,
        cols: 120,
        rows: 35
      });

      terminalBuffers.current.set(id, []);
      return id;
    },
    [send]
  );

  const hasAutoCreatedRef = useRef(false);

  // Auto-create default session once on initial load if hosts are available
  useEffect(() => {
    if (!hasAutoCreatedRef.current && hosts.length > 0) {
      hasAutoCreatedRef.current = true;
      if (sessions.length === 0) {
        createSession(hosts[0]);
      }
    }
  }, [hosts, sessions.length, createSession]);

  const closeSession = useCallback(
    (sessionId: string) => {
      send({ type: 'term:close', sessionId });
      terminalBuffers.current.delete(sessionId);
      lastErrorPrompts.current.delete(sessionId);
      termSizesRef.current.delete(sessionId);

      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        if (activeSessionId === sessionId && filtered.length > 0) {
          setActiveSessionId(filtered[filtered.length - 1].id);
        }
        return filtered;
      });
    },
    [send, activeSessionId]
  );

  const toggleAgent = useCallback(
    (forceState?: boolean) => {
      setSessions(prev =>
        prev.map(s => {
          if (s.id === activeSessionId) {
            const nextState = forceState !== undefined ? forceState : !s.isAgentOpen;
            return {
              ...s,
              isAgentOpen: nextState,
              mode: nextState ? 'agent' : 'shell',
              unreadError: nextState ? null : s.unreadError // Clear bubble when opened
            };
          }
          return s;
        })
      );
    },
    [activeSessionId]
  );

  const toggleMode = useCallback(
    (targetMode?: 'shell' | 'agent') => {
      if (targetMode === 'agent') toggleAgent(true);
      else if (targetMode === 'shell') toggleAgent(false);
      else toggleAgent();
    },
    [toggleAgent]
  );

  const setAgentWidth = useCallback((sessionId: string, width: number) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, agentWidth: width } : s)));
  }, []);

  const updateSessionTitle = useCallback((sessionId: string, newTitle: string) => {
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, title: newTitle } : s))
    );
  }, []);

  const updateSessionCwd = useCallback((sessionId: string, cwd: string) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, cwd } : s)));
  }, []);

  /**
   * Record the frontend's current pty geometry for a session. Called by
   * TerminalView's ResizeObserver on every fit; kept in a ref so it does not
   * trigger re-renders. Consumed by the reconnect effect below.
   */
  const updateSessionTermSize = useCallback((sessionId: string, cols: number, rows: number) => {
    termSizesRef.current.set(sessionId, { cols, rows });
  }, []);

  /**
   * Backend-restart self-healing. When the WebSocket drops and later
   * reconnects, the backend has no memory of our existing sessions (its pty
   * map lives in process memory), so any keystroke would be met with
   * "session not found". Detect the true → false → true edge and re-emit
   * `term:init` for every live session, using the last-known geometry so the
   * fresh pty matches what the user sees.
   *
   * Skips the very first false → true transition because `createSession`
   * already sent `term:init` for the initial tab (buffered in the WebSocket
   * outbox and flushed on open).
   */
  useEffect(() => {
    const prev = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    if (prev && !isConnected) {
      hadDisconnectRef.current = true;
      return;
    }
    if (!prev && isConnected && hadDisconnectRef.current) {
      hadDisconnectRef.current = false;
      for (const s of sessionsRef.current) {
        const size = termSizesRef.current.get(s.id);
        send({
          type: 'term:init',
          sessionId: s.id,
          hostId: s.hostId,
          cols: size?.cols ?? 120,
          rows: size?.rows ?? 35
        });
      }
    }
  }, [isConnected, send]);

  const appendTerminalContext = useCallback((sessionId: string, chunk: string) => {
    let lines = terminalBuffers.current.get(sessionId) || [];
    const newLines = chunk.split('\n');
    lines = [...lines, ...newLines].slice(-60); // keep last 60 lines
    terminalBuffers.current.set(sessionId, lines);

    // Check for error in chunk.
    // Only critical/error tiers raise the bubble (warnings just enrich the AI
    // context); identical errors are suppressed within the cooldown window.
    const check = detectTerminalError(chunk);
    let bubbleSnippet: string | null = null;
    if (check.hasError && check.severity !== 'warning') {
      const snippet = check.snippet || '检测到命令执行异常';
      const last = lastErrorPrompts.current.get(sessionId);
      const now = Date.now();
      if (!last || last.snippet !== snippet || now - last.ts >= ERROR_BUBBLE_COOLDOWN_MS) {
        lastErrorPrompts.current.set(sessionId, { snippet, ts: now });
        bubbleSnippet = snippet;
      }
    }

    setSessions(prev =>
      prev.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            terminalContext: lines.join('\n'),
            unreadError: bubbleSnippet ?? s.unreadError
          };
        }
        return s;
      })
    );
  }, []);

  const clearUnreadError = useCallback((sessionId: string) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, unreadError: null } : s)));
  }, []);

  // Guardrail command execution checker
  const executeCommandWithGuardrail = useCallback(
    (command: string, executeFn: () => void) => {
      if (!settings.guardrail.enabled) {
        executeFn();
        return;
      }

      const check = checkCommandSafety(command);
      if (check.isDangerous) {
        setDangerPrompt({
          command,
          reason: check.reason || '该命令被识别为高危破坏性操作',
          level: check.level,
          onConfirm: () => {
            setDangerPrompt(null);
            executeFn();
          }
        });
      } else {
        executeFn();
      }
    },
    [settings.guardrail.enabled]
  );

  const saveHost = useCallback(
    async (hostData: Partial<HostAsset>) => {
      try {
        const res = await apiFetch('/api/hosts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hostData)
        });
        if (res.ok) {
          await refreshHosts();
        }
      } catch (e) {
        console.error('Failed to save host', e);
      }
    },
    [refreshHosts]
  );

  const deleteHost = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/api/hosts/${id}`, { method: 'DELETE' });
        await refreshHosts();
      } catch (e) {
        console.error('Failed to delete host', e);
      }
    },
    [refreshHosts]
  );

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + \ (or configured toggle shortcut)
      if ((e.ctrlKey || e.metaKey) && isBackslashEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleAgent();
        return;
      }

      // Ctrl + B (toggle sidebar)
      if ((e.ctrlKey || e.metaKey) && isSidebarEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarCollapsed(prev => !prev);
        return;
      }

      // Ctrl + T (new tab / host picker)
      if ((e.ctrlKey || e.metaKey) && isNewTabEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        setIsHostModalOpen(true);
        return;
      }

      // Ctrl + W (close current tab)
      if ((e.ctrlKey || e.metaKey) && isCloseTabEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (activeSessionId) {
          closeSession(activeSessionId);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeSessionId, toggleAgent, closeSession]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSessionId,
        activeSession,
        hosts,
        isHostModalOpen,
        setIsHostModalOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isSnippetModalOpen,
        setIsSnippetModalOpen,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        dangerPrompt,
        setDangerPrompt,
        createSession,
        closeSession,
        setActiveSessionId,
        toggleMode,
        toggleAgent,
        setAgentWidth,
        updateSessionTitle,
        updateSessionCwd,
        updateSessionTermSize,
        appendTerminalContext,
        clearUnreadError,
        executeCommandWithGuardrail,
        refreshHosts,
        saveHost,
        deleteHost
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
};
