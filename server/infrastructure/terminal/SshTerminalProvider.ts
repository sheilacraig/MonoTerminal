import { toError } from '../../../shared/errors';
import type { SshManager } from '../../sshManager';
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
 * TerminalProvider backed by SshManager (ssh2).
 * Forwards `data`, `close` (as exit), and `error` events with single-bind
 * lifecycle cleanup per sessionId.
 */
export class SshTerminalProvider implements TerminalProvider {
  public readonly type = 'ssh' as const;

  private readonly dataListeners = new Set<TerminalDataListener>();
  private readonly exitListeners = new Set<TerminalExitListener>();
  private readonly errorListeners = new Set<TerminalErrorListener>();
  private readonly boundSessions = new Map<string, () => void>();

  constructor(private readonly sshManager: SshManager) {}

  public async create(options: TerminalCreateOptions): Promise<TerminalHandle> {
    const { sessionId, host, cols, rows, cwd, credentials } = options;

    // Clean up any previous listener bindings for this sessionId before re-creating
    this.unbindSessionEvents(sessionId);

    const sshSession = await this.sshManager.createSession(
      sessionId,
      host,
      credentials?.password,
      credentials?.passphrase,
      credentials?.privateKey
    );

    if (cols > 0 && rows > 0) {
      this.sshManager.resize(sessionId, cols, rows);
    }

    this.bindSessionEventsOnce(sessionId, sshSession.events);

    return {
      id: sessionId,
      initialCwd: cwd || host.initialDir || '/root'
    };
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

    const onClose = () => {
      this.unbindSessionEvents(sessionId);
      for (const listener of this.exitListeners) {
        listener(sessionId);
      }
    };

    const onError = (err: unknown) => {
      const error = toError(err);
      for (const listener of this.errorListeners) {
        listener(sessionId, error);
      }
    };

    events.on('data', onData);
    events.on('close', onClose);
    events.on('error', onError);

    this.boundSessions.set(sessionId, () => {
      const remove = events.off?.bind(events) ?? events.removeListener?.bind(events);
      if (remove) {
        remove('data', onData);
        remove('close', onClose);
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
    return this.sshManager.writeToShell(id, data);
  }

  public resize(id: string, cols: number, rows: number): void {
    this.sshManager.resize(id, cols, rows);
  }

  public async kill(id: string, _signal?: string): Promise<void> {
    this.unbindSessionEvents(id);
    this.sshManager.closeSession(id);
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
