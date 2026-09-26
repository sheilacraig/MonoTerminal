import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { CommandSnippet } from '../../types';
import { BookOpen, X, Play, Clipboard, Check, Search } from 'lucide-react';

const DEFAULT_SNIPPETS: CommandSnippet[] = [
  {
    id: 's1',
    category: 'Nginx 服务运维',
    title: '测试配置文件语法有效性',
    command: 'nginx -t',
    description: '检查 /etc/nginx/nginx.conf 语法正确性与缺失符号'
  },
  {
    id: 's2',
    category: 'Nginx 服务运维',
    title: '优雅重新加载 Nginx 服务',
    command: 'systemctl reload nginx || nginx -s reload',
    description: '不中断现有长连接平滑应用新配置'
  },
  {
    id: 's3',
    category: 'Nginx 服务运维',
    title: '追踪 Nginx 实时错误日志',
    command: 'tail -f /var/log/nginx/error.log',
    description: '动态查看最近产生的 500、404 或反代超时报错'
  },
  {
    id: 's4',
    category: '网络与端口诊断',
    title: '查看所有监听中的端口及进程 PID',
    command: 'ss -tulpn',
    description: '快速定位 80, 443, 3000, 3306 端口占用'
  },
  {
    id: 's5',
    category: '网络与端口诊断',
    title: '检查指定端口占用进程',
    command: 'lsof -i :80 -P -n',
    description: '查询占用 80 端口的具体进程与用户'
  },
  {
    id: 's6',
    category: '系统与性能巡检',
    title: '查看系统磁盘空间分布',
    command: 'df -h -x tmpfs -x devtmpfs',
    description: '查看物理挂载点使用率，防止日志爆盘'
  },
  {
    id: 's7',
    category: '系统与性能巡检',
    title: '查看系统内存与 Swap 占用',
    command: 'free -h',
    description: '显示可用空闲物理内存与缓冲利用率'
  },
  {
    id: 's8',
    category: 'Docker 容器管理',
    title: '列出所有容器运行状态与端口映射',
    command: 'docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"',
    description: '格式化输出容器简要列表'
  }
];

export const SnippetModal: React.FC = () => {
  const {
    isSnippetModalOpen,
    setIsSnippetModalOpen,
    activeSession,
    executeCommandWithGuardrail
  } = useSession();
  const { sendTermInput } = useWebSocket();

  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isSnippetModalOpen) return null;

  const filtered = DEFAULT_SNIPPETS.filter(
    s =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.command.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase())
  );

  const handleRun = (cmd: string) => {
    if (activeSession) {
      setIsSnippetModalOpen(false);
      executeCommandWithGuardrail(cmd, () => sendTermInput(activeSession.id, `${cmd}\r`));
    }
  };

  const handleFill = (cmd: string) => {
    if (activeSession) {
      setIsSnippetModalOpen(false);
      executeCommandWithGuardrail(cmd, () => sendTermInput(activeSession.id, cmd));
    }
  };

  const handleCopy = (id: string, cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-11 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-white">
            <BookOpen size={16} className="text-orca-warning" />
            <span>快捷运维命令库</span>
          </div>

          <button
            onClick={() => setIsSnippetModalOpen(false)}
            className="p-1 hover:bg-orca-border text-orca-muted hover:text-white rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 bg-orca-bg/50 border-b border-orca-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-orca-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索命令或说明 (例如: Nginx, 端口, Docker)..."
              className="w-full bg-orca-surface border border-orca-border text-white text-xs pl-9 pr-3 py-1.5 rounded-lg outline-none focus:border-orca-accent"
              autoFocus
            />
          </div>
        </div>

        {/* Snippets List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filtered.map(item => (
            <div
              key={item.id}
              className="bg-orca-card/60 hover:bg-orca-card border border-orca-border rounded-lg p-3 flex flex-col justify-between transition-colors"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div>
                  <div className="font-semibold text-white text-xs">{item.title}</div>
                  <div className="text-[11px] text-orca-muted mt-0.5">{item.description}</div>
                </div>
                <span className="text-[10px] bg-orca-surface text-orca-muted border border-orca-border px-1.5 py-0.5 rounded">
                  {item.category}
                </span>
              </div>

              <div className="font-mono text-xs text-emerald-400 bg-black/40 px-2.5 py-1.5 rounded border border-orca-border/50 my-1 overflow-x-auto">
                {item.command}
              </div>

              <div className="flex items-center justify-end space-x-1.5 pt-1 text-xs">
                <button
                  onClick={() => handleCopy(item.id, item.command)}
                  className="px-2 py-0.5 text-orca-muted hover:text-white bg-orca-surface hover:bg-orca-hover rounded text-[11px] flex items-center space-x-1"
                >
                  {copiedId === item.id ? (
                    <Check size={11} className="text-orca-success" />
                  ) : (
                    <Clipboard size={11} />
                  )}
                  <span>{copiedId === item.id ? '已复制' : '复制'}</span>
                </button>

                <button
                  onClick={() => handleFill(item.command)}
                  className="px-2.5 py-0.5 text-orca-text hover:text-white bg-orca-surface hover:bg-orca-hover rounded text-[11px]"
                >
                  填入终端
                </button>

                <button
                  onClick={() => handleRun(item.command)}
                  className="px-3 py-0.5 bg-orca-accent hover:bg-blue-600 text-white rounded text-[11px] font-medium flex items-center space-x-1"
                >
                  <Play size={10} className="fill-current" />
                  <span>立即执行</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
