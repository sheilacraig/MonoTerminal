import React, { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface AgentInputBarProps {
  input: string;
  isStreaming: boolean;
  onChange: (val: string) => void;
  onSend: () => void;
  autoFocus?: boolean;
}

export const AgentInputBar: React.FC<AgentInputBarProps> = ({
  input,
  isStreaming,
  onChange,
  onSend,
  autoFocus
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="p-3 bg-orca-surface border-t border-orca-border shrink-0">
      <div className="relative rounded-lg bg-orca-bg border border-orca-border focus-within:border-orca-accent shadow-inner transition-colors">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="向运维 Agent 提问 (例如: '查下 Nginx 80 端口占用原因并提供解决脚本')... 按 Enter 发送"
          rows={2}
          className="w-full bg-transparent text-white text-xs p-2.5 pr-20 outline-none resize-none placeholder:text-orca-muted/60 font-sans"
        />

        <div className="absolute right-2 bottom-2 flex items-center space-x-1.5">
          <button
            onClick={onSend}
            disabled={!input.trim() || isStreaming}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-xs rounded font-medium flex items-center space-x-1 transition-all shadow"
          >
            <span>发送</span>
            <Send size={12} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-orca-muted font-mono">
        <span>提示: 按 [Ctrl + \] 可随时展开/收起 AI 助手 | 同一窗口实时执行与输出</span>
        <span>Shift + Enter 换行 | Enter 发送</span>
      </div>
    </div>
  );
};
