import { toError } from '../../../shared/errors';
import type { LocalPtyManagerApi } from '../../localPtyManager';
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
 * TerminalProvider backed by LocalPtyManager (node-pty).
 * Singleton per SessionType ('local'); binds onto each underlying LocalPtySession
 * at most once so re-attaching a session never accumulates duplicate EventEmitter listeners.
 */
export class LocalTerminalProvider implements TerminalProvider {
  public readonly type = 'local' as const;

  private readonly dataListeners = new Set<TerminalDataListener>();
  private readonly exitListeners = new Set<TerminalExitListener>();
  private readonly errorListeners = new Set<TerminalErrorListener>();
  private readonly boundSessions = new Map<string, () => void>();

  constructor(private readonly ptyManager: LocalPtyManagerApi) {}

  public async create(options: TerminalCreateOptions): Promise<TerminalHandle> {
    const { sessionId, cols, rows, cwd, host } = options;
    try {
      const ptySession = this.ptyManager.createSession(
        sessionId,
        cols,
        rows,
        cwd ?? host.initialDir
      );

      this.bindSessionEventsOnce(sessionId, ptySession.events);

      return {
        id: sessionId,
        initialCwd: ptySession.initialCwd,
        shellCommand: ptySession.shellCommand
      };
    } catch (err) {
      const error = toError(err);
      this.emitError(sessionId, error);
      throw error;
    }
  }

  private bindSessionEventsOnce(
    sessionId: string,
    events: {
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
      this.emitError(sessionId, toError(err));
    };

    events.on('data', onData);
    events.on('exit', onExit);
    events.on('error', onError);

    this.boundSessions.set(sessionId, () => {
      const remove = events.off?.bind(events) ?? events.removeListener?.bind(events);
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

  private emitError(sessionId: string, error: Error): void {
    for (const listener of this.errorListeners) {
      listener(sessionId, error);
    }
  }

  public write(id: string, data: string): boolean {
    if (!this.ptyManager.has(id)) {
      return false;
    }
    this.ptyManager.write(id, data);
    return true;
  }

  public resize(id: string, cols: number, rows: number): void {
    if (!this.ptyManager.has(id)) {
      return;
    }
    this.ptyManager.resize(id, cols, rows);
  }

  public async kill(id: string, _signal?: string): Promise<void> {
    this.unbindSessionEvents(id);
    this.ptyManager.closeSession(id);
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
