import type { HostAsset } from '../../storage';
import type {
  CreateSessionRequest,
  HostRef,
  Session,
  SessionManager,
  SessionOutboundSender,
  SessionType
} from '../../domain/session/types';
import type { TerminalProvider, Unsubscribe } from '../../domain/terminal/types';
import type { FileSystemProvider } from '../../domain/filesystem/types';

export interface SessionLifecycleHooks {
  onSessionConnected?: (session: Session) => void;
  onSessionDisconnected?: (session: Session, reason: 'detached' | 'closed') => void;
  onTerminalData?: (sessionId: string, data: string) => void;
  onTerminalExit?: (sessionId: string, exitCode?: number) => void;
}

export interface DefaultSessionManagerOptions {
  terminalProviders: Record<SessionType, TerminalProvider>;
  fileSystemProviders: Record<SessionType, FileSystemProvider>;
  /**
   * Grace period (in ms) before a detached session (0 attached connections)
   * is garbage-collected and closed. Default: 10 minutes (600_000 ms).
   * Set to 0 to close immediately upon detach.
   */
  detachGracePeriodMs?: number;
  hooks?: SessionLifecycleHooks;
}

export function resolveSessionType(authType: HostAsset['authType']): SessionType {
  if (authType === 'local') return 'local';
  if (authType === 'mock') return 'mock';
  return 'ssh';
}

function toHostRef(host: HostAsset): HostRef {
  return {
    id: host.id,
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    authType: host.authType,
    initialDir: host.initialDir
  };
}

