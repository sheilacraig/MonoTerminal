import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../types';
import { generateId } from '../../shared/id';
import type {
  AgentPlanPayload,
  ApprovalRequestPayload,
  TimelineEntryPayload
} from '../../shared/wsProtocol';
import { useSession } from './SessionContext';
import { useWebSocket } from './WebSocketContext';
import { parseShellCommands } from '../utils/commandCleaner';
import { isMultiLineBlock, requiresElevation } from '../utils/authPrompt';
import { getAuthStore, setFallbackTerminalSender } from '../services/terminalAuth';
import { shellIntegrationTracker } from '../utils/shellIntegration';

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
  activePlan: AgentPlanPayload | null;
  pendingApprovals: ApprovalRequestPayload[];
  timeline: TimelineEntryPayload[];
}

interface AgentChatContextType extends ChatState {
  setInput: (value: string) => void;
  toggleThinking: (msgId: string) => void;
  sendMessage: (content: string) => void;
  runCommand: (cmd: string) => void;
  fillCommand: (cmd: string) => void;
  explainCommand: (cmd: string) => void;
  runAgentGoal: (goal: string, displayGoal?: string) => void;
  approveAgentAction: (approvalId: string) => void;
  rejectAgentAction: (approvalId: string, reason?: string) => void;
  /** UX round-1 ①: confirm the plan currently awaiting_confirmation. */
  confirmAgentPlan: (planId: string) => void;
  /** UX round-1 ②: bypass a single pending approval, plan continues. */
  skipAgentApproval: (approvalId: string) => void;
  cancelAgentPlan: () => void;
  clearHistory: () => void;
}

export function formatPlanTraceMarkdown(plan: AgentPlanPayload): string {
  const statusMap: Record<AgentPlanPayload['status'], string> = {
    planning: '规划中',
    awaiting_confirmation: '等待确认',
    running: '执行中',
    awaiting_approval: '等待审批',
    verifying: '验证中',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消'
  };
  const stepLines = plan.steps.map((s, idx) => {
    const cmd =
      s.toolName === 'shell' && typeof s.input?.command === 'string' && s.input.command.trim()
        ? ` \`${s.input.command.trim()}\``
        : '';
    const out = s.outputSummary ? `\n   - 输出结果: ${s.outputSummary}` : '';
    const err = s.error ? `\n   - 错误信息: ${s.error}` : '';
    return `${idx + 1}. [${s.status}] ${s.title} (${s.toolName})${cmd}${out}${err}`;
  });
  return [
    `[计划执行记录] 目标: ${plan.goal}`,
    `状态: ${statusMap[plan.status] || plan.status}`,
    ...(plan.summary ? [`摘要: ${plan.summary}`] : []),
    ...(stepLines.length > 0 ? ['执行步骤:', ...stepLines] : ['(正在拆解执行步骤...)'])
  ].join('\n');
}

const GREETING_CONTENT =
  '👋 您好！我是 MonoTerminal 智能运维助手。\n已就绪连接至当前服务器。您可以随时向我咨询故障排查、日志分析或命令生成。按 **[Ctrl + \\\\]** 可随时在同一窗口展开或收起助手！';

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
  input: '',
  activePlan: null,
  pendingApprovals: [],
  timeline: []
});

const EMPTY_STATE: ChatState = createEmptyState();

const AgentChatContext = createContext<AgentChatContextType | null>(null);

