import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSession } from '../../context/SessionContext';
import { useAgentChat } from '../../hooks/useAgentChat';
import { ThinkingAccordion } from './Agent/ThinkingAccordion';
import { AgentInputBar } from './Agent/AgentInputBar';
import { AgentPlanPanel } from './Agent/AgentPlanPanel';
import { ApprovalCard } from './Agent/ApprovalCard';
import { TimelinePanel } from './Agent/TimelinePanel';
import { COPY_SCOPE_ATTR } from '../../utils/clipboard';
import { Bot, User, X, Play, Clock, Trash2, Settings } from 'lucide-react';

// react-markdown + highlight.js are heavy → split into an on-demand chunk so
// they stay out of the initial bundle (loaded the first time a message renders).
const MessageMarkdown = React.lazy(() => import('./Agent/MessageMarkdown'));

interface AgentViewProps {
  isVisible: boolean;
}

export const AgentView: React.FC<AgentViewProps> = ({ isVisible }) => {
  const { activeSession, toggleAgent, clearUnreadError, setIsSettingsModalOpen } = useSession();
  const {
    messages,
    isStreaming,
    expandedThinking,
    commandExplanations,
    input,
    activePlan,
    pendingApprovals,
    timeline,
    setInput,
    toggleThinking,
    sendMessage,
    runCommand,
    fillCommand,
    explainCommand,
    runAgentGoal,
    retryAgentPlan,
    approveAgentAction,
    rejectAgentAction,
    confirmAgentPlan,
    skipAgentApproval,
    cancelAgentPlan,
    clearHistory
  } = useAgentChat();

  const [showTimeline, setShowTimeline] = useState(false);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const isPlanRunning = Boolean(
    activePlan &&
      ['planning', 'awaiting_confirmation', 'running', 'awaiting_approval', 'verifying'].includes(
        activePlan.status
      )
  );
  const canClearHistory = !isPlanRunning && (messages.length > 1 || Boolean(activePlan));

  // Auto-fill error snippet if opened via error trigger
  useEffect(() => {
    if (isVisible && activeSession?.unreadError) {
      if (activeSession.lastFailedCommand) {
        const failed = activeSession.lastFailedCommand;
        const cmdName = failed.command ? ` \`${failed.command}\`` : '';
        const outputSnippet = failed.output.trim()
          ? `，报错输出如下：\n\`\`\`text\n${failed.output.trim().slice(-2000)}\n\`\`\``
          : '。';
        setInput(
          `终端命令${cmdName} 执行失败 (退出码: ${failed.exitCode})${outputSnippet}\n请帮我分析失败原因并给出修复命令。`
        );
      } else {
        setInput(
          `终端刚刚报出以下错误，请帮我分析原因并给出修复命令：\n${activeSession.unreadError}`
        );
      }
      clearUnreadError(activeSession.id);
    }
  }, [
    isVisible,
    activeSession?.unreadError,
    activeSession?.lastFailedCommand,
    clearUnreadError,
    activeSession?.id,
    setInput
  ]);

  // Follow streaming output only while the user is already at the bottom.
  // scrollTop is scoped to this panel; scrollIntoView can move outer layouts too.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !shouldFollowLatestRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, activePlan, pendingApprovals]);

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const following = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
    shouldFollowLatestRef.current = following;
    setIsFollowingLatest(following);
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  const handleRunInputPlan = () => {
    const goal = input.trim();
    if (!goal || isStreaming || isPlanRunning) return;
    runAgentGoal(goal, goal);
    setInput('');
  };

  const handleRunAutonomousPlan = () => {
    let goal = input.trim();
    let displayGoal = goal;

    if (!goal) {
      const conversationMessages = messages.filter(m => m.id !== 'init-msg' && m.content.trim());
      const lastAssistantMsg = [...conversationMessages]
        .reverse()
        .find(m => m.role === 'assistant' && !m.plan);
      const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user');

      if (lastAssistantMsg && /```[\s\S]*?```/.test(lastAssistantMsg.content)) {
        const header = lastUserMsg?.content.trim().split('\n')[0] || '执行 AI 建议的命令方案';
        displayGoal = header;
        goal = `${header}\n${lastAssistantMsg.content}`;
      } else if (lastUserMsg) {
        goal = lastUserMsg.content.trim();
        displayGoal = goal;
      } else if (activeSession?.lastFailedCommand?.command) {
        goal = `排查并验证命令 ${activeSession.lastFailedCommand.command} 异常`;
        displayGoal = goal;
      } else {
        goal = '检查当前服务与工作目录健康状态';
        displayGoal = goal;
      }
    }

    runAgentGoal(goal, displayGoal);
    setInput('');
  };

  const isActivePlanInMessages = Boolean(
    activePlan &&
      messages.some(m => m.plan?.id === activePlan.id || m.plan?.id.startsWith('pending-'))
  );

  return (
    <div
      className={`w-full h-full flex flex-col bg-[#0d1117] select-text ${isVisible ? 'flex' : 'hidden'}`}
      {...{ [COPY_SCOPE_ATTR]: 'agent' }}
    >
      {/* Header Context Indicator */}
      <div className="h-10 bg-[#14131d] border-b border-violet-300/[0.08] px-3 flex items-center justify-between text-xs text-violet-200 select-none shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-violet-400/10 border border-violet-300/10 flex items-center justify-center shrink-0">
            <Bot size={13} className="text-violet-300" />
          </div>
          <span className="font-semibold text-[11px] text-slate-200 truncate">
            MonoTerminal Ops Agent
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={handleRunAutonomousPlan}
            disabled={isPlanRunning || isStreaming}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-900/50 hover:bg-purple-800/70 text-purple-200 border border-purple-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="基于当前上下文启动 Plan-Execute-Verify 自主巡检/排障"
          >
            <Play size={10} />
            <span>自主执行计划</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTimeline(prev => !prev)}
            className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              showTimeline
                ? 'bg-blue-900/50 text-blue-200 border-blue-700/60'
                : 'bg-orca-surface text-orca-muted hover:text-white border-orca-border'
            }`}
            title="展开/收起会话统一时间线"
          >
            <Clock size={10} />
            <span>时间线</span>
          </button>

          <button
            type="button"
            onClick={clearHistory}
            disabled={!canClearHistory}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-orca-surface text-orca-muted hover:text-rose-300 hover:border-rose-700/60 border border-orca-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="清空当前会话的对话历史与已完成计划"
          >
            <Trash2 size={10} />
            <span>清空记录</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-orca-surface text-orca-muted hover:text-white border border-orca-border transition-colors"
            title="配置 AI 模型与 API Key (Ctrl+,)"
          >
            <Settings size={10} />
            <span>模型</span>
          </button>

          <button
            type="button"
            onClick={() => toggleAgent(false)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-orca-muted hover:text-white hover:bg-purple-900/40 transition-colors"
            title="收起 AI 助手 (Ctrl+\)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Messages & Workspace Agent Panels Stream Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        onWheel={event => {
          if (event.deltaY < 0) {
            shouldFollowLatestRef.current = false;
            setIsFollowingLatest(false);
          }
        }}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {showTimeline && <TimelinePanel entries={timeline} />}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex flex-col space-y-1.5 ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {/* Header info */}
            {msg.role === 'user' && (
              <div className="flex items-center space-x-1.5 text-[11px] text-orca-muted px-1">
                <span>您</span>
                <User size={12} className="text-orca-accent" />
              </div>
            )}

            {/* Plan Execution Record Card OR Standard Chat Bubble */}
            {msg.plan ? (
              <div className="w-full">
                <AgentPlanPanel
                  plan={msg.plan}
                  onCancel={cancelAgentPlan}
                  onConfirm={confirmAgentPlan}
                  onRetry={retryAgentPlan}
                />
              </div>
            ) : (
              <div
                className={`max-w-[90%] rounded-lg p-3 text-xs leading-relaxed shadow-md ${
                  msg.role === 'user'
                    ? 'bg-blue-900/30 border border-blue-700/40 text-white'
                    : 'bg-orca-surface border border-orca-border text-orca-text w-full'
                }`}
              >
                {/* Thinking Process Accordion */}
                {msg.thinking && (
                  <ThinkingAccordion
                    thinking={msg.thinking}
                    isExpanded={Boolean(expandedThinking[msg.id])}
                    onToggle={() => toggleThinking(msg.id)}
                  />
                )}

                {/* Message Content & Actionable Codeblocks (lazy markdown chunk) */}
                <Suspense
                  fallback={
                    <div className="whitespace-pre-wrap leading-relaxed text-xs">{msg.content}</div>
                  }
                >
                  <MessageMarkdown
                    content={msg.content}
                    commandExplanations={commandExplanations}
                    onRun={runCommand}
                    onFill={fillCommand}
                    onExplain={explainCommand}
                  />
                </Suspense>

                {msg.isStreaming && (
                  <span className="inline-block w-1.5 h-3 bg-orca-accent animate-pulse ml-1 align-middle" />
                )}
              </div>
            )}
          </div>
        ))}

        {activePlan && !isActivePlanInMessages && (
          <AgentPlanPanel
            plan={activePlan}
            onCancel={cancelAgentPlan}
            onConfirm={confirmAgentPlan}
            onRetry={retryAgentPlan}
          />
        )}

        {pendingApprovals.map(appr => (
          <ApprovalCard
            key={appr.id}
            approval={appr}
            onApprove={approveAgentAction}
            onReject={rejectAgentAction}
            onSkip={skipAgentApproval}
          />
        ))}
        {!isFollowingLatest && (
          <div className="sticky bottom-0 flex justify-end pointer-events-none">
            <button
              type="button"
              onClick={() => {
                const container = messagesContainerRef.current;
                if (!container) return;
                container.scrollTop = container.scrollHeight;
                shouldFollowLatestRef.current = true;
                setIsFollowingLatest(true);
              }}
              className="pointer-events-auto mb-1 rounded-full border border-purple-700/60 bg-[#171225] px-2.5 py-1 text-[10px] text-purple-200 shadow-lg hover:bg-purple-950"
            >
              回到最新消息
            </button>
          </div>
        )}
      </div>

      {/* Input Box Footer */}
      <AgentInputBar
        input={input}
        isStreaming={isStreaming}
        onChange={setInput}
        onSend={handleSend}
        onRunPlan={handleRunInputPlan}
        isPlanRunning={isPlanRunning}
        autoFocus={isVisible}
      />
    </div>
  );
};
