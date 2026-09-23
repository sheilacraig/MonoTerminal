/**
 * Per-session terminal authentication state machine.
 *
 * Why this exists
 * ---------------
 * Two problems are solved here:
 *
 * 1. **There is nowhere to type a password.** The terminal is a canvas; when
 *    `sudo`/`su`/`ssh` asks for a password the user has no obvious input box
 *    (and the typed characters are not echoed by design, which looks broken).
 *    This store watches the output stream, recognises the prompt, and exposes a
 *    state for a masked input bar.
 *
 * 2. **Automation swallows the prompt.** `commandCleaner` joins compound blocks
 *    (heredocs, multi-line scripts) with `\r` and the whole block is written to
 *    the pty in one go. If such a block needs `sudo`, the prompt appears and the
 *    very next line of the script is consumed as the password — three failed
 *    attempts later nothing has run. So for multi-line elevated blocks we first
 *    run `sudo -v` on its own (clean prompt, nothing queued behind it), let the
 *    user authenticate, and only then send the real block — by which time the
 *    sudo timestamp is cached and the block runs without prompting.
 */

import {
  detectAuthFailure,
  detectAuthPrompt,
  type AuthPromptMatch
} from '../utils/authPrompt';

export type AuthPhase = 'collect' | 'verifying' | 'error';

export type AuthOrigin = 'detected' | 'manual' | 'elevation';

/** What happens to the parked block once authentication succeeds. */
export type AuthPendingAction = 'run' | 'fill';

export interface TerminalAuthState {
  visible: boolean;
  sessionId: string | null;
  label: string;
  hint: string;
  requiresPassword: boolean;
  phase: AuthPhase;
  error: string | null;
  /** Compound block waiting for successful elevation. */
  pendingBlock: string | null;
  pendingAction: AuthPendingAction;
  origin: AuthOrigin;
}

const EMPTY_STATE: TerminalAuthState = {
  visible: false,
  sessionId: null,
  label: '',
  hint: '',
  requiresPassword: true,
  phase: 'collect',
  error: null,
  pendingBlock: null,
  pendingAction: 'run',
  origin: 'manual'
};

/** How much recent output is kept for prompt matching. */
const TAIL_LIMIT = 1200;
/** Wait for a verdict after the password has been written to the pty. */
const VERIFY_TIMEOUT_MS = 1500;
/** `sudo -v` with cached credentials prints nothing — proceed after this delay. */
const NO_PROMPT_TIMEOUT_MS = 2600;

export type TerminalInputSender = (sessionId: string, data: string) => void;

/**
 * Last-resort writer used when no terminal view has bound itself yet (e.g. the
 * user hits “run” while the pane is still mounting). Registered once by the
 * provider that owns the websocket.
 */
let fallbackSender: TerminalInputSender | null = null;

export function setFallbackTerminalSender(sender: TerminalInputSender | null): void {
  fallbackSender = sender;
}

