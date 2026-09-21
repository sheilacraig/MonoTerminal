import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../types';
import { generateId } from '../../shared/id';
import { useSession } from './SessionContext';
import { useWebSocket } from './WebSocketContext';

/**
 * Per-session AI chat state, hosted above the `AgentView` mount boundary.
 *
 * Historically this state lived inside `useAgentChat` (a plain hook called
 * from `AgentView`). Because `MainWorkspace` renders `AgentView` conditionally
 * (`{isAgentOpen && <AgentView/>}`), collapsing the panel with Ctrl+\ would
 * unmount the component and blow away the message list, thinking traces and
 * command explanations. This provider lifts the state into a store keyed by
 * `sessionId` so:
 *
 *   • Fold/unfold preserves the full conversation.
 *   • Switching tabs gives each session its own isolated history (the old
 *     implementation silently shared one array across all tabs).
 *   • Streaming continues while the panel is collapsed — deltas land in the
 *     store and are visible the moment the user reopens.
 *   • Closing a tab garbage-collects its entry and aborts any in-flight stream.
 */

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  expandedThinking: Record<string, boolean>;
  commandExplanations: Record<string, string>;
  input: string;
}

interface AgentChatContextType extends ChatState {
  setInput: (value: string) => void;
  toggleThinking: (msgId: string) => void;
  sendMessage: (content: string) => void;
  runCommand: (cmd: string) => void;
  fillCommand: (cmd: string) => void;
  explainCommand: (cmd: string) => void;
}

const GREETING_CONTENT =
  '👋 您好！我是 MonoTerminal 智能运维助手。\n已就绪连接至当前服务器。您可以随时向我咨询故障排查、日志分析或命令生成。按 **[Ctrl + \\]** 可随时在同一窗口展开或收起助手！';

const createEmptyState = (): ChatState => ({
  messages: [
    {
      id: 'init-msg',
      role: 'assistant',
      content: GREETING_CONTENT,
      timestamp: Date.now()
    }
  ],
  isStreaming: false,
  expandedThinking: {},
  commandExplanations: {},
  input: ''
});

const EMPTY_STATE: ChatState = createEmptyState();

const AgentChatContext = createContext<AgentChatContextType | null>(null);

