import React from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSettings } from '../../context/SettingsContext';
import { SHORTCUTS } from '../../constants/shortcuts';
import { Activity, ShieldCheck } from 'lucide-react';

export const StatusBar: React.FC = () => {
  const { rtt, isConnected } = useWebSocket();
  const { settings } = useSettings();
  const sc = settings.shortcuts;

  let latencyColor = 'text-orca-success';
  if (rtt > 80) latencyColor = 'text-orca-warning';
  if (rtt > 200 || !isConnected) latencyColor = 'text-orca-danger';

  return (
    <footer className="h-6 bg-orca-surface border-t border-orca-border px-3 flex items-center justify-between text-[11px] text-orca-muted font-mono select-none z-30 shrink-0">
      {/* Left: Latency & Encryption & Encoding */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1" title="实时网络往返延迟 (RTT)">
          <Activity size={12} className={latencyColor} />
          <span className={latencyColor}>{isConnected ? `${rtt}ms` : '断开连接'}</span>
        </div>

        <span className="text-orca-border">|</span>

        <div className="flex items-center space-x-1" title="SSH 加密传输通道 (本地运行)">
          <ShieldCheck size={12} className="text-orca-accent" />
          <span>SSH-2.0 (AES-256)</span>
        </div>

        <span className="text-orca-border hidden sm:inline">|</span>

        <span className="hidden sm:inline" title="终端字符集编码">
          UTF-8
        </span>
      </div>

      {/* Right: Shortcut guide */}
      <div className="flex items-center space-x-3 hidden md:flex text-[10px]">
        <span>
          <kbd className="text-white">{sc?.toggleMode || SHORTCUTS.TOGGLE_AGENT}</kbd> 穿梭模式
        </span>
        <span>
          <kbd className="text-white">{sc?.toggleSidebar || SHORTCUTS.TOGGLE_SIDEBAR}</kbd> 折叠侧栏
        </span>
        <span>
          <kbd className="text-white">{sc?.newTab || SHORTCUTS.NEW_TAB}</kbd> 新建会话
        </span>
        <span>
          <kbd className="text-white">{sc?.closeTab || SHORTCUTS.CLOSE_TAB}</kbd> 关闭标签
        </span>
      </div>
    </footer>
  );
};