export class TerminalAuthStore {
  private state: TerminalAuthState = { ...EMPTY_STATE };
  private listeners = new Set<() => void>();
  private sender: TerminalInputSender | null = null;
  private onFlush: (() => void) | null = null;
  private tail = '';
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;
  private noPromptTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sessionId: string) {}

  // ---------------------------------------------------------------- plumbing

  public getSnapshot = (): TerminalAuthState => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** TerminalView supplies the writer; AgentChatContext uses the same channel. */
  public bindSender(sender: TerminalInputSender | null): void {
    this.sender = sender;
  }

  /** Called after a pending block is flushed (used to refocus the terminal). */
  public bindOnFlush(handler: (() => void) | null): void {
    this.onFlush = handler;
  }

  private patch(next: Partial<TerminalAuthState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }

  private clearTimers(): void {
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
    if (this.noPromptTimer) {
      clearTimeout(this.noPromptTimer);
      this.noPromptTimer = null;
    }
  }

  private write(data: string): void {
    const sender = this.sender ?? fallbackSender;
    sender?.(this.sessionId, data);
  }

  // ----------------------------------------------------------- output intake

  /** Feed a chunk of terminal output; drives prompt + failure detection. */
  public noteOutput(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-TAIL_LIMIT);
    if (!this.tail) return;

    // 1) A failure while we are waiting for (or verifying) a password must stop
    //    every pending timer — otherwise the parked block would run anyway, or
    //    a rejected password would be silently treated as accepted.
    if (this.state.visible && this.state.phase !== 'error') {
      const failure = detectAuthFailure(chunk);
      if (failure) {
        this.clearTimers();
        // `sudo` re-asks after a bad password: keep the reason on screen but
        // leave the input usable so the user can simply retry.
        const askingAgain = Boolean(detectAuthPrompt(this.tail));
        this.patch({ phase: askingAgain ? 'collect' : 'error', error: failure });
        return;
      }
    }

    const prompt = detectAuthPrompt(this.tail);
    if (!prompt) return;

    // A prompt answered by our own pre-flight clears the "no prompt" fallback.
    if (this.noPromptTimer) {
      clearTimeout(this.noPromptTimer);
      this.noPromptTimer = null;
    }

    if (!this.state.visible) {
      this.open(prompt, 'detected');
    } else if (this.state.phase === 'error') {
      // The remote side asked again after a failed attempt — let the user retry.
      this.patch({ phase: 'collect', error: null });
    }
  }

  private open(
    prompt: AuthPromptMatch,
    origin: AuthOrigin,
    pendingBlock?: string,
    pendingAction: AuthPendingAction = 'run'
  ): void {
    this.patch({
      visible: true,
      sessionId: this.sessionId,
      label: prompt.label,
      hint: prompt.hint,
      requiresPassword: prompt.requiresPassword,
      phase: 'collect',
      error: null,
      pendingBlock: pendingBlock ?? null,
      pendingAction,
      origin
    });
  }

  // ------------------------------------------------------------- entrypoints

  /** The 🔑 button: always gives the user a place to type a secret. */
  public openManual(kind: AuthPromptMatch = {
    kind: 'sudo',
    label: '手动输入敏感内容',
    requiresPassword: true,
    hint: '内容不会回显，也不会写入日志；输入后按 Enter 发送'
  }): void {
    this.clearTimers();
    this.open(kind, 'manual');
  }

  /**
   * Multi-line block that needs elevation: authenticate first, then hand over
   * the block untouched so heredocs and scripts arrive intact.
   *
   * `action` mirrors the button the user pressed in the AI panel — `run` sends
   * the block with a trailing newline, `fill` parks it on the command line for
   * review without submitting it.
   */
  public beginElevation(block: string, action: AuthPendingAction = 'run'): void {
    this.clearTimers();
    this.open(
      {
        kind: 'sudo',
        label: '该命令需要 sudo 提权',
        requiresPassword: true,
        hint:
          action === 'run'
            ? '先验证密码，通过后会自动执行剩余命令；密码不会回显'
            : '先验证密码，通过后命令会填入终端命令行供你确认（不自动回车）'
      },
      'elevation',
      block,
      action
    );

    this.write('sudo -v\r');

    // Already-validated credentials (or NOPASSWD) produce no prompt at all.
    this.noPromptTimer = setTimeout(() => {
      this.noPromptTimer = null;
      if (this.state.origin === 'elevation' && this.state.phase === 'collect') {
        this.flushPending();
      }
    }, NO_PROMPT_TIMEOUT_MS);
  }

  // ------------------------------------------------------------------ actions

  /** Send the collected input to the pty and start watching for a verdict. */
  public submit(value: string): void {
    if (!this.state.visible || !value) return;

    this.write(`${value}\r`);
    this.clearTimers();

    if (!this.state.pendingBlock && this.state.origin === 'manual') {
      // Nothing to resume — just close the bar and let the terminal take over.
      this.patch({ phase: 'verifying', error: null });
      this.verifyTimer = setTimeout(() => this.reset(), VERIFY_TIMEOUT_MS);
      return;
    }

    this.patch({ phase: 'verifying', error: null });
    this.verifyTimer = setTimeout(() => {
      this.verifyTimer = null;
      this.flushPending();
    }, VERIFY_TIMEOUT_MS);
  }

  /** Dismiss the bar. A pending elevated block is dropped, never executed. */
  public cancel(): void {
    this.clearTimers();
    this.reset();
  }

  /** Escape hatch for sessions where the block no longer needs a password. */
  public forceFlush(): void {
    this.clearTimers();
    this.flushPending();
  }

  private flushPending(): void {
    const block = this.state.pendingBlock;
    const action = this.state.pendingAction;
    this.reset();
    if (!block) return;
    // `fill` deliberately omits the newline so the user reviews before running.
    this.write(action === 'fill' ? block : `${block}\r`);
    this.onFlush?.();
  }

  private reset(): void {
    this.patch({ ...EMPTY_STATE });
  }
}

const registry = new Map<string, TerminalAuthStore>();

/** One store per terminal session, so tabs never cross-talk. */
export function getAuthStore(sessionId: string): TerminalAuthStore {
  let store = registry.get(sessionId);
  if (!store) {
    store = new TerminalAuthStore(sessionId);
    registry.set(sessionId, store);
  }
  return store;
}

export function disposeAuthStore(sessionId: string): void {
  registry.get(sessionId)?.cancel();
  registry.delete(sessionId);
}
