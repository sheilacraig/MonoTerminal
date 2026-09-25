import React from 'react';
import { Terminal, FileText, Bot, Server, Clock } from 'lucide-react';
import type { TimelineEntryPayload } from '../../../../shared/wsProtocol';

interface TimelinePanelProps {
  entries: TimelineEntryPayload[];
}

function renderKindIcon(kind: TimelineEntryPayload['kind']) {
  switch (kind) {
    case 'command':
      return <Terminal size={12} className="text-blue-400 shrink-0" />;
    case 'file':
      return <FileText size={12} className="text-emerald-400 shrink-0" />;
    case 'agent':
      return <Bot size={12} className="text-purple-400 shrink-0" />;
    case 'session':
      return <Server size={12} className="text-amber-400 shrink-0" />;
  }
}

function statusDot(status: TimelineEntryPayload['status']) {
  switch (status) {
    case 'success':
      return 'bg-emerald-400';
    case 'failed':
      return 'bg-rose-400';
    case 'running':
      return 'bg-blue-400 animate-pulse';
    case 'info':
    default:
      return 'bg-slate-400';
  }
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-orca-border bg-orca-surface/50 p-3 text-center text-[11px] text-orca-muted">
        暂无会话命令或 Agent 活动记录
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-orca-border bg-[#11161f] p-3 space-y-2 max-h-56 overflow-y-auto">
      <div className="flex items-center justify-between text-[11px] text-orca-muted border-b border-orca-border/60 pb-1.5">
        <div className="flex items-center space-x-1.5 font-medium text-orca-text">
          <Clock size={12} className="text-purple-400" />
          <span>会话统一时间线 (Command / File / Agent)</span>
        </div>
        <span>共 {entries.length} 条</span>
      </div>

      <div className="space-y-1.5">
        {entries
          .slice()
          .reverse()
          .map(entry => {
            const timeStr = new Date(entry.timestamp).toLocaleTimeString();
            return (
              <div
                key={entry.id}
                className="flex items-start justify-between gap-2 text-[11px] px-2 py-1 rounded bg-orca-bg/60 border border-orca-border/40"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(entry.status)}`} />
                  {renderKindIcon(entry.kind)}
                  <span className="text-orca-text font-mono truncate">{entry.title}</span>
                  {entry.detail && (
                    <span className="text-orca-muted text-[10px] truncate">({entry.detail})</span>
                  )}
                </div>
                <span className="text-[10px] text-orca-muted shrink-0 font-mono">{timeStr}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
};
