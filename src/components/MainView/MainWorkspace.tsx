import React, { useState, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { ModeBar } from './ModeBar';
import { TerminalView } from './TerminalView';
import { AgentView } from './AgentView';
import { Terminal, Plus, Server } from 'lucide-react';

export const MainWorkspace: React.FC = () => {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setIsHostModalOpen,
    hosts,
    createSession,
    setAgentWidth
  } = useSession();

  const [isResizingAgent, setIsResizingAgent] = useState(false);

  // Drag resizer for Agent width
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingAgent || !activeSession) return;
      const containerWidth = window.innerWidth;
      const newAgentWidth = Math.max(320, Math.min(800, containerWidth - e.clientX));
      setAgentWidth(activeSession.id, newAgentWidth);
    };

    const handleMouseUp = () => {
      setIsResizingAgent(false);
    };

    if (isResizingAgent) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingAgent, activeSession, setAgentWidth]);

  if (sessions.length === 0 || !activeSession) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-orca-bg text-orca-muted p-8 select-none">
        <div className="w-16 h-16 rounded-2xl bg-orca-surface border border-orca-border flex items-center justify-center text-orca-accent mb-4 shadow-xl">
          <Terminal size={32} />
        </div>
        <h2 className="text-base font-semibold text-white mb-2">暂无活跃会话</h2>
        <p className="text-xs text-orca-muted max-w-sm text-center mb-6">
          MonoTerminal 是 100% 免登录、本地优先的下一代 AI 运维终端。您可以连接远程服务器或体验内置仿真沙盒。
        </p>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => {
              if (hosts.length > 0) createSession(hosts[0]);
              else setIsHostModalOpen(true);
            }}
            className="flex items-center space-x-1.5 px-4 py-2 bg-orca-accent hover:bg-blue-600 text-white text-xs rounded-lg font-medium shadow transition-colors"
          >
            <Plus size={14} />
            <span>快速连接沙盒 (Demo)</span>
          </button>

          <button
            onClick={() => setIsHostModalOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-orca-surface hover:bg-orca-card border border-orca-border text-white text-xs rounded-lg font-medium transition-colors"
          >
            <Server size={14} className="text-orca-accent" />
            <span>主机资产管理</span>
          </button>
        </div>
      </div>
    );
  }

  const isAgentOpen = Boolean(activeSession.isAgentOpen);
  const agentWidth = activeSession.agentWidth || 460;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] overflow-hidden relative">
      {/* 28px Mode Indicator & Quick Action Bar */}
      <ModeBar />

      {/* Main Workspace: Terminal and Agent in the SAME Window */}
      <div className="flex-1 flex w-full h-full overflow-hidden relative">
        {/* Terminal Area (Always present in window) */}
        <div className="flex-1 h-full min-w-0 relative overflow-hidden bg-[#0d1117]">
          {sessions.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 w-full h-full ${
                tab.id === activeSessionId ? 'block z-10' : 'hidden'
              }`}
            >
              <TerminalView
                sessionId={tab.id}
                isVisible={tab.id === activeSessionId}
              />
            </div>
          ))}
        </div>

        {/* Drag Resizer between Terminal and Agent */}
        {isAgentOpen && (
          <div
            onMouseDown={() => setIsResizingAgent(true)}
            className="w-1.5 h-full cursor-col-resize hover:bg-purple-500/60 bg-orca-border transition-colors z-20 shrink-0"
            title="拖拽调节终端与 AI 助手宽度"
          />
        )}

        {/* Agent Assistant Area (Coexists in the same window) */}
        {isAgentOpen && (
          <div
            style={{ width: `${agentWidth}px` }}
            className="h-full border-l border-orca-border z-20 shrink-0 overflow-hidden animate-in slide-in-from-right-10 duration-150"
          >
            <AgentView isVisible={isAgentOpen} />
          </div>
        )}
      </div>
    </div>
  );
};
