import React from 'react';
import { useSession } from '../../context/SessionContext';
import { Terminal, Bot, PanelRightClose, PanelRightOpen } from 'lucide-react';

export const ModeBar: React.FC = () => {
  const { activeSession, toggleAgent } = useSession();

  if (!activeSession) return null;

  const isAgentOpen = Boolean(activeSession.isAgentOpen);

  return (
    <div className="h-7 bg-orca-surface/90 border-b border-orca-border flex items-center justify-between px-3 text-xs select-none backdrop-blur-sm z-10 shrink-0">
      {/* Left: Terminal status and session info */}
      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1.5 text-orca-text font-medium text-[11px]">
          <Terminal size={13} className="text-orca-accent" />
          <span>终端视窗</span>
          <span className="text-orca-border">/</span>
          <span className="text-orca-muted font-mono text-[10px]">{activeSession.title}</span>
        </div>
      </div>

      {/* Right: AI Agent toggle button with icon and shortcut */}
      <div className="flex items-center space-x-2">
        <button
          onClick={() => toggleAgent()}
          className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded text-[11px] font-medium transition-all relative ${
            isAgentOpen
              ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm'
              : 'bg-orca-card hover:bg-orca-card/80 border border-purple-900/60 text-purple-300 hover:text-white'
          }`}
          title={isAgentOpen ? '收起 AI 助手 (Ctrl+\\)' : '在当前窗口展开 AI 运维助手 (Ctrl+\\)'}
        >
          <Bot size={13} className={isAgentOpen ? 'text-white' : 'text-purple-400'} />
          <span>{isAgentOpen ? '🤖 AI 助手 (已展开)' : '🤖 AI 助手'}</span>
          <kbd className={`px-1 py-0.2 rounded text-[10px] font-mono ${
            isAgentOpen ? 'bg-purple-800 text-purple-200' : 'bg-orca-bg text-orca-muted border border-orca-border'
          }`}>
            Ctrl + \
          </kbd>

          {isAgentOpen ? (
            <PanelRightClose size={12} className="ml-0.5 opacity-80" />
          ) : (
            <PanelRightOpen size={12} className="ml-0.5 opacity-80" />
          )}

          {activeSession.unreadError && !isAgentOpen && (
            <span className="w-2 h-2 rounded-full bg-orca-danger absolute -top-0.5 -right-0.5 animate-ping" />
          )}
        </button>
      </div>
    </div>
  );
};
