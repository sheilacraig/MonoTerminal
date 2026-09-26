import React, { useRef, useEffect, useState } from 'react';
import { Play, Send } from 'lucide-react';
import { AGENT_INPUT_ATTR } from '../../../utils/clipboard';

interface AgentInputBarProps {
  input: string;
  isStreaming: boolean;
  onChange: (val: string) => void;
  onSend: () => void;
  onRunPlan: () => void;
  isPlanRunning: boolean;
  autoFocus?: boolean;
}

const MIN_INPUT_HEIGHT = 56;
const DEFAULT_INPUT_HEIGHT = 68;
const MAX_INPUT_HEIGHT = 380;

export const AgentInputBar: React.FC<AgentInputBarProps> = ({
  input,
  isStreaming,
  onChange,
  onSend,
  onRunPlan,
  isPlanRunning,
  autoFocus
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState<number>(DEFAULT_INPUT_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ y: number; height: number }>({
    y: 0,
    height: DEFAULT_INPUT_HEIGHT
  });

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartRef.current.y - e.clientY;
      const dynamicMax = Math.min(MAX_INPUT_HEIGHT, Math.floor(window.innerHeight * 0.6));
      const nextHeight = Math.max(
        MIN_INPUT_HEIGHT,
        Math.min(dynamicMax, dragStartRef.current.height + deltaY)
      );
      setHeight(nextHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, height };
    setIsResizing(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="relative bg-orca-surface border-t border-orca-border shrink-0">
      {/* Top Drag Resizer Handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        className={`group w-full h-2 -mt-1 cursor-row-resize flex items-center justify-center transition-colors select-none z-10 ${
          isResizing ? 'bg-purple-500/40' : 'hover:bg-purple-500/30'
        }`}
        title="上下拖拽调节输入框高度"
      >
        <div
          className={`w-8 h-0.5 rounded-full transition-colors ${
            isResizing ? 'bg-purple-400' : 'bg-orca-border group-hover:bg-purple-400'
          }`}
        />
      </div>

      <div className="px-3 pb-3 pt-1.5">
        <div className="relative rounded-lg bg-orca-bg border border-orca-border focus-within:border-orca-accent shadow-inner transition-colors">
          <textarea
            ref={textareaRef}
            {...{ [AGENT_INPUT_ATTR]: 'true' }}
            value={input}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="向运维 Agent 提问 (例如: '查下 Nginx 80 端口占用原因并提供解决脚本')... 按 Enter 发送"
            style={{ height: `${height}px` }}
            className="w-full bg-transparent text-white text-xs p-2.5 pr-36 outline-none resize-none placeholder:text-orca-muted/60 font-sans block"
          />

          <div className="absolute right-2 bottom-2 flex items-center space-x-1.5">
            <button
              onClick={onRunPlan}
              disabled={!input.trim() || isStreaming || isPlanRunning}
              title="按输入框中的目标生成并执行步骤；高风险操作会先请求审批"
              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded font-medium flex items-center space-x-1 transition-all shadow"
            >
              <Play size={12} />
              <span>计划执行</span>
            </button>
            <button
              onClick={onSend}
              disabled={!input.trim() || isStreaming}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded font-medium flex items-center space-x-1 transition-all shadow"
            >
              <span>发送</span>
              <Send size={12} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-orca-muted font-mono">
          <span>发送用于对话；计划执行会调用工具，高风险操作需审批 | 同一窗口查看执行结果</span>
          <span>Shift + Enter 换行 | Enter 发送</span>
        </div>
      </div>
    </div>
  );
};
