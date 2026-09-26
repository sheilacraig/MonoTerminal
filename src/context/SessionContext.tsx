import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { SessionTab, HostAsset } from '../types';
import { useWebSocket } from './WebSocketContext';
import { useSettings } from './SettingsContext';
import { detectTerminalError, ERROR_BUBBLE_COOLDOWN_MS } from '../utils/errorDetector';
import { checkCommandSafety } from '../utils/guardrail';
import { SHORTCUTS, matchesShortcut } from '../constants/shortcuts';
import { generateId } from '../../shared/id';
import { apiFetch } from '../utils/api';
import { disposeAuthStore } from '../services/terminalAuth';
import { shellIntegrationTracker } from '../utils/shellIntegration';
import { FailedCommandInfo } from '../types';

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
  editingHost: Partial<HostAsset> | null;
  openHostModal: (host?: Partial<HostAsset> | null) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isSnippetModalOpen: boolean;
  setIsSnippetModalOpen: (open: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  sidebarTab: 'sessions' | 'files';
  setSidebarTab: (tab: 'sessions' | 'files') => void;
  dangerPrompt: DangerPromptData | null;
  setDangerPrompt: (data: DangerPromptData | null) => void;
  createSession: (host: HostAsset) => string;
  connectInCurrentTab: (host: HostAsset) => string;
  closeSession: (sessionId: string) => void;
  setActiveSessionId: (id: string) => void;
  toggleMode: (targetMode?: 'shell' | 'agent') => void;
  toggleAgent: (forceState?: boolean) => void;
  setAgentWidth: (sessionId: string, width: number) => void;
  updateSessionStatus: (sessionId: string, status: SessionTab['status']) => void;
  updateSessionTitle: (sessionId: string, newTitle: string) => void;
  updateSessionCwd: (sessionId: string, cwd: string) => void;
  updateSessionTermSize: (sessionId: string, cols: number, rows: number) => void;
  updateSessionFailedCommand: (
    sessionId: string,
    failedCommand: FailedCommandInfo | null,
    exitErrorSnippet?: string | null
  ) => void;
  appendTerminalContext: (sessionId: string, chunk: string) => void;
  clearUnreadError: (sessionId: string) => void;
  executeCommandWithGuardrail: (command: string, executeFn: () => void) => void;
  refreshHosts: () => Promise<void>;
  saveHost: (
    hostData: Partial<HostAsset> & { copyCredentialsFromId?: string }
  ) => Promise<HostAsset | null>;
  deleteHost: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { send, isConnected } = useWebSocket();
  const { settings } = useSettings();

  const [sessions, setSessions] = useState<SessionTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [hosts, setHosts] = useState<HostAsset[]>([]);

  // Modals & Left Dock state
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Partial<HostAsset> | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSnippetModalOpen, setIsSnippetModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'files'>('sessions');
  const [dangerPrompt, setDangerPrompt] = useState<DangerPromptData | null>(null);

  const openHostModal = useCallback((host?: Partial<HostAsset> | null) => {
    setEditingHost(host ?? null);
    setIsHostModalOpen(true);
  }, []);

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
          const cleaned = (json.data as HostAsset[]).filter(
            h => h.id !== 'ops-sandbox' && h.id !== 'mock-local-demo'
          );
          if (cleaned.length > 0) {
            setHosts(cleaned);
            return;
          }
        }
      }
    } catch {
      // Fallback
    }

    const fallbackHosts: HostAsset[] = [
      {
        id: 'local-shell',
        name: '本机终端 (Local Shell)',
        group: '本机终端',
        host: 'localhost',
        port: 0,
        username: 'local',
        authType: 'local',
        initialDir: '~',
        createdAt: Date.now()
      }
    ];
    setHosts(fallbackHosts);
  }, []);

  useEffect(() => {
    refreshHosts();
  }, [refreshHosts]);

  // Create session in a new tab
  const createSession = useCallback(
    (host: HostAsset): string => {
      const id = generateId('sess-');
      const newSession: SessionTab = {
        id,
        hostId: host.id,
        title: host.name,
        status: 'connecting',
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

  // Connect host in the currently active tab (replaces active tab in-place, or creates one if empty)
  const connectInCurrentTab = useCallback(
    (host: HostAsset): string => {
      const currentActive =
        sessionsRef.current.find(s => s.id === activeSessionId) || sessionsRef.current[0];
      if (!currentActive) {
        return createSession(host);
      }

      const oldId = currentActive.id;
      send({ type: 'term:close', sessionId: oldId });
      terminalBuffers.current.delete(oldId);
      lastErrorPrompts.current.delete(oldId);
      const oldSize = termSizesRef.current.get(oldId);
      termSizesRef.current.delete(oldId);
      disposeAuthStore(oldId);
      shellIntegrationTracker.dispose(oldId);

      const newId = generateId('sess-');
      const replacementSession: SessionTab = {
        id: newId,
        hostId: host.id,
        title: host.name,
        status: 'connecting',
        mode: currentActive.mode,
        isAgentOpen: currentActive.isAgentOpen,
        agentWidth: currentActive.agentWidth,
        cwd: host.initialDir || '~',
        terminalContext: '',
        unreadError: null
      };

      setSessions(prev => prev.map(s => (s.id === oldId ? replacementSession : s)));
      setActiveSessionId(newId);

      send({
        type: 'term:init',
        sessionId: newId,
        hostId: host.id,
        cols: oldSize?.cols ?? 120,
        rows: oldSize?.rows ?? 35
      });

      terminalBuffers.current.set(newId, []);
      return newId;
    },
    [activeSessionId, createSession, send]
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
      disposeAuthStore(sessionId);
      shellIntegrationTracker.dispose(sessionId);

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

  const updateSessionStatus = useCallback((sessionId: string, status: SessionTab['status']) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, status } : s)));
  }, []);

  const updateSessionTitle = useCallback((sessionId: string, newTitle: string) => {
    setSessions(prev => prev.map(s => (s.id === sessionId ? { ...s, title: newTitle } : s)));
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
      setSessions(list =>
        list.map(s => (s.status === 'connected' ? { ...s, status: 'connecting' } : s))
      );
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

  const updateSessionFailedCommand = useCallback(
    (
      sessionId: string,
      failedCommand: FailedCommandInfo | null,
      exitErrorSnippet?: string | null
    ) => {
      setSessions(prev =>
        prev.map(s => {
          if (s.id === sessionId) {
            return {
              ...s,
              lastFailedCommand: failedCommand,
              unreadError: exitErrorSnippet !== undefined ? exitErrorSnippet : s.unreadError
            };
          }
          return s;
        })
      );
    },
    []
  );

  const appendTerminalContext = useCallback((sessionId: string, chunk: string) => {
    let lines = terminalBuffers.current.get(sessionId) || [];
    const newLines = chunk.split('\n');
    lines = [...lines, ...newLines].slice(-60); // keep last 60 lines
    terminalBuffers.current.set(sessionId, lines);

    // Check for error in chunk.
    // If the session has semantic shell integration (OSC 133), the exact exit code
    // will drive unreadError instead of heuristic regexes, avoiding false alarms.
    const hasIntegration = shellIntegrationTracker.hasIntegration(sessionId);
    let bubbleSnippet: string | null = null;
    if (!hasIntegration) {
      const check = detectTerminalError(chunk);
      if (check.hasError && check.severity !== 'warning') {
        const snippet = check.snippet || '检测到命令执行异常';
        const last = lastErrorPrompts.current.get(sessionId);
        const now = Date.now();
        if (!last || last.snippet !== snippet || now - last.ts >= ERROR_BUBBLE_COOLDOWN_MS) {
          lastErrorPrompts.current.set(sessionId, { snippet, ts: now });
          bubbleSnippet = snippet;
          send({
            type: 'term:cmd_event',
            sessionId,
            kind: 'heuristic_error',
            output: snippet,
            timestamp: now
          });
        }
      }
    }

    setSessions(prev =>
      prev.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            status: s.status === 'connecting' ? 'connected' : s.status,
            terminalContext: lines.join('\n'),
            unreadError: bubbleSnippet ?? s.unreadError
          };
        }
        return s;
      })
    );
  }, [send]);

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
    async (
      hostData: Partial<HostAsset> & { copyCredentialsFromId?: string }
    ): Promise<HostAsset | null> => {
      try {
        const res = await apiFetch('/api/hosts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hostData)
        });
        if (res.ok) {
          const json = await res.json();
          await refreshHosts();
          return (json.data as HostAsset) || null;
        }
      } catch (e) {
        console.error('Failed to save host', e);
      }
      return null;
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
      const target = e.target as HTMLElement | null;
      if (target?.dataset?.shortcutRecorder === 'true') {
        return;
      }

      // Alt + 1 (Left Dock -> 会话 Tab)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarCollapsed(false);
        setSidebarTab('sessions');
        return;
      }

      // Alt + 2 (Left Dock -> 文件 Tab)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === '2' || e.code === 'Digit2')) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarCollapsed(false);
        setSidebarTab('files');
        return;
      }

      // Ctrl + Shift + N (新建会话属性弹窗)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'N' || e.key === 'n' || e.code === 'KeyN')) {
        e.preventDefault();
        e.stopPropagation();
        openHostModal(null);
        return;
      }

      // Ctrl + , (全局设置弹窗)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        e.stopPropagation();
        setIsSettingsModalOpen(prev => !prev);
        return;
      }

      const sc = settings.shortcuts;
      const toggleModeKey = sc?.toggleMode || SHORTCUTS.TOGGLE_AGENT;
      const toggleSidebarKey = sc?.toggleSidebar || SHORTCUTS.TOGGLE_SIDEBAR;
      const newTabKey = sc?.newTab || SHORTCUTS.NEW_TAB;
      const closeTabKey = sc?.closeTab || SHORTCUTS.CLOSE_TAB;

      // Toggle AI Agent Panel (default: Ctrl + \)
      if (matchesShortcut(e, toggleModeKey)) {
        e.preventDefault();
        e.stopPropagation();
        toggleAgent();
        return;
      }

      // Toggle Left Sidebar (default: Ctrl + Shift + B)
      if (matchesShortcut(e, toggleSidebarKey)) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarCollapsed(prev => !prev);
        return;
      }

      // New Tab (default: Ctrl + Shift + T)
      if (matchesShortcut(e, newTabKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (hosts.length > 0) {
          createSession(hosts[0]);
        } else {
          openHostModal(null);
        }
        return;
      }

      // Close Current Tab (default: Ctrl + Shift + W)
      if (matchesShortcut(e, closeTabKey)) {
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
  }, [
    activeSessionId,
    hosts,
    createSession,
    openHostModal,
    toggleAgent,
    closeSession,
    settings.shortcuts
  ]);

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
        editingHost,
        openHostModal,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isSnippetModalOpen,
        setIsSnippetModalOpen,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        sidebarTab,
        setSidebarTab,
        dangerPrompt,
        setDangerPrompt,
        createSession,
        connectInCurrentTab,
        closeSession,
        setActiveSessionId,
        toggleMode,
        toggleAgent,
        setAgentWidth,
        updateSessionStatus,
        updateSessionTitle,
        updateSessionCwd,
        updateSessionTermSize,
        updateSessionFailedCommand,
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
