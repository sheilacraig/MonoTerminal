import fs from 'fs';
import path from 'path';
import type { AgentPlan } from '../../agent/planner/Plan';
import type { AgentRuntime } from '../../agent/runtime/AgentRuntime';
import type { CommandRecord } from '../../domain/command/types';
import type { HostRef, SessionStatus, SessionType } from '../../domain/session/types';
import type { CommandEngine } from '../command/CommandEngine';
import type { ContextEngine } from '../context/ContextEngine';
import type { DefaultSessionManager } from './DefaultSessionManager';

/**
 * Lightweight persisted session snapshot (Phase 13 / P1-4).
 * Deliberately excludes terminal scrollback buffers and native PTY/SSH handles.
 */
export interface SessionSnapshot {
  sessionId: string;
  type: SessionType;
  status: SessionStatus;
  host: HostRef;
  cwd: string;
  openFiles: string[];
  selectedFile?: string;
  recentCommands: CommandRecord[];
  activePlan?: AgentPlan;
  savedAt: number;
}

export interface SessionStoreOptions {
  filePath?: string;
  maxCommandsPerSession?: number;
}

export class SessionStore {
  private readonly snapshots = new Map<string, SessionSnapshot>();
  private readonly filePath?: string;
  private readonly maxCommandsPerSession: number;

  constructor(options?: SessionStoreOptions) {
    this.filePath = options?.filePath;
    this.maxCommandsPerSession = options?.maxCommandsPerSession ?? 30;
    if (this.filePath) {
      this.loadFromDisk();
    }
  }

  public saveSnapshot(snapshot: SessionSnapshot): void {
    const trimmedCommands = snapshot.recentCommands
      .slice(-this.maxCommandsPerSession)
      .map(c => ({
        ...c,
        // Cap persisted stdout/stderr per command to keep snapshots compact
        stdout: c.stdout.slice(-4000),
        stderr: c.stderr.slice(-4000)
      }));

    const clean: SessionSnapshot = {
      ...snapshot,
      recentCommands: trimmedCommands,
      savedAt: Date.now()
    };

    this.snapshots.set(snapshot.sessionId, clean);
    this.flushToDisk();
  }

  public captureFromEngines(
    sessionId: string,
    deps: {
      sessionManager: DefaultSessionManager;
      commandEngine?: CommandEngine;
      contextEngine?: ContextEngine;
      agentRuntime?: AgentRuntime;
    }
  ): SessionSnapshot | undefined {
    const session = deps.sessionManager.get(sessionId);
    if (!session) return undefined;

    const fileCtx = deps.contextEngine?.getFileContext(sessionId);
    const recentCommands = deps.commandEngine?.recent(sessionId, this.maxCommandsPerSession) ?? [];
    const activePlan = deps.agentRuntime?.getActivePlan(sessionId);
    const cwd = deps.commandEngine?.getCwd(sessionId) || session.terminal.cwd;

    const snapshot: SessionSnapshot = {
      sessionId: session.id,
      type: session.type,
      status: session.status,
      host: { ...session.host },
      cwd,
      openFiles: fileCtx?.openFiles ?? [],
      selectedFile: fileCtx?.selectedFile,
      recentCommands,
      activePlan,
      savedAt: Date.now()
    };

    this.saveSnapshot(snapshot);
    return snapshot;
  }

  public restoreIntoEngines(
    sessionId: string,
    deps: {
      sessionManager?: DefaultSessionManager;
      commandEngine?: CommandEngine;
      contextEngine?: ContextEngine;
      agentRuntime?: AgentRuntime;
    }
  ): SessionSnapshot | undefined {
    const snapshot = this.snapshots.get(sessionId);
    if (!snapshot) return undefined;

    deps.sessionManager?.updateCwd(sessionId, snapshot.cwd);
    deps.commandEngine?.restoreHistory(sessionId, snapshot.recentCommands, snapshot.cwd);
    if (snapshot.selectedFile) {
      deps.contextEngine?.setSelection(sessionId, snapshot.selectedFile);
    }
    if (snapshot.activePlan) {
      deps.agentRuntime?.restoreSessionPlan(sessionId, snapshot.activePlan);
    }

    return snapshot;
  }

  public getSnapshot(sessionId: string): SessionSnapshot | undefined {
    return this.snapshots.get(sessionId);
  }

  public listSnapshots(): SessionSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  public deleteSnapshot(sessionId: string): boolean {
    const existed = this.snapshots.delete(sessionId);
    if (existed) {
      this.flushToDisk();
    }
    return existed;
  }

  private loadFromDisk(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof (item as SessionSnapshot).sessionId === 'string') {
            this.snapshots.set((item as SessionSnapshot).sessionId, item as SessionSnapshot);
          }
        }
      }
    } catch {
      // Ignore corrupted snapshot store on startup
    }
  }

  private flushToDisk(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.snapshots.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');
    } catch {
      // Ignore disk write errors in read-only environments
    }
  }
}
