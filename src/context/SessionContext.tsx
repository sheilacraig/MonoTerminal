import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { SessionTab, HostAsset } from '../types';
import { useWebSocket } from './WebSocketContext';
import { useSettings } from './SettingsContext';
import { detectTerminalError } from '../utils/errorDetector';
import { checkCommandSafety } from '../utils/guardrail';
import { isBackslashEvent, isSidebarEvent, isNewTabEvent, isCloseTabEvent } from '../constants/shortcuts';

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
  updateSessionCwd: (sessionId: string, cwd: string) => void;
  appendTerminalContext: (sessionId: string, chunk: string) => void;
  clearUnreadError: (sessionId: string) => void;
  executeCommandWithGuardrail: (command: string, executeFn: () => void) => void;
  refreshHosts: () => Promise<void>;
  saveHost: (hostData: Partial<HostAsset>) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { send, sendTermInput } = useWebSocket();
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

  // Fetch host assets from server
  const refreshHosts = useCallback(async () => {
    try {
      const res = await fetch('/api/hosts');
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
      id: 'mock-local-demo',
      name: 'Demo-Linux (内置仿真沙盒)',
      group: '开发/演示',
      host: '127.0.0.1',
      port: 22,
      username: 'root',
      authType: 'mock',
      initialDir: '/etc/nginx',
      createdAt: Date.now()
    };
    setHosts([defaultHost]);
  }, []);

  useEffect(() => {
    refreshHosts();
  }, [refreshHosts]);

  // Create session
  const createSession = useCallback((host: HostAsset): string => {
    const id = 'sess-' + Math.random().toString(36).slice(2, 9);
    const newSession: SessionTab = {
      id,
      hostId: host.id,
      title: host.name,
      status: 'connected',
      mode: 'shell',
      isAgentOpen: false,
      agentWidth: 460,
      cwd: host.initialDir || '/etc/nginx',
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
  }, [send]);

  // Auto-create default session if none exists once hosts are loaded
  useEffect(() => {
    if (sessions.length === 0 && hosts.length > 0) {
      createSession(hosts[0]);
    }
  }, [hosts, sessions.length, createSession]);

  const closeSession = useCallback((sessionId: string) => {
    send({ type: 'term:close', sessionId });
    terminalBuffers.current.delete(sessionId);

    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessionId);
      if (activeSessionId === sessionId && filtered.length > 0) {
        setActiveSessionId(filtered[filtered.length - 1].id);
      }
      return filtered;
    });
  }, [send, activeSessionId]);

  const toggleAgent = useCallback((forceState?: boolean) => {
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
  }, [activeSessionId]);

  const toggleMode = useCallback((targetMode?: 'shell' | 'agent') => {
    if (targetMode === 'agent') toggleAgent(true);
    else if (targetMode === 'shell') toggleAgent(false);
    else toggleAgent();
  }, [toggleAgent]);

  const setAgentWidth = useCallback((sessionId: string, width: number) => {
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, agentWidth: width } : s))
    );
  }, []);

  const updateSessionCwd = useCallback((sessionId: string, cwd: string) => {
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, cwd } : s))
    );
  }, []);

  const appendTerminalContext = useCallback((sessionId: string, chunk: string) => {
    let lines = terminalBuffers.current.get(sessionId) || [];
    const newLines = chunk.split('\n');
    lines = [...lines, ...newLines].slice(-60); // keep last 60 lines
    terminalBuffers.current.set(sessionId, lines);

    // Check for error in chunk
    const check = detectTerminalError(chunk);
    setSessions(prev =>
      prev.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            terminalContext: lines.join('\n'),
            unreadError: check.hasError ? (check.snippet || '检测到命令执行异常') : s.unreadError
          };
        }
        return s;
      })
    );
  }, []);

  const clearUnreadError = useCallback((sessionId: string) => {
    setSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, unreadError: null } : s))
    );
  }, []);

  // Guardrail command execution checker
  const executeCommandWithGuardrail = useCallback((command: string, executeFn: () => void) => {
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
  }, [settings.guardrail.enabled]);

  const saveHost = useCallback(async (hostData: Partial<HostAsset>) => {
    try {
      const res = await fetch('/api/hosts', {
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
  }, [refreshHosts]);

  const deleteHost = useCallback(async (id: string) => {
    try {
      await fetch(`/api/hosts/${id}`, { method: 'DELETE' });
      await refreshHosts();
    } catch (e) {
      console.error('Failed to delete host', e);
    }
  }, [refreshHosts]);

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
        updateSessionCwd,
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
