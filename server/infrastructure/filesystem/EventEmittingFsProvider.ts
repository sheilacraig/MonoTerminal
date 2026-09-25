import type { EventBus } from '../../domain/events/types';
import type {
  FileEntry,
  FileReadOptions,
  FileStat,
  FileSystemProvider
} from '../../domain/filesystem/types';
import type { SessionType } from '../../domain/session/types';

/**
 * Decorator around FileSystemProvider that publishes FileOpenedEvent, FileSavedEvent,
 * and FileChangedEvent to the EventBus (Phase 4 / P1-11).
 *
 * Suppresses FileOpenedEvent when `options?.internal === true` so internal probes
 * (such as ContextEngine reading `.git/HEAD` or Verifier inspecting files) never
 * trigger event self-excitation loops (P1-E).
 */
export class EventEmittingFsProvider implements FileSystemProvider {
  public readonly type: SessionType;

  constructor(
    private readonly inner: FileSystemProvider,
    private readonly eventBus: EventBus
  ) {
    this.type = inner.type;
  }

  public async list(sessionId: string, path: string): Promise<FileEntry[]> {
    return this.inner.list(sessionId, path);
  }

  public async stat(sessionId: string, path: string): Promise<FileStat> {
    return this.inner.stat(sessionId, path);
  }

  public async read(
    sessionId: string,
    path: string,
    options?: FileReadOptions
  ): Promise<string> {
    const content = await this.inner.read(sessionId, path, options);
    if (!options?.internal) {
      this.eventBus.publish({
        type: 'file:opened',
        sessionId,
        path,
        timestamp: Date.now()
      });
    }
    return content;
  }

  public async write(sessionId: string, path: string, content: string): Promise<void> {
    await this.inner.write(sessionId, path, content);
    this.eventBus.publish({
      type: 'file:saved',
      sessionId,
      path,
      byteLength: Buffer.byteLength(content, 'utf8'),
      timestamp: Date.now()
    });
  }

  public async mkdir(sessionId: string, path: string): Promise<void> {
    await this.inner.mkdir(sessionId, path);
    this.eventBus.publish({
      type: 'file:changed',
      sessionId,
      path,
      operation: 'mkdir',
      timestamp: Date.now()
    });
  }

  public async delete(
    sessionId: string,
    path: string,
    isDirectory: boolean
  ): Promise<void> {
    await this.inner.delete(sessionId, path, isDirectory);
    this.eventBus.publish({
      type: 'file:changed',
      sessionId,
      path,
      operation: 'delete',
      timestamp: Date.now()
    });
  }

  public async rename(sessionId: string, from: string, to: string): Promise<void> {
    await this.inner.rename(sessionId, from, to);
    this.eventBus.publish({
      type: 'file:changed',
      sessionId,
      path: from,
      targetPath: to,
      operation: 'rename',
      timestamp: Date.now()
    });
  }

  public async chmod(sessionId: string, path: string, mode: number): Promise<void> {
    await this.inner.chmod(sessionId, path, mode);
    this.eventBus.publish({
      type: 'file:changed',
      sessionId,
      path,
      operation: 'chmod',
      timestamp: Date.now()
    });
  }
}