export class DefaultSessionManager implements SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly connectionSenders = new Map<string, Map<string, SessionOutboundSender>>();
  private readonly detachTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly providerUnsubs: Unsubscribe[] = [];
  private readonly terminalProviders: Record<SessionType, TerminalProvider>;
  private readonly fileSystemProviders: Record<SessionType, FileSystemProvider>;
  private readonly detachGracePeriodMs: number;
  private readonly hooks?: SessionLifecycleHooks;

  constructor(options: DefaultSessionManagerOptions) {
    this.terminalProviders = options.terminalProviders;
    this.fileSystemProviders = options.fileSystemProviders;
    this.detachGracePeriodMs = options.detachGracePeriodMs ?? 10 * 60 * 1000;
    this.hooks = options.hooks;

    // Register a single set of listeners per TerminalProvider singleton (P0-C).
    const types: SessionType[] = ['local', 'ssh', 'mock'];
    for (const type of types) {
      const provider = this.terminalProviders[type];
      if (!provider) continue;

      this.providerUnsubs.push(
        provider.onData((sessionId, data) => {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.lastActiveAt = Date.now();
          }
          this.hooks?.onTerminalData?.(sessionId, data);
          this.broadcastToSession(sessionId, { type: 'term:data', sessionId, data });
        }),
        provider.onExit((sessionId, exitCode) => {
          this.hooks?.onTerminalExit?.(sessionId, exitCode);
          this.broadcastToSession(sessionId, { type: 'term:close', sessionId });
          const session = this.sessions.get(sessionId);
          this.clearDetachTimer(sessionId);
          this.connectionSenders.delete(sessionId);
          if (session) {
            session.status = 'closed';
            session.attachedConnections.clear();
            this.sessions.delete(sessionId);
            this.hooks?.onSessionDisconnected?.(session, 'closed');
          }
        }),
        provider.onError((sessionId, error) => {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.status = 'error';
          }
          this.broadcastToSession(sessionId, {
            type: 'term:error',
            sessionId,
            message: error.message
          });
        })
      );
    }
  }

  private broadcastToSession(
    sessionId: string,
    msg: Parameters<SessionOutboundSender>[0]
  ): void {
    const senders = this.connectionSenders.get(sessionId);
    if (!senders) return;
    for (const send of senders.values()) {
      send(msg);
    }
  }

  private clearDetachTimer(sessionId: string): void {
    const timer = this.detachTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.detachTimers.delete(sessionId);
    }
  }

  public async create(request: CreateSessionRequest): Promise<Session> {
    const { id, host, cols, rows, credentials } = request;
    const existing = this.sessions.get(id);
    if (existing && existing.status !== 'closed') {
      await this.close(id);
    }

    const type = resolveSessionType(host.authType);
    const provider = this.terminalProviders[type];
    if (!provider) {
      throw new Error(`不支持的会话类型: ${type}`);
    }

    const now = Date.now();
    const initialDir = host.initialDir || (type === 'local' ? '~' : '/root');

    const session: Session = {
      id,
      type,
      status: 'creating',
      host: toHostRef(host),
      terminal: {
        id,
        providerType: type,
        cols,
        rows,
        cwd: initialDir
      },
      filesystem: {
        id,
        providerType: type,
        rootPath: initialDir,
        ready: false
      },
      attachedConnections: new Set<string>(),
      createdAt: now,
      lastActiveAt: now
    };

    this.sessions.set(id, session);

    try {
      const handle = await provider.create({
        sessionId: id,
        host,
        cols,
        rows,
        cwd: host.initialDir,
        credentials
      });

      session.status = 'active';
      session.terminal.cwd = handle.initialCwd;
      session.terminal.shell = handle.shellCommand;
      session.filesystem.rootPath = handle.initialCwd;
      session.filesystem.ready = true;
      session.lastActiveAt = Date.now();

      this.hooks?.onSessionConnected?.(session);
      return session;
    } catch (err) {
      this.sessions.delete(id);
      this.connectionSenders.delete(id);
      throw err;
    }
  }

  public async getOrCreate(request: CreateSessionRequest): Promise<Session> {
    const existing = this.sessions.get(request.id);
    if (existing && (existing.status === 'active' || existing.status === 'detached')) {
      this.clearDetachTimer(request.id);
      existing.status = 'active';
      existing.lastActiveAt = Date.now();
      if (request.cols > 0 && request.rows > 0) {
        this.resizeTerminal(request.id, request.cols, request.rows);
      }
      return existing;
    }
    return this.create(request);
  }

  public get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.status === 'closed') {
      return undefined;
    }
    return session;
  }

  public attach(id: string, connectionId: string, send?: SessionOutboundSender): void {
    const session = this.sessions.get(id);
    if (!session || session.status === 'closed') {
      return;
    }

    this.clearDetachTimer(id);
    session.attachedConnections.add(connectionId);
    session.status = 'active';
    session.lastActiveAt = Date.now();

    if (send) {
      let senders = this.connectionSenders.get(id);
      if (!senders) {
        senders = new Map<string, SessionOutboundSender>();
        this.connectionSenders.set(id, senders);
      }
      // Overwrite any prior sender for the same connectionId so re-attaching never duplicates
      senders.set(connectionId, send);
    }
  }

  public detach(id: string, connectionId: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }

    session.attachedConnections.delete(connectionId);
    const senders = this.connectionSenders.get(id);
    if (senders) {
      senders.delete(connectionId);
      if (senders.size === 0) {
        this.connectionSenders.delete(id);
      }
    }

    if (session.attachedConnections.size === 0 && session.status !== 'closed') {
      session.status = 'detached';
      session.lastActiveAt = Date.now();
      this.hooks?.onSessionDisconnected?.(session, 'detached');

      this.clearDetachTimer(id);
      if (this.detachGracePeriodMs <= 0) {
        void this.close(id);
      } else {
        const timer = setTimeout(() => {
          this.detachTimers.delete(id);
          const current = this.sessions.get(id);
          if (current && current.status === 'detached' && current.attachedConnections.size === 0) {
            void this.close(id);
          }
        }, this.detachGracePeriodMs);
        timer.unref?.();
        this.detachTimers.set(id, timer);
      }
    }
  }

  public async close(id: string): Promise<void> {
    this.clearDetachTimer(id);
    const session = this.sessions.get(id);
    this.connectionSenders.delete(id);

    if (!session) {
      return;
    }

    session.status = 'closed';
    session.attachedConnections.clear();
    this.sessions.delete(id);

    const provider = this.terminalProviders[session.type];
    if (provider) {
      await provider.kill(id);
    }
    this.hooks?.onSessionDisconnected?.(session, 'closed');
  }

  public list(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.status !== 'closed');
  }

  public writeTerminal(id: string, data: string): boolean {
    const session = this.get(id);
    if (!session || session.status === 'error') {
      return false;
    }
    session.lastActiveAt = Date.now();
    const provider = this.terminalProviders[session.type];
    return provider ? provider.write(id, data) : false;
  }

  public resizeTerminal(id: string, cols: number, rows: number): boolean {
    const session = this.get(id);
    if (!session || session.status === 'error') {
      return false;
    }
    session.terminal.cols = cols;
    session.terminal.rows = rows;
    session.lastActiveAt = Date.now();
    const provider = this.terminalProviders[session.type];
    if (!provider) {
      return false;
    }
    provider.resize(id, cols, rows);
    return true;
  }

  public updateCwd(id: string, cwd: string): void {
    const session = this.get(id);
    if (session && cwd) {
      session.terminal.cwd = cwd;
      session.lastActiveAt = Date.now();
    }
  }

  public getFileSystemProvider(sessionId: string): {
    session: Session;
    provider: FileSystemProvider;
  } {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在或已关闭 (sessionId: "${sessionId}")`);
    }
    const provider = this.fileSystemProviders[session.type];
    if (!provider) {
      throw new Error(`不支持的文件系统会话类型: ${session.type}`);
    }
    return { session, provider };
  }

  public dispose(): void {
    for (const id of this.detachTimers.keys()) {
      this.clearDetachTimer(id);
    }
    for (const unsub of this.providerUnsubs) {
      unsub();
    }
    this.providerUnsubs.length = 0;
  }
}
