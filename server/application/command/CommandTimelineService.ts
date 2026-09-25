import type { TimelineEntry } from '../../domain/command/Timeline';
import type { EventBus, MonoEvent } from '../../domain/events/types';
import type { Unsubscribe } from '../../domain/terminal/types';

const MAX_TIMELINE_ENTRIES_PER_SESSION = 200;

export class CommandTimelineService {
  private readonly entriesBySession = new Map<string, TimelineEntry[]>();
  private readonly listeners = new Set<(sessionId: string, entries: TimelineEntry[]) => void>();
  private readonly unsub: Unsubscribe;
  private seq = 0;

  constructor(private readonly eventBus: EventBus) {
    this.unsub = this.eventBus.subscribeAll(evt => this.handleEvent(evt));
  }

  public onTimelineUpdate(
    listener: (sessionId: string, entries: TimelineEntry[]) => void
  ): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getTimeline(sessionId: string, limit = 50): TimelineEntry[] {
    const list = this.entriesBySession.get(sessionId) ?? [];
    return list.slice(-limit);
  }

  public clear(sessionId: string): void {
    this.entriesBySession.delete(sessionId);
  }

  public dispose(): void {
    this.unsub();
    this.listeners.clear();
  }

  private pushEntry(sessionId: string, entry: TimelineEntry): void {
    let list = this.entriesBySession.get(sessionId);
    if (!list) {
      list = [];
      this.entriesBySession.set(sessionId, list);
    }

    const existingIdx = list.findIndex(e => e.id === entry.id);
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.push(entry);
      if (list.length > MAX_TIMELINE_ENTRIES_PER_SESSION) {
        list.shift();
      }
    }

    const snapshot = [...list];
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(sessionId, snapshot);
      } catch (err) {
        console.error('[CommandTimelineService] Error in listener:', err);
      }
    }
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private handleEvent(event: MonoEvent): void {
    const { sessionId, timestamp } = event;

    switch (event.type) {
      case 'command:started':
        this.pushEntry(sessionId, {
          id: `tl-cmd-${event.commandId}`,
          sessionId,
          kind: 'command',
          title: event.command || '(shell command)',
          cwd: event.cwd,
          status: 'running',
          timestamp
        });
        break;

      case 'command:finished':
        this.pushEntry(sessionId, {
          id: `tl-cmd-${event.commandId}`,
          sessionId,
          kind: 'command',
          title: event.command || '(shell command)',
          detail: `exit ${event.exitCode} (${event.durationMs}ms)`,
          status: event.exitCode === 0 ? 'success' : 'failed',
          exitCode: event.exitCode,
          cwd: event.cwd,
          durationMs: event.durationMs,
          timestamp
        });
        break;

      case 'file:opened':
        this.pushEntry(sessionId, {
          id: this.nextId('tl-file-open'),
          sessionId,
          kind: 'file',
          title: `读取文件: ${event.path}`,
          status: 'info',
          timestamp
        });
        break;

      case 'file:saved':
        this.pushEntry(sessionId, {
          id: this.nextId('tl-file-save'),
          sessionId,
          kind: 'file',
          title: `保存文件: ${event.path}`,
          detail: `${event.byteLength} bytes`,
          status: 'success',
          timestamp
        });
        break;

      case 'file:changed':
        this.pushEntry(sessionId, {
          id: this.nextId('tl-file-chg'),
          sessionId,
          kind: 'file',
          title: `文件变更 (${event.operation}): ${event.path}`,
          detail: event.targetPath ? `-> ${event.targetPath}` : undefined,
          status: 'info',
          timestamp
        });
        break;

      case 'agent:started':
        this.pushEntry(sessionId, {
          id: `tl-plan-${event.planId}`,
          sessionId,
          kind: 'agent',
          title: `Agent 规划启动: ${event.goal}`,
          status: 'running',
          timestamp
        });
        break;

      case 'agent:tool_call':
        this.pushEntry(sessionId, {
          id: `tl-tc-${event.toolCallId}`,
          sessionId,
          kind: 'agent',
          title: `调用工具 [${event.toolName}]`,
          detail: JSON.stringify(event.input).slice(0, 120),
          status: 'running',
          timestamp
        });
        break;

      case 'agent:tool_result':
        this.pushEntry(sessionId, {
          id: `tl-tc-${event.toolCallId}`,
          sessionId,
          kind: 'agent',
          title: `工具完成 [${event.toolName}]`,
          detail: event.error || (event.success ? '成功' : '失败'),
          status: event.success ? 'success' : 'failed',
          timestamp
        });
        break;

      case 'agent:finished':
        this.pushEntry(sessionId, {
          id: `tl-plan-${event.planId}`,
          sessionId,
          kind: 'agent',
          title: `Agent 任务结束 (${event.status})`,
          detail: event.summary,
          status:
            event.status === 'completed'
              ? 'success'
              : event.status === 'cancelled'
                ? 'info'
                : 'failed',
          timestamp
        });
        break;

      case 'session:connected':
        this.pushEntry(sessionId, {
          id: this.nextId('tl-sess-conn'),
          sessionId,
          kind: 'session',
          title: `会话已连接 (${event.sessionType})`,
          cwd: event.cwd,
          status: 'success',
          timestamp
        });
        break;

      case 'session:disconnected':
        this.pushEntry(sessionId, {
          id: this.nextId('tl-sess-disc'),
          sessionId,
          kind: 'session',
          title: `会话已断开 (${event.reason})`,
          status: 'info',
          timestamp
        });
        break;

      default:
        break;
    }
  }
}
