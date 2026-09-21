import React from 'react';
import { Play, ClipboardPaste, HelpCircle, AlertTriangle } from 'lucide-react';
import { checkCommandSafety } from '../../../utils/guardrail';

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
  const check = checkCommandSafety(code);
  const isDangerous = check.isDangerous;

  return (
    <div
      className={`my-3 rounded-lg border overflow-hidden shadow-lg transition-all ${
        isDangerous
          ? 'border-orca-danger/80 bg-orca-danger/5'
          : 'border-orca-border bg-[#0a0d12]'
      }`}
    >
      {/* Codeblock Action Header */}
      <div className="h-8 bg-orca-card px-3 flex items-center justify-between border-b border-orca-border select-none">
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-orca-muted bg-orca-bg px-1.5 py-0.5 rounded border border-orca-border">
            {lang || 'bash'}
          </span>
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
            onClick={() => onExplain(code)}
            className="flex items-center space-x-1 px-2 py-0.5 text-[11px] text-orca-muted hover:text-white bg-orca-surface hover:bg-orca-hover rounded transition-colors"
            title="分段解释该 Shell 命令各项参数含义"
          >
            <HelpCircle size={11} className="text-orca-warning" />
            <span>解释命令</span>
          </button>

          <button
            onClick={() => onFill(code)}
            className="flex items-center space-x-1 px-2 py-0.5 text-[11px] text-orca-text hover:text-white bg-orca-surface hover:bg-orca-hover rounded transition-colors"
            title="填入左侧终端命令行末尾供编辑，不自动敲回车"
          >
            <ClipboardPaste size={11} className="text-orca-accent" />
            <span>填入终端</span>
          </button>

          <button
            onClick={() => onRun(code)}
            className={`flex items-center space-x-1 px-2.5 py-0.5 text-[11px] rounded font-medium transition-all shadow-sm ${
              isDangerous
                ? 'bg-orca-danger hover:bg-red-600 text-white animate-pulse'
                : 'bg-orca-success hover:bg-green-600 text-white'
            }`}
            title="直接在左侧终端运行该命令，回显实时可见"
          >
            <Play size={11} className="fill-current" />
            <span>立即在终端运行</span>
          </button>
        </div>
      </div>

      {/* Code content — highlighted body when provided, else plain shell text */}
      <pre className="p-3 text-xs font-mono overflow-x-auto selection:bg-orca-accent/30 leading-5">
        {children ? <code className="hljs">{children}</code> : <span className="text-emerald-400">{code}</span>}
      </pre>

      {/* Explanation drawer if triggered */}
      {explanation && (
        <div className="bg-orca-card/60 p-2.5 border-t border-orca-border text-xs text-orca-text font-sans">
          <div className="whitespace-pre-wrap leading-relaxed">{explanation}</div>
        </div>
      )}
    </div>
  );
};
