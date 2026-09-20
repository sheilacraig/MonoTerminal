import React from 'react';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSettings } from '../../context/SettingsContext';
import { useSession } from '../../context/SessionContext';
import { Activity, ShieldCheck, Cpu, Command } from 'lucide-react';

export const StatusBar: React.FC = () => {
  const { rtt, isConnected } = useWebSocket();
  const { activeAIProvider } = useSettings();
  const { activeSession } = useSession();

  let latencyColor = 'text-orca-success';
  if (rtt > 80) latencyColor = 'text-orca-warning';
  if (rtt > 200 || !isConnected) latencyColor = 'text-orca-danger';

  return (
    <footer className="h-6 bg-orca-surface border-t border-orca-border px-3 flex items-center justify-between text-[11px] text-orca-muted font-mono select-none z-30 shrink-0">
      {/* Left: Latency & Encryption & Encoding */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1" title="实时网络往返延迟 (RTT)">
          <Activity size={12} className={latencyColor} />
          <span className={latencyColor}>
            {isConnected ? `${rtt}ms` : '断开连接'}
          </span>
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

        <span className="text-orca-border">|</span>

        <div className="flex items-center space-x-1 text-purple-400" title="当前激活的 AI 运维推理引擎">
          <Cpu size={12} />
          <span className="truncate max-w-[160px]">
            {activeAIProvider?.name || 'DeepSeek-V3'}
          </span>
        </div>
      </div>

      {/* Right: Shortcut guide */}
      <div className="flex items-center space-x-3 hidden md:flex text-[10px]">
        <span><kbd className="text-white">Ctrl+\</kbd> 穿梭模式</span>
        <span><kbd className="text-white">Ctrl+B</kbd> 折叠文件树</span>
        <span><kbd className="text-white">Ctrl+T</kbd> 新建会话</span>
        <span><kbd className="text-white">Ctrl+W</kbd> 关闭标签</span>
      </div>
    </footer>
  );
};
