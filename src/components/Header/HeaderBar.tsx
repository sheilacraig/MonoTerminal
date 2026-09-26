import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { Plus, X, Edit2, Check, Bot, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { SessionTab } from '../../types';

interface HeaderBarProps {
  onOpenLanding?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = () => {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    closeSession,
    openHostModal,
    hosts,
    createSession,
    toggleAgent,
    updateSessionTitle
  } = useSession();

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const handleStartRename = (tab: SessionTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditingTitle(tab.title);
  };

  const handleSaveRename = (tab: SessionTab) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      updateSessionTitle(tab.id, trimmed);
    }
    setEditingTabId(null);
  };

  const isAgentOpen = Boolean(activeSession?.isAgentOpen);

  return (
    <header className="h-9 bg-orca-surface border-b border-orca-border flex items-center justify-between px-2 select-none z-30">
      {/* Left: Tab list */}
      <div className="flex items-center space-x-1 overflow-x-auto flex-1 h-full py-1 pr-2 no-scrollbar">
        {sessions.map(tab => {
          const isActive = tab.id === activeSessionId;
          const isEditing = editingTabId === tab.id;

          let statusColor = 'bg-orca-success';
          if (tab.status === 'disconnected') statusColor = 'bg-orca-danger';
          if (tab.status === 'connecting' || tab.status === 'busy')
            statusColor = 'bg-orca-warning animate-pulse';

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
                <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onKeyDown={e => {
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
                  onDoubleClick={e => handleStartRename(tab, e)}
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
                    onClick={e => handleStartRename(tab, e)}
                    className="p-0.5 hover:text-white text-orca-muted rounded"
                    title="重命名"
                  >
                    <Edit2 size={10} />
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      closeSession(tab.id);
                    }}
                    className="p-0.5 hover:text-orca-danger text-orca-muted rounded"
                    title="关闭会话 (Ctrl+Shift+W)"
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
              openHostModal(null);
            }
          }}
          className="flex items-center space-x-1 px-2 py-1 text-xs text-orca-muted hover:text-orca-accent hover:bg-orca-card rounded transition-colors"
          title="新建终端标签页 (Ctrl+Shift+T)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Right: Single AI Assistant Toggle */}
      <div className="flex items-center space-x-1 pl-2 border-l border-orca-border">
        <button
          onClick={() => toggleAgent()}
          className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs rounded transition-colors relative ${
            isAgentOpen
              ? 'bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-sm'
              : 'bg-orca-card/70 hover:bg-orca-card text-purple-300 hover:text-white border border-purple-900/50'
          }`}
          title={isAgentOpen ? '收起 AI 助手 (Ctrl+\\)' : '展开 AI 助手 (Ctrl+\\)'}
        >
          <Bot size={13} className={isAgentOpen ? 'text-white' : 'text-purple-400'} />
          <span className="text-[11px] hidden sm:inline">AI 助手</span>
          {isAgentOpen ? (
            <PanelRightClose size={12} className="opacity-80" />
          ) : (
            <PanelRightOpen size={12} className="opacity-80" />
          )}
          {activeSession?.unreadError && !isAgentOpen && (
            <span className="w-2 h-2 rounded-full bg-orca-danger absolute -top-0.5 -right-0.5 animate-ping" />
          )}
        </button>
      </div>
    </header>
  );
};

