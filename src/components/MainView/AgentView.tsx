import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useSession } from '../../context/SessionContext';
import { useAgentChat } from '../../hooks/useAgentChat';
import { ThinkingAccordion } from './Agent/ThinkingAccordion';
import { AgentInputBar } from './Agent/AgentInputBar';
import { AgentPlanPanel } from './Agent/AgentPlanPanel';
import { ApprovalCard } from './Agent/ApprovalCard';
import { TimelinePanel } from './Agent/TimelinePanel';
import { COPY_SCOPE_ATTR } from '../../utils/clipboard';
import { Bot, User, X, Play, Clock } from 'lucide-react';

// react-markdown + highlight.js are heavy → split into an on-demand chunk so
// they stay out of the initial bundle (loaded the first time a message renders).
const MessageMarkdown = React.lazy(() => import('./Agent/MessageMarkdown'));

interface AgentViewProps {
  isVisible: boolean;
}

export const AgentView: React.FC<AgentViewProps> = ({ isVisible }) => {
  const { activeSession, toggleAgent, clearUnreadError } = useSession();
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
    approveAgentAction,
    rejectAgentAction,
    cancelAgentPlan
  } = useAgentChat();

  const [showTimeline, setShowTimeline] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlan, pendingApprovals]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  const handleRunAutonomousPlan = () => {
    const goal =
      input.trim() ||
      (activeSession?.lastFailedCommand?.command
        ? `排查并验证命令 ${activeSession.lastFailedCommand.command} 异常`
        : '检查当前服务与工作目录健康状态');
    runAgentGoal(goal);
  };

  return (
    <div
      className={`w-full h-full flex flex-col bg-[#0d1117] select-text ${isVisible ? 'flex' : 'hidden'}`}
      {...{ [COPY_SCOPE_ATTR]: 'agent' }}
    >
      {/* Header Context Indicator */}
      <div className="h-7 bg-purple-950/20 border-b border-purple-900/30 px-3 flex items-center justify-between text-xs text-purple-300 select-none shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <Bot size={13} className="text-purple-400 shrink-0" />
          <span className="font-semibold text-[11px] text-purple-300 truncate">
            MonoTerminal Ops Agent
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={handleRunAutonomousPlan}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-900/50 hover:bg-purple-800/70 text-purple-200 border border-purple-700/50 transition-colors"
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
            onClick={() => toggleAgent(false)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-orca-muted hover:text-white hover:bg-purple-900/40 transition-colors"
            title="收起 AI 助手 (Ctrl+\)"
          >
            <X size={13} />
            <span>收起</span>
          </button>
        </div>
      </div>

      {/* Messages & Workspace Agent Panels Stream Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showTimeline && <TimelinePanel entries={timeline} />}

        {activePlan && <AgentPlanPanel plan={activePlan} onCancel={cancelAgentPlan} />}

        {pendingApprovals.map(appr => (
          <ApprovalCard
            key={appr.id}
            approval={appr}
            onApprove={approveAgentAction}
            onReject={rejectAgentAction}
          />
        ))}

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

            {/* Bubble Card */}
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
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer */}
      <AgentInputBar
        input={input}
        isStreaming={isStreaming}
        onChange={setInput}
        onSend={handleSend}
        autoFocus={isVisible}
      />
    </div>
  );
};

