import React from 'react';
import { useSession } from '../../context/SessionContext';
import { Terminal, Bot, PanelRightClose, PanelRightOpen, ChevronRight } from 'lucide-react';

export const ModeBar: React.FC = () => {
  const { activeSession, hosts, toggleAgent } = useSession();

  if (!activeSession) return null;

  const isAgentOpen = Boolean(activeSession.isAgentOpen);
  const host = hosts.find(item => item.id === activeSession.hostId);
  const status = {
    connected: { label: '已连接', color: 'bg-emerald-400', text: 'text-emerald-300' },
    connecting: { label: '连接中', color: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
    busy: { label: '忙碌', color: 'bg-blue-400 animate-pulse', text: 'text-blue-300' },
    disconnected: { label: '已断开', color: 'bg-slate-500', text: 'text-slate-400' }
  }[activeSession.status];

  return (
    <div className="h-10 bg-[#0f151d] border-b border-white/[0.06] flex items-center justify-between px-4 text-xs select-none shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Terminal size={14} className="text-blue-300 shrink-0" />
        <span className="text-slate-200 font-medium">终端</span>
        <ChevronRight size={12} className="text-slate-600 shrink-0" />
        <span className="text-slate-300 truncate">{host?.name || activeSession.title}</span>
        {host?.username && host.authType !== 'local' && (
          <span className="text-slate-500 font-mono text-[10px] shrink-0">{host.username}</span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className={`hidden sm:flex items-center gap-1.5 text-[10px] ${status.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.color}`} />
          <span>{status.label}</span>
        </div>
        <button
          onClick={() => toggleAgent()}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all relative ${
            isAgentOpen
              ? 'bg-violet-500/15 border border-violet-400/30 text-violet-200'
              : 'bg-white/[0.03] hover:bg-violet-500/10 border border-white/[0.08] hover:border-violet-400/25 text-slate-300 hover:text-violet-200'
          }`}
          title={isAgentOpen ? '收起 AI 助手 (Ctrl+\\)' : '在当前窗口展开 AI 运维助手 (Ctrl+\\)'}
        >
          <Bot size={13} className={isAgentOpen ? 'text-white' : 'text-purple-400'} />
          <span>{isAgentOpen ? 'AI 助手已打开' : '打开 AI 助手'}</span>
          <kbd
            className={`hidden md:inline px-1.5 py-0.5 rounded text-[9px] font-mono ${
              isAgentOpen
                ? 'bg-violet-400/10 text-violet-200/70'
                : 'bg-black/20 text-slate-500 border border-white/[0.06]'
            }`}
          >
            Ctrl + \
          </kbd>

          {isAgentOpen ? (
            <PanelRightClose size={12} className="ml-0.5 opacity-80" />
          ) : (
            <PanelRightOpen size={12} className="ml-0.5 opacity-80" />
          )}

          {activeSession.unreadError && !isAgentOpen && (
            <span className="w-2 h-2 rounded-full bg-rose-400 absolute -top-0.5 -right-0.5" />
          )}
        </button>
      </div>
    </div>
  );
};
