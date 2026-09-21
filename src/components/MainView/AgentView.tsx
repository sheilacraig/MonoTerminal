import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { useAgentChat } from '../../hooks/useAgentChat';
import { ThinkingAccordion } from './Agent/ThinkingAccordion';
import { AgentInputBar } from './Agent/AgentInputBar';
import { Bot, User, Brain, X } from 'lucide-react';

// react-markdown + highlight.js are heavy → split into an on-demand chunk so
// they stay out of the initial bundle (loaded the first time a message renders).
const MessageMarkdown = React.lazy(() => import('./Agent/MessageMarkdown'));

interface AgentViewProps {
  isVisible: boolean;
}

export const AgentView: React.FC<AgentViewProps> = ({ isVisible }) => {
  const { activeSession, toggleAgent, clearUnreadError } = useSession();
  const { activeAIProvider } = useSettings();
  const {
    messages,
    isStreaming,
    expandedThinking,
    commandExplanations,
    toggleThinking,
    sendMessage,
    runCommand,
    fillCommand,
    explainCommand
  } = useAgentChat();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-fill error snippet if opened via error trigger
  useEffect(() => {
    if (isVisible && activeSession?.unreadError) {
      setInput(`终端刚刚报出以下错误，请帮我分析原因并给出修复命令：\n${activeSession.unreadError}`);
      clearUnreadError(activeSession.id);
    }
  }, [isVisible, activeSession?.unreadError, clearUnreadError, activeSession?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  return (
    <div
      className={`w-full h-full flex flex-col bg-[#0d1117] ${
        isVisible ? 'flex' : 'hidden'
      }`}
    >
      {/* Header Context Indicator */}
      <div className="h-7 bg-purple-950/20 border-b border-purple-900/30 px-3 flex items-center justify-between text-xs text-purple-300 select-none shrink-0">
        <div className="flex items-center space-x-2">
          <Brain size={13} className="text-purple-400" />
          <span className="font-medium text-[11px]">
            AI 智能运维 Agent (模型: {activeAIProvider?.name || 'DeepSeek-V3'})
          </span>
          {activeSession?.terminalContext && (
            <span className="text-[10px] bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/50">
              已捕获最近 50 行终端上下文
            </span>
          )}
        </div>

        <button
          onClick={() => toggleAgent(false)}
          className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-orca-muted hover:text-white hover:bg-purple-900/40 transition-colors"
          title="收起 AI 助手 (Ctrl+\)"
        >
          <X size={13} />
          <span>收起</span>
        </button>
      </div>

      {/* Messages Stream Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col space-y-1.5 ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {/* Header info */}
            <div className="flex items-center space-x-1.5 text-[11px] text-orca-muted px-1">
              {msg.role === 'user' ? (
                <>
                  <span>您</span>
                  <User size={12} className="text-orca-accent" />
                </>
              ) : (
                <>
                  <Bot size={12} className="text-purple-400" />
                  <span className="font-semibold text-purple-300">MonoTerminal Ops Agent</span>
                </>
              )}
            </div>

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
                fallback={<div className="whitespace-pre-wrap leading-relaxed text-xs">{msg.content}</div>}
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
