import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { Plus, X, Edit2, Check, Terminal } from 'lucide-react';
import { SessionTab } from '../../types';

interface HeaderBarProps {
  onOpenLanding?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = () => {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    closeSession,
    openHostModal,
    hosts,
    createSession,
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

  return (
    <header className="h-11 bg-[#111720] border-b border-white/[0.06] flex items-center px-3 select-none z-30 shrink-0 shadow-sm">
      <div className="flex items-center gap-2.5 w-[184px] shrink-0 pr-4 mr-2 border-r border-white/[0.08] max-[640px]:w-8 max-[640px]:pr-0 max-[640px]:border-r-0">
        <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-400/20 flex items-center justify-center">
          <Terminal size={15} className="text-blue-300" />
        </div>
        <div className="min-w-0 leading-tight max-[640px]:hidden">
          <div className="text-[12px] font-semibold tracking-wide text-slate-100">MonoTerminal</div>
          <div className="text-[9px] tracking-[0.12em] uppercase text-slate-500">Ops workspace</div>
        </div>
      </div>

      {/* Open session tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto flex-1 h-full py-1.5 pr-2 no-scrollbar min-w-0">
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
              className={`group flex items-center gap-2 px-3 text-xs rounded-md border transition-all cursor-pointer h-full max-w-[220px] min-w-[118px] truncate ${
                isActive
                  ? 'bg-[#1b2633] border-blue-400/30 text-white font-medium shadow-sm'
                  : 'bg-transparent hover:bg-white/[0.04] border-transparent text-slate-400 hover:text-slate-200'
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
          className="flex items-center justify-center w-8 h-8 text-slate-500 hover:text-blue-200 hover:bg-white/[0.06] rounded-md transition-colors"
          title="新建终端标签页 (Ctrl+Shift+T)"
        >
          <Plus size={14} />
        </button>
      </div>

    </header>
  );
};

