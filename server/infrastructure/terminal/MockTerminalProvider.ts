import { toError } from '../../../shared/errors';
import type { MockSessionEntry } from '../../ws/types';
import type {
  TerminalCreateOptions,
  TerminalDataListener,
  TerminalErrorListener,
  TerminalExitListener,
  TerminalHandle,
  TerminalProvider,
  Unsubscribe
} from '../../domain/terminal/types';

/**
 * TerminalProvider backed by MockTerminalSession (in-memory sandbox).
 * Preserves lazy creation and cross-connection sharing semantics (P1-4)
 * while ensuring listeners are bound at most once per sessionId (P0-C).
 */
export class MockTerminalProvider implements TerminalProvider {
  public readonly type = 'mock' as const;

  private readonly dataListeners = new Set<TerminalDataListener>();
  private readonly exitListeners = new Set<TerminalExitListener>();
  private readonly errorListeners = new Set<TerminalErrorListener>();
  private readonly boundSessions = new Map<string, () => void>();

  constructor(
    private readonly mockSessions: Map<string, MockSessionEntry>,
    private readonly createMockSession: (sessionId: string) => MockSessionEntry
  ) {}

  public async create(options: TerminalCreateOptions): Promise<TerminalHandle> {
    const { sessionId, cols, rows } = options;
    let entry = this.mockSessions.get(sessionId);
    const isNew = !entry;

    if (!entry) {
      entry = this.createMockSession(sessionId);
      this.mockSessions.set(sessionId, entry);
    }

    this.bindSessionEventsOnce(sessionId, entry.term);

    if (isNew) {
      entry.term.init();
    }

    if (cols > 0 && rows > 0) {
      entry.term.resize(cols, rows);
    }

    return {
      id: sessionId,
      initialCwd: entry.term.getCurrentDir(),
      shellCommand: '/bin/bash'
    };
  }

  private bindSessionEventsOnce(
    sessionId: string,
    term: {
      on: (event: string, listener: (...args: unknown[]) => void) => unknown;
      off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    }
  ): void {
    if (this.boundSessions.has(sessionId)) {
      return;
    }

    const onData = (data: unknown) => {
      const text = typeof data === 'string' ? data : String(data ?? '');
      for (const listener of this.dataListeners) {
        listener(sessionId, text);
      }
    };

    const onExit = (code?: unknown) => {
      const exitCode = typeof code === 'number' ? code : undefined;
      this.unbindSessionEvents(sessionId);
      for (const listener of this.exitListeners) {
        listener(sessionId, exitCode);
      }
    };

    const onError = (err: unknown) => {
      const error = toError(err);
      for (const listener of this.errorListeners) {
        listener(sessionId, error);
      }
    };

    term.on('data', onData);
    term.on('exit', onExit);
    term.on('error', onError);

    this.boundSessions.set(sessionId, () => {
      const remove = term.off?.bind(term) ?? term.removeListener?.bind(term);
      if (remove) {
        remove('data', onData);
        remove('exit', onExit);
        remove('error', onError);
      }
    });
  }

  private unbindSessionEvents(sessionId: string): void {
    const cleanup = this.boundSessions.get(sessionId);
    if (cleanup) {
      this.boundSessions.delete(sessionId);
      cleanup();
    }
  }

  public write(id: string, data: string): boolean {
    const entry = this.mockSessions.get(id);
    if (!entry) {
      return false;
    }
    entry.term.write(data);
    return true;
  }

  public resize(id: string, cols: number, rows: number): void {
    const entry = this.mockSessions.get(id);
    if (!entry) {
      return;
    }
    entry.term.resize(cols, rows);
  }

  public async kill(id: string, _signal?: string): Promise<void> {
    this.unbindSessionEvents(id);
    this.mockSessions.delete(id);
  }

  public onData(listener: TerminalDataListener): Unsubscribe {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  public onExit(listener: TerminalExitListener): Unsubscribe {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  public onError(listener: TerminalErrorListener): Unsubscribe {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }
}
