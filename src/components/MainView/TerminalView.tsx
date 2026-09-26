import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useWebSocket } from '../../context/WebSocketContext';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { SHORTCUTS, matchesShortcut } from '../../constants/shortcuts';
import { checkCommandSafety } from '../../utils/guardrail';
import { readClipboardText, writeClipboardText, COPY_SCOPE_ATTR } from '../../utils/clipboard';
import { getAuthStore } from '../../services/terminalAuth';
import { shellIntegrationTracker } from '../../utils/shellIntegration';
import { TerminalAuthBar } from './TerminalAuthBar';
import { Zap } from 'lucide-react';

interface TerminalViewProps {
  sessionId: string;
  isVisible: boolean;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ sessionId, isVisible }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const {
    send,
    sendTermInput,
    resizeTerm,
    registerTermHandler,
    registerTermReadyHandler,
    registerTermErrorHandler
  } = useWebSocket();
  const {
    activeSession,
    appendTerminalContext,
    toggleAgent,
    setIsSidebarCollapsed,
    setIsHostModalOpen,
    closeSession,
    updateSessionStatus,
    updateSessionTermSize,
    updateSessionCwd,
    updateSessionFailedCommand,
    executeCommandWithGuardrail
  } = useSession();
  const { settings } = useSettings();

  const [pasteHint, setPasteHint] = useState<string | null>(null);

  // Transient feedback for the (rare) case where the clipboard read is blocked.
  useEffect(() => {
    if (!pasteHint) return undefined;
    const timer = setTimeout(() => setPasteHint(null), 3000);
    return () => clearTimeout(timer);
  }, [pasteHint]);

  // Ref-mirror every value the xterm init effect reads. Keeping the effect
  // keyed on [sessionId] alone is critical: `toggleAgent` and `closeSession`
  // change identity whenever `activeSessionId` changes (they depend on it via
  // useCallback), and `settings.terminal.*` changes when the user tweaks font
  // size etc. Without this indirection, tab-switching or a settings tweak
  // would tear down xterm and lose the scrollback buffer.
  const ctxRef = useRef({
    settings,
    send,
    sendTermInput,
    resizeTerm,
    registerTermHandler,
    registerTermReadyHandler,
    registerTermErrorHandler,
    appendTerminalContext,
    toggleAgent,
    setIsSidebarCollapsed,
    setIsHostModalOpen,
    closeSession,
    updateSessionStatus,
    updateSessionTermSize,
    updateSessionCwd,
    updateSessionFailedCommand,
    executeCommandWithGuardrail
  });
  ctxRef.current = {
    settings,
    send,
    sendTermInput,
    resizeTerm,
    registerTermHandler,
    registerTermReadyHandler,
    registerTermErrorHandler,
    appendTerminalContext,
    toggleAgent,
    setIsSidebarCollapsed,
    setIsHostModalOpen,
    closeSession,
    updateSessionStatus,
    updateSessionTermSize,
    updateSessionCwd,
    updateSessionFailedCommand,
    executeCommandWithGuardrail
  };

  /**
   * Write text into the pty using xterm's own paste path so bracketed-paste
   * mode is honoured (a multi-line paste then lands as a single edit instead of
   * executing line by line). Dangerous payloads still go through the guardrail.
   */
  const pasteIntoTerminal = useCallback(
    (text: string) => {
      const term = xtermInstance.current;
      if (!term || !text) return;
      term.focus();

      if (
        settings.guardrail?.enabled !== false &&
        checkCommandSafety(text).isDangerous
      ) {
        executeCommandWithGuardrail(text, () => term.paste(text));
        return;
      }
      term.paste(text);
    },
    [executeCommandWithGuardrail, settings.guardrail]
  );

  const requestPaste = useCallback(() => {
    void readClipboardText().then(text => {
      if (text === null) {
        // Clipboard read refused (browser permission). Ctrl+V still works: it
        // goes through xterm's native paste listener instead.
        setPasteHint('无法读取剪贴板权限，请改用 Ctrl+V 粘贴');
        return;
      }
      if (!text) return;
      pasteIntoTerminal(text);
    });
  }, [pasteIntoTerminal]);

  const copyOnSelectEnabled = settings.terminal?.copyOnSelect !== false;
  const copyOnSelectRef = useRef(copyOnSelectEnabled);
  copyOnSelectRef.current = copyOnSelectEnabled;

  useEffect(() => {
    if (!terminalRef.current) return;
    const ctx = ctxRef.current;
    const auth = getAuthStore(sessionId);

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
      fontFamily: ctx.settings.terminal.fontFamily || '"JetBrains Mono", Consolas, monospace',
      fontSize: ctx.settings.terminal.fontSize || 14,
      cursorBlink: ctx.settings.terminal.cursorBlink ?? true,
      scrollback: ctx.settings.terminal.scrollback || 5000,
      convertEol: true,
      allowProposedApi: true,
      // Right-click is a paste gesture in this app (see onContextMenu below);
      // letting xterm also select a word on right-click would fight with it.
      rightClickSelectsWord: false
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();
    // Record the initial geometry so a backend restart before the first
    // ResizeObserver tick can still re-init the pty at the correct size.
    ctx.updateSessionTermSize(sessionId, term.cols, term.rows);

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    // Intercept custom shortcuts before xterm consumes or transmits them as control characters
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const c = ctxRef.current;
      const sc = c.settings?.shortcuts;
      const toggleModeKey = sc?.toggleMode || SHORTCUTS.TOGGLE_AGENT;
      const toggleSidebarKey = sc?.toggleSidebar || SHORTCUTS.TOGGLE_SIDEBAR;
      const newTabKey = sc?.newTab || SHORTCUTS.NEW_TAB;
      const closeTabKey = sc?.closeTab || SHORTCUTS.CLOSE_TAB;

      if (matchesShortcut(event, toggleModeKey)) {
        if (event.type === 'keydown') {
          c.toggleAgent();
        }
        return false; // Prevent xterm from sending control sequence (e.g. 0x1c SIGQUIT)
      }

      if (matchesShortcut(event, toggleSidebarKey)) {
        if (event.type === 'keydown') {
          c.setIsSidebarCollapsed((prev: boolean) => !prev);
        }
        return false;
      }

      if (matchesShortcut(event, newTabKey)) {
        if (event.type === 'keydown') {
          c.setIsHostModalOpen(true);
        }
        return false;
      }

      if (matchesShortcut(event, closeTabKey)) {
        if (event.type === 'keydown') {
          c.closeSession(sessionId);
        }
        return false;
      }

      // Ctrl+V / Ctrl+Shift+V paste. Returning false makes xterm skip its own
      // key handling — which would otherwise preventDefault and write ^V
      // (readline's quoted-insert) to the shell — so the browser performs its
      // default paste and xterm's own `paste` listener picks it up from
      // `clipboardData`. That path needs no clipboard permission at all.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v') {
        return false;
      }

      // Alt+P: manual entry for sensitive input (password / passphrase)
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'p') {
        if (event.type === 'keydown') {
          auth.openManual();
        }
        return false;
      }

      return true;
    });

    // Send input from user typing to server with guardrail check for pasted chunks
    const dataSub = term.onData(data => {
      const c = ctxRef.current;
      if (c.settings.guardrail?.enabled !== false) {
        let contentToCheck: string | null = null;
        if (data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')) {
          contentToCheck = data.slice(6, -6);
        } else if (data.length >= 5 || data.includes('\n') || data.includes('\r')) {
          contentToCheck = data;
        }

        if (contentToCheck && checkCommandSafety(contentToCheck).isDangerous) {
          c.executeCommandWithGuardrail(contentToCheck, () => {
            c.sendTermInput(sessionId, data);
          });
          return;
        }
      }

      c.sendTermInput(sessionId, data);
    });

    // Select to copy — only trigger on mouseup when the user finishes dragging,
    // avoiding high-frequency clipboard writes on every cursor move.
    const termContainer = terminalRef.current;
    const handleMouseUp = () => {
      if (!copyOnSelectRef.current) return;
      const selection = term.getSelection();
      if (!selection.trim()) return;
      void writeClipboardText(selection);
    };
    termContainer.addEventListener('mouseup', handleMouseUp);

    // Semantic Shell Integration: OSC 133 & OSC 7
    const osc133Sub = term.parser.registerOscHandler(133, data => {
      shellIntegrationTracker.handleOsc133(sessionId, data);
      return true;
    });

    const osc7Sub = term.parser.registerOscHandler(7, data => {
      shellIntegrationTracker.handleOsc7(sessionId, data);
      return true;
    });

    const unbindCmd = shellIntegrationTracker.onCommandFinished(sessionId, cmd => {
      let output = cmd.output.trim();
      if (!output && cmd.exitCode !== null && cmd.exitCode !== 0) {
        // Fallback to active terminal buffer lines if stream batching completed before noteOutput
        const buffer = term.buffer.active;
        const lines: string[] = [];
        const start = Math.max(0, buffer.cursorY - 20);
        for (let i = start; i <= buffer.cursorY; i++) {
          const line = buffer.getLine(i)?.translateToString(true);
          if (line) lines.push(line);
        }
        output = lines.join('\n');
      }

      if (cmd.exitCode !== null && cmd.exitCode !== 0) {
        const displayCmd = cmd.command ? ` \`${cmd.command}\`` : '';
        const snippet = `Exit ${cmd.exitCode}:${displayCmd} 执行失败`;

        ctxRef.current.updateSessionFailedCommand(
          sessionId,
          {
            command: cmd.command || undefined,
            exitCode: cmd.exitCode,
            output,
            cwd: cmd.cwd,
            timestamp: cmd.endTime || Date.now()
          },
          snippet
        );
      } else if (cmd.exitCode === 0) {
        ctxRef.current.updateSessionFailedCommand(sessionId, null, null);
      }

      // Report semantic command completion to backend CommandEngine (P0-2)
      ctxRef.current.send({
        type: 'term:cmd_event',
        sessionId,
        kind: 'finished',
        command: cmd.command || undefined,
        cwd: cmd.cwd,
        exitCode: cmd.exitCode ?? 0,
        output: output || undefined,
        timestamp: cmd.endTime || Date.now()
      });
    });

    const unbindCwd = shellIntegrationTracker.onCwdChanged(sessionId, newCwd => {
      ctxRef.current.updateSessionCwd(sessionId, newCwd);
      ctxRef.current.send({
        type: 'term:cmd_event',
        sessionId,
        kind: 'cwd',
        cwd: newCwd,
        timestamp: Date.now()
      });
    });

    // Receive data from server
    const unregisterData = ctx.registerTermHandler(sessionId, (data: string) => {
      term.write(data);
      ctxRef.current.appendTerminalContext(sessionId, data);
      shellIntegrationTracker.noteOutput(sessionId, data);
    });

    const unregisterReady = ctx.registerTermReadyHandler(sessionId, info => {
      ctxRef.current.updateSessionStatus(sessionId, 'connected');
      if (info.cwd) {
        ctxRef.current.updateSessionCwd(sessionId, info.cwd);
      }
    });

    // Watch the same stream for password prompts / failed attempts
    const unregisterAuth = ctx.registerTermHandler(sessionId, (data: string) => {
      auth.noteOutput(data);
    });

    const unregisterError = ctx.registerTermErrorHandler(sessionId, (err: string) => {
      ctxRef.current.updateSessionStatus(sessionId, 'disconnected');
      term.write(`\r\n\x1b[31m[错误] ${err}\x1b[0m\r\n`);
    });

    // The auth bar needs a way to write to the pty from outside this component
    auth.bindSender((sid, data) => ctxRef.current.sendTermInput(sid, data));
    auth.bindOnFlush(() => xtermInstance.current?.focus());

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (terminalRef.current && terminalRef.current.clientWidth > 0) {
        try {
          fitAddon.fit();
          ctxRef.current.resizeTerm(sessionId, term.cols, term.rows);
          ctxRef.current.updateSessionTermSize(sessionId, term.cols, term.rows);
        } catch {
          // Ignore fit errors during transitions
        }
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      osc133Sub.dispose();
      osc7Sub.dispose();
      unbindCmd();
      unbindCwd();
      dataSub.dispose();
      termContainer.removeEventListener('mouseup', handleMouseUp);
      unregisterData();
      unregisterReady();
      unregisterAuth();
      unregisterError();
      resizeObserver.disconnect();
      auth.bindSender(null);
      auth.bindOnFlush(null);
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

  // Dynamically apply terminal appearance settings without recreating terminal instance
  useEffect(() => {
    const term = xtermInstance.current;
    if (!term) return;
    if (settings.terminal.fontSize) {
      term.options.fontSize = settings.terminal.fontSize;
    }
    if (settings.terminal.fontFamily) {
      term.options.fontFamily = settings.terminal.fontFamily;
    }
    if (settings.terminal.cursorBlink !== undefined) {
      term.options.cursorBlink = settings.terminal.cursorBlink;
    }
    if (settings.terminal.scrollback) {
      term.options.scrollback = settings.terminal.scrollback;
    }
    try {
      fitAddonRef.current?.fit();
      if (terminalRef.current) {
        ctxRef.current.resizeTerm(sessionId, term.cols, term.rows);
        ctxRef.current.updateSessionTermSize(sessionId, term.cols, term.rows);
      }
    } catch {
      // Ignore fit errors
    }
  }, [settings.terminal, sessionId]);

  const rightClickPasteEnabled = settings.terminal?.rightClickPaste !== false;

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!rightClickPasteEnabled) return;
    event.preventDefault();
    requestPaste();
  };

  const hasUnreadError =
    isVisible && activeSession?.id === sessionId && Boolean(activeSession.unreadError);

  return (
    <div
      {...{ [COPY_SCOPE_ATTR]: 'terminal' }}
      className={`relative w-full h-full flex flex-col bg-[#0d1117] ${
        isVisible ? 'block' : 'hidden'
      }`}
      onContextMenu={handleContextMenu}
      onMouseDown={() => {
        // A right-click paste should land where the user is looking.
        xtermInstance.current?.focus();
      }}
    >
      <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden" />

      <TerminalAuthBar sessionId={sessionId} />

      {pasteHint && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-orca-card/95 border border-orca-border text-[11px] text-orca-text shadow-xl backdrop-blur-md pointer-events-none">
          {pasteHint}
        </div>
      )}

      {/* Floating Error Bubble (PRD 3.1) */}
      {hasUnreadError && (
        <div
          onClick={() => ctxRef.current.toggleAgent(true)}
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
