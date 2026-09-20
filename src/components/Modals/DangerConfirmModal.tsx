import React, { useState, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { AlertOctagon, ShieldAlert, X } from 'lucide-react';

export const DangerConfirmModal: React.FC = () => {
  const { dangerPrompt, setDangerPrompt } = useSession();
  const [confirmInput, setConfirmInput] = useState('');

  // Handle Alt+Y shortcut
  useEffect(() => {
    if (!dangerPrompt) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        dangerPrompt.onConfirm();
      }
      if (e.key === 'Escape') {
        setDangerPrompt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dangerPrompt, setDangerPrompt]);

  if (!dangerPrompt) return null;

  const isConfirmed = confirmInput.trim().toLowerCase() === 'confirm';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-orca-surface border-2 border-orca-danger rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-orca-danger/20 border-b border-orca-danger/40 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-orca-danger font-bold text-sm">
            <AlertOctagon size={18} className="animate-pulse" />
            <span>【安全门禁拦截】检测到高危破坏性操作！</span>
          </div>
          <button
            onClick={() => setDangerPrompt(null)}
            className="text-orca-muted hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="text-xs text-orca-text leading-relaxed">
            系统安全守卫已自动拦截该命令。此操作具有不可逆的高破坏性风险，严禁在生产环境中未经核实执行！
          </div>

          {/* Dangerous Command Card */}
          <div className="rounded-lg bg-black/50 border border-orca-danger/50 p-3 font-mono text-xs text-orca-danger overflow-x-auto">
            {dangerPrompt.command}
          </div>

          {/* Reason Alert */}
          <div className="rounded-lg bg-orca-card p-3 border border-orca-border flex items-start space-x-2 text-xs text-orca-muted">
            <ShieldAlert size={16} className="text-orca-warning shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">拦截原因：</span>
              <span>{dangerPrompt.reason}</span>
            </div>
          </div>

          {/* Manual Input Confirmation */}
          <div className="space-y-1.5 pt-2">
            <label className="text-[11px] text-orca-muted block">
              如确认环境安全并执意执行，请在下方手动输入 <span className="font-mono text-orca-danger font-bold">confirm</span> 或直接敲击 <kbd className="px-1.5 py-0.5 bg-orca-bg text-white rounded border border-orca-border font-mono font-bold">Alt + Y</kbd>：
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="在此输入 confirm"
              className="w-full bg-orca-bg border border-orca-danger/50 text-white font-mono text-xs px-3 py-2 rounded-lg outline-none focus:border-orca-danger"
              autoFocus
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2.5 pt-3">
            <button
              onClick={() => setDangerPrompt(null)}
              className="px-4 py-2 bg-orca-card hover:bg-orca-hover text-orca-text text-xs rounded-lg transition-colors"
            >
              放弃执行 (Esc)
            </button>
            <button
              disabled={!isConfirmed}
              onClick={() => dangerPrompt.onConfirm()}
              className="px-4 py-2 bg-orca-danger hover:bg-red-600 disabled:opacity-40 text-white text-xs rounded-lg font-bold transition-all shadow-lg flex items-center space-x-1"
            >
              <span>强制放行并执行</span>
              <span className="text-[10px] opacity-80">(Alt+Y)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