export const AgentChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSession, activeSessionId, sessions, hosts, executeCommandWithGuardrail } =
    useSession();
  const { send, streamAI, sendTermInput, registerAgentEventHandler } = useWebSocket();

  const [store, setStore] = useState<Record<string, ChatState>>({});
  // Mirror of `store` for synchronous reads inside callbacks (avoids stale
  // closures without forcing every action to depend on the whole store).
  const storeRef = useRef(store);
  storeRef.current = store;
  // Cancel handles returned by `streamAI`, keyed by sessionId — used by the
  // GC effect to abort streams belonging to closed tabs.
  const cancelersRef = useRef<Map<string, () => void>>(new Map());
  // Track plan IDs that have already triggered a final LLM execution summary.
  const summarizedPlanIdsRef = useRef<Set<string>>(new Set());

  // The auth panel may need to write to the pty before any TerminalView has
  // bound itself (e.g. “run” clicked while the pane is still mounting).
  useEffect(() => {
    setFallbackTerminalSender(sendTermInput);
    return () => setFallbackTerminalSender(null);
  }, [sendTermInput]);

  const updateSession = useCallback((sid: string, updater: (s: ChatState) => ChatState) => {
    setStore(prev => {
      const cur = prev[sid] ?? createEmptyState();
      const next = updater(cur);
      if (next === cur) return prev;
      return { ...prev, [sid]: next };
    });
  }, []);

  const buildOpsContextForSession = useCallback(
    (sid: string) => {
      const targetSession = sessions.find(s => s.id === sid) || activeSession;
      const host = hosts.find(h => h.id === targetSession?.hostId);
      const isLocal = host?.authType === 'local';
      const isMock = host?.authType === 'mock';
      const isWindowsLocal =
        isLocal &&
        ((typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)) ||
          /^[A-Za-z]:/.test(targetSession?.cwd || '') ||
          (targetSession?.cwd || '').includes('\\'));

      return {
        terminalSnippet: targetSession?.terminalContext || undefined,
        currentDir: targetSession?.cwd,
        currentUser: host?.username || (isLocal ? 'local' : 'root'),
        osInfo: isWindowsLocal
          ? 'Windows (本地 PowerShell 终端)'
          : isLocal
            ? 'Local Unix/macOS Shell'
            : isMock
              ? 'Ubuntu 22.04 LTS x86_64'
              : 'Ubuntu 22.04 LTS x86_64',
        failedCommand: targetSession?.lastFailedCommand
          ? {
              command: targetSession.lastFailedCommand.command,
              exitCode: targetSession.lastFailedCommand.exitCode,
              output: targetSession.lastFailedCommand.output
            }
          : undefined
      };
    },
    [sessions, activeSession, hosts]
  );

  const streamPlanSummary = useCallback(
    (sid: string, finishedPlan: AgentPlanPayload) => {
      const assistantMsgId = generateId('msg-');
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        thinking: '',
        timestamp: Date.now(),
        isStreaming: true
      };

      const cur = storeRef.current[sid] ?? EMPTY_STATE;
      const planTraceText = formatPlanTraceMarkdown(finishedPlan);
      const statusLabel =
        finishedPlan.status === 'completed'
          ? '已完成'
          : finishedPlan.status === 'cancelled'
            ? '已取消'
            : '执行失败';

      const summaryPrompt = [
        `刚刚在终端完成了【计划执行】（最终状态：${statusLabel}），以下是完整的计划执行记录：`,
        ``,
        planTraceText,
        ``,
        `请基于以上各步骤的真实执行结果与输出数据，向用户汇报本次计划的最后执行情况：`,
        `1. 简明总结各步骤的执行结果与关键输出信息；`,
        `2. 明确告知用户的目标（${finishedPlan.goal}）是否已达成；`,
        `3. 如有失败、验证未通过或中止的步骤，请指出具体原因并给出后续处理建议。`
      ].join('\n');

      const baseHistory = cur.messages
        .filter(m => !m.plan || (m.plan.id !== finishedPlan.id && !m.plan.id.startsWith('pending-')))
        .map(m => ({
          role: m.role,
          content: m.content
        }));

      const historyForAI = [
        ...baseHistory,
        {
          role: 'user' as const,
          content: summaryPrompt
        }
      ];

      updateSession(sid, s => ({
        ...s,
        isStreaming: true,
        messages: [...s.messages, assistantMsg]
      }));

      cancelersRef.current.get(sid)?.();
      const cancel = streamAI(historyForAI, buildOpsContextForSession(sid), {
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
                ? {
                    ...m,
                    content: m.content + `\n\n❌ 执行情况汇总请求出错: ${err}`,
                    isStreaming: false
                  }
                : m
            )
          }));
          cancelersRef.current.delete(sid);
        }
      });
      cancelersRef.current.set(sid, cancel);
    },
    [buildOpsContextForSession, streamAI, updateSession]
  );

  // Subscribe to agent:* outbound events for all live sessions
  useEffect(() => {
    const unsubs = sessions.map(s =>
      registerAgentEventHandler(s.id, msg => {
        updateSession(s.id, cur => {
          switch (msg.type) {
            case 'agent:plan': {
              const planTrace = formatPlanTraceMarkdown(msg.plan);
              let foundIdx = -1;
              for (let i = cur.messages.length - 1; i >= 0; i--) {
                const existingPlan = cur.messages[i].plan;
                if (!existingPlan) continue;
                if (existingPlan.id === msg.plan.id || existingPlan.id.startsWith('pending-')) {
                  foundIdx = i;
                  break;
                }
              }

              const updatedMessages: ChatMessage[] =
                foundIdx >= 0
                  ? cur.messages.map((m, idx) =>
                      idx === foundIdx ? { ...m, plan: msg.plan, content: planTrace } : m
                    )
                  : [
                      ...cur.messages,
                      {
                        id: generateId('msg-plan-'),
                        role: 'assistant',
                        content: planTrace,
                        plan: msg.plan,
                        timestamp: Date.now()
                      }
                    ];

              return {
                ...cur,
                activePlan: msg.plan,
                messages: updatedMessages
              };
            }
            case 'agent:approval_request': {
              const filtered = cur.pendingApprovals.filter(a => a.id !== msg.approval.id);
              return { ...cur, pendingApprovals: [...filtered, msg.approval] };
            }
            case 'agent:approval_resolved':
              return {
                ...cur,
                pendingApprovals: cur.pendingApprovals.filter(a => a.id !== msg.approvalId)
              };
            case 'agent:timeline':
              return { ...cur, timeline: msg.entries };
            case 'agent:error': {
              // UX round-1 ③: run-level failures (e.g. the concurrency gate)
              // surface as a visible assistant message instead of dying silently.
              const errMsg: ChatMessage = {
                id: generateId('msg-err-'),
                role: 'assistant',
                content: `⚠️ 智能体任务出错: ${msg.message}`,
                timestamp: Date.now()
              };
              return { ...cur, messages: [...cur.messages, errMsg] };
            }
            default:
              return cur;
          }
        });

        if (
          msg.type === 'agent:plan' &&
          !msg.plan.id.startsWith('pending-') &&
          ['completed', 'failed', 'cancelled'].includes(msg.plan.status) &&
          !summarizedPlanIdsRef.current.has(msg.plan.id)
        ) {
          summarizedPlanIdsRef.current.add(msg.plan.id);
          streamPlanSummary(s.id, msg.plan);
        }
      })
    );
    return () => {
      unsubs.forEach(u => u());
    };
  }, [sessions, registerAgentEventHandler, updateSession, streamPlanSummary]);

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

      const opsContext = buildOpsContextForSession(sid);

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
    [activeSession, buildOpsContextForSession, streamAI, updateSession]
  );

  /**
   * A multi-line block that needs sudo must not be written to the pty in one
   * go: `commandCleaner` joins compound blocks (heredocs, scripts) with `\r`,
   * so the password prompt appears and the very next line of the script is
   * consumed as the password — three failed attempts later nothing has run.
   * Those blocks go through an explicit `sudo -v` pre-flight instead.
   */
  const needsElevationPreflight = useCallback(
    (sid: string, command: string) => {
      if (!requiresElevation(command) || !isMultiLineBlock(command)) return false;

      // `beginElevation` explicitly dispatches `sudo -v`, so preflight is only
      // meaningful when the compound block actually contains `sudo`.
      const withoutStrings = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      if (!/(?:^|[\n\r;&|(`]|\s)sudo\s+/.test(withoutStrings)) return false;

      const session = sessions.find(s => s.id === sid);
      const host = hosts.find(h => h.id === session?.hostId);
      if (!host) return false;

      // The root user already has full privileges; running sudo -v would be a no-op
      // but cause a 2.6s artificial delay waiting for the timeout.
      if (host.username === 'root') return false;

      // Local (Windows) and mock sandbox shells have no sudo to elevate with.
      return host.authType !== 'local' && host.authType !== 'mock';
    },
    [sessions, hosts]
  );

  const normalizeCommandForSession = useCallback(
    (rawCmd: string): string => {
      const parsed = parseShellCommands(rawCmd);
      let clean = parsed.cleanCommand || rawCmd.trim();
      if (!clean) return '';

      const host = hosts.find(h => h.id === activeSession?.hostId);
      const isWindowsLocal =
        host?.authType === 'local' &&
        ((typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)) ||
          /^[A-Za-z]:/.test(activeSession?.cwd || '') ||
          (activeSession?.cwd || '').includes('\\'));

      // Windows PowerShell 5.1 does not support `&&` statement separators; use `; ` instead
      if (isWindowsLocal && parsed.hasMultipleCommands) {
        clean = parsed.individualCommands.join('; ');
      }
      return clean;
    },
    [activeSession, hosts]
  );

  const runCommand = useCallback(
    (cmd: string) => {
      if (!activeSession) return;
      const sid = activeSession.id;
      const clean = normalizeCommandForSession(cmd);
      if (!clean) return;

      shellIntegrationTracker.setCommandText(sid, clean);

      if (needsElevationPreflight(sid, clean)) {
        executeCommandWithGuardrail(clean, () => getAuthStore(sid).beginElevation(clean, 'run'));
        return;
      }

      executeCommandWithGuardrail(clean, () => sendTermInput(sid, `${clean}\r`));
    },
    [activeSession, normalizeCommandForSession, needsElevationPreflight, executeCommandWithGuardrail, sendTermInput]
  );

  const fillCommand = useCallback(
    (cmd: string) => {
      if (!activeSession) return;
      const sid = activeSession.id;
      const clean = normalizeCommandForSession(cmd);
      if (!clean) return;

      shellIntegrationTracker.setCommandText(sid, clean);

      // Parking a multi-line sudo block on the command line has the same flaw as
      // running it: the following heredoc/script lines become the password.
      if (needsElevationPreflight(sid, clean)) {
        executeCommandWithGuardrail(clean, () => getAuthStore(sid).beginElevation(clean, 'fill'));
        return;
      }

      executeCommandWithGuardrail(clean, () => sendTermInput(sid, clean));
    },
    [activeSession, normalizeCommandForSession, needsElevationPreflight, executeCommandWithGuardrail, sendTermInput]
  );

  const explainCommand = useCallback(
    (cmd: string) => {
      if (!activeSessionId) return;
      const parsed = parseShellCommands(cmd);
      const clean = parsed.cleanCommand || cmd.trim();
      const lines = parsed.individualCommands.length > 0 ? parsed.individualCommands : [clean];

      const describeSingle = (singleCmd: string): string => {
        const parts = singleCmd.trim().split(/\s+/);
        const mainBin = parts[0] || singleCmd;
        const lowerBin = mainBin.toLowerCase();
        const flags = parts.slice(1);

        if (lowerBin === 'systemctl') {
          return `**${mainBin}**: 系统服务单元控制器 (${flags.join(' ') || '管理与排障系统服务'})`;
        }
        if (lowerBin === 'nginx') {
          return `**${mainBin}**: Nginx Web 服务器核心程序 (${flags.includes('-t') ? '-t 检查配置语法正确性' : flags.join(' ')})`;
        }
        if (lowerBin === 'ss' || lowerBin === 'netstat') {
          return `**${mainBin}**: 网络套接字诊断工具 (查看当前监听的 TCP/UDP 端口与对应进程 PID)`;
        }
        if (lowerBin === 'lsof') {
          return `**${mainBin}**: 列出打开的文件与网络连接 (${flags.join(' ') || '定位端口或文件占用'})`;
        }
        if (lowerBin === 'df') {
          return `**${mainBin}**: 查看文件系统磁盘空间占用情况 (${flags.join(' ') || '显示挂载点使用率'})`;
        }
        if (lowerBin === 'free') {
          return `**${mainBin}**: 查看系统物理内存与 Swap 交换分区使用量 (${flags.join(' ') || ''})`;
        }
        if (lowerBin === 'ps' || lowerBin === 'top') {
          return `**${mainBin}**: 查看当前正在运行的进程状态与 CPU/内存资源占用`;
        }
        if (lowerBin === 'docker') {
          return `**${mainBin}**: Docker 容器管理命令 (子命令与参数: ${flags.join(' ') || '无'})`;
        }
        if (lowerBin === 'git') {
          return `**${mainBin}**: Git 版本控制操作 (子命令与参数: ${flags.join(' ') || '无'})`;
        }
        if (lowerBin === 'get-childitem' || lowerBin === 'dir' || lowerBin === 'ls') {
          return `**${mainBin}**: 列出当前或指定目录下的文件与子目录清单 (${flags.join(' ') || '默认当前目录'})`;
        }
        if (lowerBin === 'get-location' || lowerBin === 'pwd') {
          return `**${mainBin}**: 显示当前终端所在的工作目录路径`;
        }
        if (lowerBin === 'set-location' || lowerBin === 'cd') {
          return `**${mainBin}**: 切换当前工作目录至 ${flags.join(' ') || '目标路径'}`;
        }
        if (lowerBin === 'get-process') {
          return `**${mainBin}**: 获取本机正在运行的进程信息 (${flags.join(' ') || '全部进程'})`;
        }
        if (lowerBin === 'get-service') {
          return `**${mainBin}**: 查询 Windows 系统服务运行状态 (${flags.join(' ') || '全部服务'})`;
        }
        if (lowerBin === 'get-nettcpconnection') {
          return `**${mainBin}**: 查询 Windows TCP 网络连接与监听端口状态 (${flags.join(' ') || '全部连接'})`;
        }
        return `**${mainBin}**: 参数列表 [${flags.join(', ') || '无额外参数'}]`;
      };

      let explanation = `📌 命令结构解析：\n`;
      for (const line of lines) {
        explanation += `• ${describeSingle(line)}\n`;
      }
      explanation += `• 建议确认当前工作目录与环境后再行执行。`;

      updateSession(activeSessionId, s => ({
        ...s,
        commandExplanations: {
          ...s.commandExplanations,
          [cmd]: explanation,
          [clean]: explanation
        }
      }));
    },
    [activeSessionId, updateSession]
  );

  const runAgentGoal = useCallback(
    (goal: string, displayGoal?: string) => {
      const trimmed = goal.trim();
      if (!trimmed || !activeSessionId) return;

      const requestId = generateId('agent-');
      const now = Date.now();
      const visibleGoal = (displayGoal?.trim() || trimmed).trim();
      const shortGoalTitle = visibleGoal.split(/\r?\n/)[0].slice(0, 120) || visibleGoal;

      const userMsg: ChatMessage = {
        id: generateId('msg-'),
        role: 'user',
        content: `🧭 **计划执行**：${visibleGoal}`,
        timestamp: now
      };

      const draftPlan: AgentPlanPayload = {
        id: `pending-${requestId}`,
        sessionId: activeSessionId,
        goal: shortGoalTitle,
        status: 'planning',
        steps: [],
        createdAt: now,
        updatedAt: now
      };

      const planMsg: ChatMessage = {
        id: generateId('msg-plan-'),
        role: 'assistant',
        content: formatPlanTraceMarkdown(draftPlan),
        plan: draftPlan,
        timestamp: now
      };

      updateSession(activeSessionId, s => ({
        ...s,
        activePlan: draftPlan,
        messages: [...s.messages, userMsg, planMsg],
        input: ''
      }));

      send({
        type: 'agent:run',
        requestId,
        sessionId: activeSessionId,
        goal: trimmed
      });
    },
    [activeSessionId, send, updateSession]
  );

  const approveAgentAction = useCallback(
    (approvalId: string) => {
      if (!activeSessionId || !approvalId) return;
      send({
        type: 'agent:approve',
        sessionId: activeSessionId,
        approvalId
      });
    },
    [activeSessionId, send]
  );

  const rejectAgentAction = useCallback(
    (approvalId: string, reason?: string) => {
      if (!activeSessionId || !approvalId) return;
      send({
        type: 'agent:reject',
        sessionId: activeSessionId,
        approvalId,
        reason
      });
    },
    [activeSessionId, send]
  );

  /** UX round-1 ①: resume a plan paused at awaiting_confirmation. */
  const confirmAgentPlan = useCallback(
    (planId: string) => {
      if (!activeSessionId || !planId) return;
      send({
        type: 'agent:confirm_plan',
        sessionId: activeSessionId,
        planId
      });
    },
    [activeSessionId, send]
  );

  /** UX round-1 ②: bypass this single approval; the plan keeps going. */
  const skipAgentApproval = useCallback(
    (approvalId: string) => {
      if (!activeSessionId || !approvalId) return;
      send({
        type: 'agent:skip',
        sessionId: activeSessionId,
        approvalId
      });
    },
    [activeSessionId, send]
  );

  const cancelAgentPlan = useCallback(() => {
    if (!activeSessionId) return;
    send({
      type: 'agent:cancel',
      sessionId: activeSessionId
    });
  }, [activeSessionId, send]);

  const clearHistory = useCallback(() => {
    if (!activeSessionId) return;
    cancelersRef.current.get(activeSessionId)?.();
    cancelersRef.current.delete(activeSessionId);
    updateSession(activeSessionId, cur => {
      const fresh = createEmptyState();
      const keepPlan =
        cur.activePlan &&
        ['planning', 'awaiting_confirmation', 'running', 'awaiting_approval', 'verifying'].includes(
          cur.activePlan.status
        )
          ? cur.activePlan
          : null;
      return {
        ...fresh,
        activePlan: keepPlan,
        pendingApprovals: keepPlan ? cur.pendingApprovals : [],
        timeline: cur.timeline
      };
    });
  }, [activeSessionId, updateSession]);

  const current: ChatState = (activeSessionId && store[activeSessionId]) || EMPTY_STATE;

  return (
    <AgentChatContext.Provider
      value={{
        messages: current.messages,
        isStreaming: current.isStreaming,
        expandedThinking: current.expandedThinking,
        commandExplanations: current.commandExplanations,
        input: current.input,
        activePlan: current.activePlan,
        pendingApprovals: current.pendingApprovals,
        timeline: current.timeline,
        setInput,
        toggleThinking,
        sendMessage,
        runCommand,
        fillCommand,
        explainCommand,
        runAgentGoal,
        approveAgentAction,
        rejectAgentAction,
        confirmAgentPlan,
        skipAgentApproval,
        cancelAgentPlan,
        clearHistory
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