export const AgentChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSession, activeSessionId, sessions, executeCommandWithGuardrail } = useSession();
  const { streamAI, sendTermInput } = useWebSocket();

  const [store, setStore] = useState<Record<string, ChatState>>({});
  // Mirror of `store` for synchronous reads inside callbacks (avoids stale
  // closures without forcing every action to depend on the whole store).
  const storeRef = useRef(store);
  storeRef.current = store;
  // Cancel handles returned by `streamAI`, keyed by sessionId — used by the
  // GC effect to abort streams belonging to closed tabs.
  const cancelersRef = useRef<Map<string, () => void>>(new Map());

  const updateSession = useCallback((sid: string, updater: (s: ChatState) => ChatState) => {
    setStore(prev => {
      const cur = prev[sid] ?? createEmptyState();
      const next = updater(cur);
      if (next === cur) return prev;
      return { ...prev, [sid]: next };
    });
  }, []);

  // Lazily seed state for the active session so first paint already shows the
  // greeting rather than an empty array.
  useEffect(() => {
    if (!activeSessionId) return;
    setStore(prev =>
      prev[activeSessionId] ? prev : { ...prev, [activeSessionId]: createEmptyState() }
    );
  }, [activeSessionId]);

  // Garbage-collect entries for closed sessions and abort their streams.
  useEffect(() => {
    const alive = new Set(sessions.map(s => s.id));
    setStore(prev => {
      const staleKeys = Object.keys(prev).filter(k => !alive.has(k));
      if (staleKeys.length === 0) return prev;
      const next = { ...prev };
      for (const k of staleKeys) {
        delete next[k];
        cancelersRef.current.get(k)?.();
        cancelersRef.current.delete(k);
      }
      return next;
    });
  }, [sessions]);

  const setInput = useCallback(
    (value: string) => {
      if (!activeSessionId) return;
      updateSession(activeSessionId, s => (s.input === value ? s : { ...s, input: value }));
    },
    [activeSessionId, updateSession]
  );

  const toggleThinking = useCallback(
    (msgId: string) => {
      if (!activeSessionId) return;
      updateSession(activeSessionId, s => ({
        ...s,
        expandedThinking: { ...s.expandedThinking, [msgId]: !s.expandedThinking[msgId] }
      }));
    },
    [activeSessionId, updateSession]
  );

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !activeSession) return;
      const sid = activeSession.id;
      const cur = storeRef.current[sid] ?? EMPTY_STATE;
      if (cur.isStreaming) return;

      const userMsg: ChatMessage = {
        id: generateId('msg-'),
        role: 'user',
        content: trimmed,
        timestamp: Date.now()
      };
      const assistantMsgId = generateId('msg-');
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: Date.now(),
        isStreaming: true
      };

      // History sent to the model = existing messages + the new user turn
      // (excluding the empty assistant placeholder).
      const historyForAI = [...cur.messages, userMsg].map(m => ({
        role: m.role,
        content: m.content
      }));

      updateSession(sid, s => ({
        ...s,
        messages: [...s.messages, userMsg, assistantMsg],
        isStreaming: true,
        input: ''
      }));

      const opsContext = {
        terminalSnippet: activeSession.terminalContext || undefined,
        currentDir: activeSession.cwd,
        currentUser: 'root',
        osInfo: 'Ubuntu 22.04 LTS x86_64'
      };

      const cancel = streamAI(historyForAI, opsContext, {
        onThinking: delta => {
          updateSession(sid, s => ({
            ...s,
            messages: s.messages.map(m =>
              m.id === assistantMsgId ? { ...m, thinking: (m.thinking || '') + delta } : m
            )
          }));
        },
        onContent: delta => {
          updateSession(sid, s => ({
            ...s,
            messages: s.messages.map(m =>
              m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
            )
          }));
        },
        onDone: (fullContent, fullThinking) => {
          updateSession(sid, s => ({
            ...s,
            isStreaming: false,
            messages: s.messages.map(m =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: fullContent,
                    thinking: fullThinking || m.thinking,
                    isStreaming: false
                  }
                : m
            )
          }));
          cancelersRef.current.delete(sid);
        },
        onError: err => {
          updateSession(sid, s => ({
            ...s,
            isStreaming: false,
            messages: s.messages.map(m =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + `\n\n❌ 请求出错: ${err}`, isStreaming: false }
                : m
            )
          }));
          cancelersRef.current.delete(sid);
        }
      });
      cancelersRef.current.set(sid, cancel);
    },
    [activeSession, streamAI, updateSession]
  );

  const runCommand = useCallback(
    (cmd: string) => {
      if (!activeSession) return;
      const sid = activeSession.id;
      executeCommandWithGuardrail(cmd, () => sendTermInput(sid, `${cmd}\r`));
    },
    [activeSession, executeCommandWithGuardrail, sendTermInput]
  );

  const fillCommand = useCallback(
    (cmd: string) => {
      if (!activeSession) return;
      const sid = activeSession.id;
      executeCommandWithGuardrail(cmd, () => sendTermInput(sid, cmd));
    },
    [activeSession, executeCommandWithGuardrail, sendTermInput]
  );

  const explainCommand = useCallback(
    (cmd: string) => {
      if (!activeSessionId) return;
      const lines = cmd.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      const cleanCmd = lines[0] || cmd;
      const parts = cleanCmd.split(/\s+/);
      const mainBin = parts[0];
      const flags = parts.slice(1);

      let explanation = `📌 命令 **${mainBin}** 结构解析：\n`;
      if (mainBin === 'systemctl') {
        explanation += `• 操作服务单元控制器：对系统服务进行管理与排障。\n`;
      } else if (mainBin === 'nginx') {
        explanation += `• Nginx 核心程序：-t 参数代表语法合规性检查。\n`;
      } else if (mainBin === 'ss' || mainBin === 'netstat') {
        explanation += `• 网络套接字诊断工具：-tulpn 参数代表查看正在监听的 TCP/UDP 端口并显示 PID/进程名。\n`;
      } else if (mainBin === 'lsof') {
        explanation += `• 列出打开的文件/网络连接：-i 参数指定监听端口。\n`;
      } else {
        explanation += `• 参数列表: ${flags.join(', ') || '无额外参数'}\n`;
      }
      explanation += `• 建议在生产环境中核实后再行落地。`;

      updateSession(activeSessionId, s => ({
        ...s,
        commandExplanations: { ...s.commandExplanations, [cmd]: explanation }
      }));
    },
    [activeSessionId, updateSession]
  );

  const current: ChatState = (activeSessionId && store[activeSessionId]) || EMPTY_STATE;

  return (
    <AgentChatContext.Provider
      value={{
        messages: current.messages,
        isStreaming: current.isStreaming,
        expandedThinking: current.expandedThinking,
        commandExplanations: current.commandExplanations,
        input: current.input,
        setInput,
        toggleThinking,
        sendMessage,
        runCommand,
        fillCommand,
        explainCommand
      }}
    >
      {children}
    </AgentChatContext.Provider>
  );
};

export const useAgentChat = (): AgentChatContextType => {
  const ctx = useContext(AgentChatContext);
  if (!ctx) throw new Error('useAgentChat must be used within AgentChatProvider');
  return ctx;
};
