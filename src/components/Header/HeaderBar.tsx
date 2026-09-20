import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { Plus, Server, Terminal, Settings, BookOpen, X, Edit2, Check, Bot, Globe } from 'lucide-react';
import { SessionTab } from '../../types';

interface HeaderBarProps {
  onOpenLanding?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onOpenLanding }) => {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    closeSession,
    setIsHostModalOpen,
    setIsSettingsModalOpen,
    setIsSnippetModalOpen,
    hosts,
    createSession,
    toggleAgent
  } = useSession();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleStartRename = (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  };

  const handleSaveRename = (tab: SessionTab) => {
    if (editingTitle.trim()) {
      tab.title = editingTitle.trim();
    }
    setEditingTabId(null);
  };

  return (
    <header className="h-9 bg-orca-surface border-b border-orca-border flex items-center justify-between px-2 select-none z-30">
      {/* Left: Tab list */}
      <div className="flex items-center space-x-1 overflow-x-auto flex-1 h-full py-1 pr-2 no-scrollbar">
        {sessions.map((tab) => {
          const isActive = tab.id === activeSessionId;
          const isEditing = editingTabId === tab.id;

          let statusColor = 'bg-orca-success';
          if (tab.status === 'disconnected') statusColor = 'bg-orca-danger';
          if (tab.status === 'connecting' || tab.status === 'busy') statusColor = 'bg-orca-warning animate-pulse';

          return (
            <div
              key={tab.id}
              onClick={() => setActiveSessionId(tab.id)}
              className={`group flex items-center space-x-2 px-3 py-1 text-xs rounded-t border-t-2 transition-all cursor-pointer h-full max-w-[200px] truncate ${
                isActive
                  ? 'bg-orca-bg border-orca-accent text-white font-medium shadow'
                  : 'bg-orca-surface hover:bg-orca-card border-transparent text-orca-muted hover:text-orca-text'
              }`}
            >
              {/* Status indicator dot */}
              <span className={`w-2 h-2 rounded-full ${statusColor} shrink-0`} />

              {/* Title or edit input */}
              {isEditing ? (
                <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(tab);
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    autoFocus
                    className="bg-orca-card text-white text-xs px-1 py-0.5 rounded border border-orca-accent outline-none w-24"
                  />
                  <button
                    onClick={() => handleSaveRename(tab)}
                    className="text-orca-success hover:text-white"
                  >
                    <Check size={12} />
                  </button>
                </div>
              ) : (
                <span
                  onDoubleClick={(e) => handleStartRename(tab, e)}
                  className="truncate flex-1 font-mono text-[11px]"
                  title={`${tab.title} (双击重命名)`}
                >
                  {tab.title}
                </span>
              )}

              {/* Quick actions on tab */}
              {!isEditing && (
                <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleStartRename(tab, e)}
                    className="p-0.5 hover:text-white text-orca-muted rounded"
                    title="重命名"
                  >
                    <Edit2 size={10} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeSession(tab.id);
                    }}
                    className="p-0.5 hover:text-orca-danger text-orca-muted rounded"
                    title="关闭会话 (Ctrl+W)"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Add new tab button */}
        <button
          onClick={() => {
            if (hosts.length > 0) {
              createSession(hosts[0]);
            } else {
              setIsHostModalOpen(true);
            }
          }}
          className="flex items-center space-x-1 px-2 py-1 text-xs text-orca-muted hover:text-orca-accent hover:bg-orca-card rounded transition-colors"
          title="新建连接 (Ctrl+T)"
        >
          <Plus size={14} />
          <span className="text-[11px]">新建会话</span>
        </button>
      </div>

      {/* Right: Quick Tools */}
      <div className="flex items-center space-x-1 pl-2 border-l border-orca-border">
        <button
          onClick={() => toggleAgent()}
          className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-colors ${
            activeSession?.isAgentOpen
              ? 'bg-purple-600 text-white font-medium shadow-sm'
              : 'text-purple-300 hover:text-white hover:bg-orca-card'
          }`}
          title="展开/收起 AI 助手 (Ctrl+\)"
        >
          <Bot size={13} className={activeSession?.isAgentOpen ? 'text-white' : 'text-purple-400'} />
          <span className="text-[11px] hidden sm:inline">AI 助手</span>
        </button>

        <button
          onClick={() => setIsHostModalOpen(true)}
          className="flex items-center space-x-1 px-2 py-1 text-xs text-orca-muted hover:text-white hover:bg-orca-card rounded transition-colors"
          title="主机资产管理 (AES-256 加密)"
        >
          <Server size={13} className="text-orca-accent" />
          <span className="text-[11px] hidden sm:inline">主机资产</span>
        </button>

        <button
          onClick={() => setIsSnippetModalOpen(true)}
          className="flex items-center space-x-1 px-2 py-1 text-xs text-orca-muted hover:text-white hover:bg-orca-card rounded transition-colors"
          title="快捷命令代码库"
        >
          <BookOpen size={13} className="text-orca-warning" />
          <span className="text-[11px] hidden sm:inline">命令库</span>
        </button>

        <button
          onClick={() => setIsSettingsModalOpen(true)}
          className="flex items-center space-x-1 px-2 py-1 text-xs text-orca-muted hover:text-white hover:bg-orca-card rounded transition-colors"
          title="全局设置 (AI 引擎与快捷键)"
        >
          <Settings size={13} className="text-orca-muted hover:text-orca-accent" />
          <span className="text-[11px] hidden sm:inline">设置</span>
        </button>

        {onOpenLanding && (
          <button
            onClick={onOpenLanding}
            className="flex items-center space-x-1 px-2 py-1 text-xs text-emerald-400 hover:text-white hover:bg-orca-card rounded transition-colors border border-emerald-500/30"
            title="返回产品介绍落地页"
          >
            <Globe size={13} />
            <span className="text-[11px] hidden sm:inline">产品介绍</span>
          </button>
        )}
      </div>
    </header>
  );
};
