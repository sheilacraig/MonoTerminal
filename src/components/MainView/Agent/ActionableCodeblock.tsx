import React from 'react';
import { Play, ClipboardPaste, HelpCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { checkCommandSafety } from '../../../utils/guardrail';
import { parseShellCommands } from '../../../utils/commandCleaner';

interface ActionableCodeblockProps {
  code: string;
  lang: string;
  explanation?: string;
  /** Optional syntax-highlighted body (from react-markdown + rehype-highlight). */
  children?: React.ReactNode;
  onRun: (code: string) => void;
  onFill: (code: string) => void;
  onExplain: (code: string) => void;
}

export const ActionableCodeblock: React.FC<ActionableCodeblockProps> = ({
  code,
  lang,
  explanation,
  children,
  onRun,
  onFill,
  onExplain
}) => {
  const parsed = parseShellCommands(code);
  const executableCode = parsed.cleanCommand || code;
  const check = checkCommandSafety(executableCode);
  const isDangerous = check.isDangerous;

  return (
    <div
      className={`my-3 rounded-lg border overflow-hidden shadow-lg transition-all ${
        isDangerous ? 'border-orca-danger/80 bg-orca-danger/5' : 'border-orca-border bg-[#0a0d12]'
      }`}
    >
      {/* Codeblock Action Header */}
      <div className="h-8 bg-orca-card px-3 flex items-center justify-between border-b border-orca-border select-none">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-orca-muted bg-orca-bg px-1.5 py-0.5 rounded border border-orca-border">
            {lang || 'bash'}
          </span>
          {parsed.strippedComments.length > 0 && (
            <span
              className="text-[10px] text-emerald-400/90 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/40 flex items-center space-x-1"
              title={`已自动剥离 ${parsed.strippedComments.length} 行注释，不向终端发送无用说明`}
            >
              <CheckCircle2 size={10} />
              <span>已过滤注释</span>
            </span>
          )}
          {isDangerous && (
            <div className="flex items-center space-x-1 text-[11px] text-orca-danger font-medium">
              <AlertTriangle size={12} />
              <span>高危命令预警</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => onExplain(executableCode)}
            className="flex items-center space-x-1 px-2 py-0.5 text-[11px] text-orca-muted hover:text-white bg-orca-surface hover:bg-orca-hover rounded transition-colors"
            title="分段解释该 Shell 命令各项参数含义"
          >
            <HelpCircle size={11} className="text-orca-warning" />
            <span>解释命令</span>
          </button>

          <button
            onClick={() => onFill(executableCode)}
            className="flex items-center space-x-1 px-2 py-0.5 text-[11px] text-orca-text hover:text-white bg-orca-surface hover:bg-orca-hover rounded transition-colors"
            title="填入左侧终端命令行末尾供编辑，不自动敲回车"
          >
            <ClipboardPaste size={11} className="text-orca-accent" />
            <span>填入终端</span>
          </button>

          <button
            onClick={() => onRun(executableCode)}
            className={`flex items-center space-x-1 px-2.5 py-0.5 text-[11px] rounded font-medium transition-all shadow-sm ${
              isDangerous
                ? 'bg-orca-danger hover:bg-red-600 text-white animate-pulse'
                : 'bg-orca-success hover:bg-green-600 text-white'
            }`}
            title={
              parsed.hasMultipleCommands
                ? `按顺序在终端依次执行这 ${parsed.individualCommands.length} 条命令`
                : '直接在左侧终端运行该命令，回显实时可见'
            }
          >
            <Play size={11} className="fill-current" />
            <span>
              {parsed.hasMultipleCommands
                ? `立即在终端运行全部 (${parsed.individualCommands.length})`
                : '立即在终端运行'}
            </span>
          </button>
        </div>
      </div>

      {/* Code content — highlighted body when provided, else plain shell text */}
      <pre className="p-3 text-xs font-mono overflow-x-auto selection:bg-orca-accent/30 leading-5">
        {children ? (
          <code className="hljs">{children}</code>
        ) : (
          <span className="text-emerald-400">{code}</span>
        )}
      </pre>

      {/* Individual command execution rows when multiple commands are present */}
      {parsed.hasMultipleCommands && (
        <div className="bg-[#0c1017] border-t border-orca-border/70 px-3 py-2 flex flex-col space-y-1.5 select-none">
          <div className="text-[10px] text-orca-muted flex items-center justify-between">
            <span>分步独立执行（共 {parsed.individualCommands.length} 步）：</span>
          </div>
          <div className="flex flex-col space-y-1">
            {parsed.individualCommands.map((cmd, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between bg-orca-surface/70 hover:bg-orca-surface border border-orca-border/40 rounded px-2.5 py-1 text-[11px] font-mono transition-colors group"
              >
                <div className="flex items-center space-x-1.5 min-w-0 mr-2">
                  <span className="text-orca-muted text-[10px] w-3 text-right shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="text-emerald-400 truncate" title={cmd}>
                    {cmd}
                  </span>
                </div>
                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    onClick={() => onFill(cmd)}
                    className="px-1.5 py-0.5 text-[10px] text-orca-muted hover:text-white bg-orca-bg hover:bg-orca-hover border border-orca-border/60 rounded transition-colors"
                    title="将此单步命令填入终端"
                  >
                    <ClipboardPaste size={10} className="inline mr-1 text-orca-accent" />
                    填入
                  </button>
                  <button
                    onClick={() => onRun(cmd)}
                    className="px-2 py-0.5 text-[10px] text-white bg-orca-success/80 hover:bg-orca-success rounded transition-colors font-medium shadow-sm"
                    title="仅运行此单步命令"
                  >
                    <Play size={10} className="inline fill-current mr-1" />
                    运行
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explanation drawer if triggered */}
      {explanation && (
        <div className="bg-orca-card/60 p-2.5 border-t border-orca-border text-xs text-orca-text font-sans">
          <div className="whitespace-pre-wrap leading-relaxed">{explanation}</div>
        </div>
      )}
    </div>
  );
};
