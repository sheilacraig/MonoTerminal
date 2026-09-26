import React from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSettings } from '../../context/SettingsContext';
import { SHORTCUTS } from '../../constants/shortcuts';
import { Wifi, Keyboard } from 'lucide-react';
import { useSession } from '../../context/SessionContext';

export const StatusBar: React.FC = () => {
  const { rtt, isConnected } = useWebSocket();
  const { settings } = useSettings();
  const { activeSession } = useSession();
  const sc = settings.shortcuts;

  return (
    <footer className="h-7 bg-[#0e141b] border-t border-white/[0.06] px-4 flex items-center justify-between text-[10px] text-slate-500 font-mono select-none z-30 shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-1.5" title="终端会话连接状态">
          <span className={`w-1.5 h-1.5 rounded-full ${activeSession?.status === 'connected' ? 'bg-emerald-400' : activeSession?.status === 'connecting' || activeSession?.status === 'busy' ? 'bg-amber-400' : 'bg-slate-600'}`} />
          <span className="text-slate-400">{activeSession?.status === 'connected' ? '终端已连接' : activeSession?.status === 'connecting' ? '正在连接' : activeSession?.status === 'busy' ? '终端忙碌' : '终端未连接'}</span>
        </div>

        <span className="h-3 w-px bg-white/[0.08]" />

        <div className="flex items-center gap-1.5" title="客户端与本地服务的实时往返延迟">
          <Wifi size={11} className={isConnected ? 'text-slate-500' : 'text-rose-400'} />
          <span>{isConnected ? `${rtt} ms` : '服务离线'}</span>
        </div>

        <span className="hidden sm:inline text-slate-600">UTF-8</span>
      </div>

      <div className="hidden md:flex items-center gap-4 text-[9px]">
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <Keyboard size={10} /> 快捷键
        </span>
        <span><kbd className="text-slate-300">{sc?.toggleMode || SHORTCUTS.TOGGLE_AGENT}</kbd> 助手</span>
        <span><kbd className="text-slate-300">{sc?.toggleSidebar || SHORTCUTS.TOGGLE_SIDEBAR}</kbd> 侧栏</span>
        <span><kbd className="text-slate-300">{sc?.newTab || SHORTCUTS.NEW_TAB}</kbd> 新会话</span>
      </div>
    </footer>
  );
};
