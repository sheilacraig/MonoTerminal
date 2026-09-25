import os from 'os';
import type { OpsContextPayload } from '../../../shared/wsProtocol';
import type { EventBus } from '../../domain/events/types';
import type {
  FileContext,
  GitContext,
  WorkspaceContext
} from '../../domain/context/types';
import type { DefaultSessionManager } from '../session/DefaultSessionManager';
import type { CommandEngine } from '../command/CommandEngine';
import type { Unsubscribe } from '../../domain/terminal/types';

const MAX_OPEN_FILES_PER_SESSION = 20;

export class ContextEngine {
  private readonly openFilesMap = new Map<string, string[]>();
  private readonly selectedFileMap = new Map<string, { file?: string; text?: string }>();
  private readonly unsubs: Unsubscribe[] = [];

  constructor(
    private readonly sessionManager: DefaultSessionManager,
    private readonly commandEngine: CommandEngine,
    private readonly eventBus: EventBus
  ) {
    // Track user-opened files from non-internal FileOpenedEvents (P1-E)
    this.unsubs.push(
      this.eventBus.subscribe('file:opened', evt => {
        const list = this.openFilesMap.get(evt.sessionId) ?? [];
        const filtered = list.filter(p => p !== evt.path);
        filtered.push(evt.path);
        if (filtered.length > MAX_OPEN_FILES_PER_SESSION) {
          filtered.shift();
        }
        this.openFilesMap.set(evt.sessionId, filtered);
        this.selectedFileMap.set(evt.sessionId, {
          ...this.selectedFileMap.get(evt.sessionId),
          file: evt.path
        });
      })
    );
  }

  public setSelection(sessionId: string, selectedFile?: string, selectedText?: string): void {
    this.selectedFileMap.set(sessionId, { file: selectedFile, text: selectedText });
  }

  public getFileContext(sessionId: string): FileContext {
    const openFiles = this.openFilesMap.get(sessionId) ?? [];
    const sel = this.selectedFileMap.get(sessionId);
    return {
      openFiles: [...openFiles],
      selectedFile: sel?.file,
      selectedText: sel?.text
    };
  }

  /**
   * Probe `.git/HEAD` using `{ internal: true }` so EventEmittingFsProvider
   * never emits a `FileOpenedEvent` (prevents self-excitation loop per P1-E).
   */
  private async probeGitContext(sessionId: string, cwd?: string): Promise<GitContext | undefined> {
    if (!cwd) return undefined;
    try {
      const { provider } = this.sessionManager.getFileSystemProvider(sessionId);
      const sep = cwd.includes('\\') ? '\\' : '/';
      const cleanCwd = cwd.replace(/[\\/]+$/, '');
      const headPath = `${cleanCwd}${sep}.git${sep}HEAD`;
      const raw = (await provider.read(sessionId, headPath, { internal: true })).trim();
      if (!raw) return undefined;

      if (raw.startsWith('ref:')) {
        const ref = raw.slice(4).trim();
        const branch = ref.replace(/^refs\/heads\//, '');
        return { branch, headRef: ref };
      }
      return { branch: raw.slice(0, 7), headRef: raw };
    } catch {
      return undefined;
    }
  }

  public async buildContext(
    sessionId: string,
    fallbackOps?: OpsContextPayload
  ): Promise<WorkspaceContext> {
    const session = this.sessionManager.get(sessionId);
    const now = Date.now();

    const cwd =
      this.commandEngine.getCwd(sessionId) ||
      session?.terminal.cwd ||
      fallbackOps?.currentDir ||
      '/root';

    let failedRecord = this.commandEngine.failed(sessionId);
    if (!failedRecord && fallbackOps?.failedCommand) {
      failedRecord = {
        id: `fallback-failed-${sessionId}`,
        sessionId,
        command: fallbackOps.failedCommand.command || '',
        cwd,
        startedAt: now,
        endedAt: now,
        exitCode: fallbackOps.failedCommand.exitCode,
        stdout: fallbackOps.failedCommand.output || '',
        stderr: '',
        status: 'failed'
      };
    }

    const recent = this.commandEngine.recent(sessionId, 20);
    const current = this.commandEngine.current(sessionId);
    const heuristicErr = this.commandEngine.getHeuristicError(sessionId);
    const git = session ? await this.probeGitContext(sessionId, cwd) : undefined;

    return {
      session: {
        id: session?.id ?? sessionId,
        type: session?.type ?? 'local',
        status: session?.status ?? 'active',
        hostId: session?.host.id ?? 'unknown',
        hostName: session?.host.name ?? 'Unknown Host',
        createdAt: session?.createdAt ?? now,
        lastActiveAt: session?.lastActiveAt ?? now
      },
      terminal: {
        cwd,
        shell: session?.terminal.shell,
        user: session?.host.username || fallbackOps?.currentUser || 'root',
        host: session?.host.host || 'localhost',
        os:
          fallbackOps?.osInfo ||
          (session?.type === 'local'
            ? `${os.platform()} ${os.arch()} ${os.release()}`
            : 'Linux x86_64'),
        hasSemanticIntegration: this.commandEngine.hasSemanticIntegration(sessionId),
        terminalSnippet: fallbackOps?.terminalSnippet || heuristicErr?.snippet
      },
      command: {
        current,
        failed: failedRecord,
        recent
      },
      filesystem: this.getFileContext(sessionId),
      git,
      system: {
        platform: process.platform,
        arch: process.arch,
        timestamp: now
      }
    };
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;
  }
}
