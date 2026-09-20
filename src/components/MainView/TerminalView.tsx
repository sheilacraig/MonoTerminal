import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { isBackslashEvent, isSidebarEvent, isNewTabEvent, isCloseTabEvent } from '../../constants/shortcuts';
import { Zap, AlertCircle } from 'lucide-react';

interface TerminalViewProps {
  sessionId: string;
  isVisible: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, isVisible }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { sendTermInput, resizeTerm, registerTermHandler, registerTermErrorHandler } = useWebSocket();
  const {
    activeSession,
    appendTerminalContext,
    toggleMode,
    toggleAgent,
    setIsSidebarCollapsed,
    setIsHostModalOpen,
    closeSession
  } = useSession();
  const { settings } = useSettings();

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm.js
    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#1f6feb44',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      },
      fontFamily: settings.terminal.fontFamily || '"JetBrains Mono", Consolas, monospace',
      fontSize: settings.terminal.fontSize || 14,
      cursorBlink: settings.terminal.cursorBlink ?? true,
      scrollback: settings.terminal.scrollback || 5000,
      convertEol: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    // Intercept custom shortcuts before xterm consumes or transmits them as control characters
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && isBackslashEvent(event)) {
        if (event.type === 'keydown') {
          toggleAgent();
        }
        return false; // Prevent xterm from sending 0x1c (SIGQUIT)
      }

      if ((event.ctrlKey || event.metaKey) && isSidebarEvent(event)) {
        if (event.type === 'keydown') {
          setIsSidebarCollapsed((prev: boolean) => !prev);
        }
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && isNewTabEvent(event)) {
        if (event.type === 'keydown') {
          setIsHostModalOpen(true);
        }
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && isCloseTabEvent(event)) {
        if (event.type === 'keydown') {
          closeSession(sessionId);
        }
        return false;
      }

      return true;
    });

    // Send input from user typing to server
    const dataSub = term.onData((data) => {
      sendTermInput(sessionId, data);
    });

    // Receive data from server
    const unregisterData = registerTermHandler(sessionId, (data: string) => {
      term.write(data);
      appendTerminalContext(sessionId, data);
    });

    const unregisterError = registerTermErrorHandler(sessionId, (err: string) => {
      term.write(`\r\n\x1b[31m[错误] ${err}\x1b[0m\r\n`);
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try {
          fitAddon.fit();
          resizeTerm(sessionId, term.cols, term.rows);
        } catch {
          // Ignore fit errors during transitions
        }
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      dataSub.dispose();
      unregisterData();
      unregisterError();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  // When visibility changes (switching back from Agent), re-fit and focus terminal
  useEffect(() => {
    if (isVisible && fitAddonRef.current && xtermInstance.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          xtermInstance.current?.focus();
        } catch {
          // Ignore
        }
      }, 50);
    }
  }, [isVisible]);

  const hasUnreadError = isVisible && activeSession?.id === sessionId && Boolean(activeSession.unreadError);

  return (
    <div
      className={`relative w-full h-full flex flex-col bg-[#0d1117] ${
        isVisible ? 'block' : 'hidden'
      }`}
    >
      <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden" />

      {/* Floating Error Bubble (PRD 3.1) */}
      {hasUnreadError && (
        <div
          onClick={() => toggleAgent(true)}
          className="absolute bottom-6 right-6 z-40 bg-orca-card/95 hover:bg-orca-card border-2 border-orca-danger rounded-lg px-3.5 py-2 shadow-2xl flex items-center space-x-2.5 cursor-pointer backdrop-blur-md error-bubble-anim transition-all hover:scale-105 group"
          title="点击或敲击 [Ctrl + \] 展开 AI 助手排查"
        >
          <div className="w-6 h-6 rounded-full bg-orca-danger/20 flex items-center justify-center text-orca-danger shrink-0">
            <Zap size={14} className="fill-orca-danger animate-bounce" />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center space-x-1.5 text-xs font-bold text-orca-danger">
              <span>⚡ 报错排查</span>
              <kbd className="px-1.5 py-0.2 bg-orca-bg text-white rounded text-[10px] border border-orca-border font-mono">
                Ctrl + \
              </kbd>
            </div>
            <span className="text-[10px] text-orca-muted truncate max-w-[200px]">
              {activeSession?.unreadError}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
