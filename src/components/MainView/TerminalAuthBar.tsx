import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { KeyRound, Send, X, AlertTriangle, Loader2, PlayCircle } from 'lucide-react';
import { getAuthStore } from '../../services/terminalAuth';

interface TerminalAuthBarProps {
  sessionId: string;
}

/**
 * Masked input bar for interactive prompts (`sudo` / `su` / `ssh` / passphrase).
 *
 * The terminal cannot offer a usable password field: keystrokes are swallowed by
 * sudo's echo-off setting, which makes a working terminal look broken. This bar
 * collects the secret in a proper masked control and writes it to the pty once
 * the remote side is actually waiting for it.
 */
export const TerminalAuthBar: React.FC<TerminalAuthBarProps> = ({ sessionId }) => {
  const store = getAuthStore(sessionId);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.visible) {
      setValue('');
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.visible, state.phase]);

  if (!state.visible) return null;

  const isBusy = state.phase === 'verifying';

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!isBusy && value) {
        store.submit(value);
        setValue('');
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      store.cancel();
    }
    // Keep terminal shortcuts (Ctrl+W etc.) from firing while typing a secret.
    event.stopPropagation();
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl rounded-lg border border-orca-warning/60 bg-orca-card/98 backdrop-blur-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-orca-border/70">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-5 h-5 rounded bg-orca-warning/20 flex items-center justify-center text-orca-warning shrink-0">
              <KeyRound size={12} />
            </div>
            <span className="text-[11px] font-semibold text-orca-warning truncate">
              {state.label}
            </span>
            {state.origin === 'elevation' && state.pendingBlock && (
              <span className="text-[10px] text-orca-muted shrink-0">
                {state.pendingAction === 'fill'
                  ? '· 验证通过后填入终端待确认'
                  : '· 验证通过后自动执行挂起的命令'}
              </span>
            )}
          </div>

          <button
            onClick={() => store.cancel()}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-orca-muted hover:text-white hover:bg-orca-hover transition-colors shrink-0"
            title="关闭面板（挂起的命令不会被执行）"
          >
            <X size={12} />
            <span>取消</span>
          </button>
        </div>

        {/* Input row */}
        <div className="p-2.5 flex items-center space-x-2">
          <input
            ref={inputRef}
            type={state.requiresPassword ? 'password' : 'text'}
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            autoComplete="off"
            spellCheck={false}
            placeholder={state.requiresPassword ? '在此输入密码后回车（不会回显）' : '输入内容后回车'}
            className="flex-1 bg-orca-bg border border-orca-border focus:border-orca-warning rounded px-2.5 py-1.5 text-xs text-white outline-none font-mono placeholder:text-orca-muted/60 disabled:opacity-50"
          />

          <button
            onClick={() => {
              if (!isBusy && value) {
                store.submit(value);
                setValue('');
              }
            }}
            disabled={isBusy || !value}
            className="flex items-center space-x-1 px-3 py-1.5 bg-orca-warning hover:bg-amber-500 disabled:opacity-40 text-black text-xs rounded font-medium transition-colors shrink-0"
          >
            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            <span>{isBusy ? '验证中' : '发送'}</span>
          </button>

          {state.origin === 'elevation' && state.pendingBlock && (
            <button
              onClick={() => store.forceFlush()}
              disabled={isBusy}
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-orca-surface hover:bg-orca-hover disabled:opacity-40 border border-orca-border text-orca-text text-xs rounded transition-colors shrink-0"
              title="该会话已缓存 sudo 凭据（或配置了 NOPASSWD）时，直接处理挂起的命令"
            >
              <PlayCircle size={12} className="text-orca-success" />
              <span>{state.pendingAction === 'fill' ? '无需密码，直接填入' : '无需密码，直接执行'}</span>
            </button>
          )}
        </div>

        {/* Hint / error */}
        <div className="px-3 pb-2 -mt-0.5">
          {state.error ? (
            <div className="flex items-start space-x-1.5 text-[10px] text-orca-danger leading-relaxed">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{state.error}</span>
            </div>
          ) : (
            <div className="text-[10px] text-orca-muted leading-relaxed">
              {state.hint} · Esc 关闭
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
