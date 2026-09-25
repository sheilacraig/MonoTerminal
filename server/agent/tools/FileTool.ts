import { errorMessage } from '../../../shared/errors';
import type { GuardrailAction } from '../../domain/security/types';
import type { DefaultSessionManager } from '../../application/session/DefaultSessionManager';
import {
  isPlainObject,
  type Tool,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSchema
} from './Tool';

export type FileToolOperation =
  | 'list'
  | 'stat'
  | 'read'
  | 'write'
  | 'mkdir'
  | 'delete'
  | 'rename'
  | 'chmod';

export interface FileToolInput {
  operation: FileToolOperation;
  path: string;
  content?: string;
  newPath?: string;
  isDirectory?: boolean;
  mode?: number | string;
}

const VALID_OPS = new Set<FileToolOperation>([
  'list',
  'stat',
  'read',
  'write',
  'mkdir',
  'delete',
  'rename',
  'chmod'
]);

export const fileToolSchema: ToolSchema<FileToolInput> = {
  jsonSchema: {
    type: 'object',
    required: ['operation', 'path'],
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'stat', 'read', 'write', 'mkdir', 'delete', 'rename', 'chmod']
      },
      path: { type: 'string' },
      content: { type: 'string' },
      newPath: { type: 'string' },
      isDirectory: { type: 'boolean' },
      mode: { type: ['number', 'string'] }
    }
  },
  validate(raw: unknown) {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'FileTool 参数必须是对象' };
    }
    const op = raw.operation as FileToolOperation;
    if (typeof op !== 'string' || !VALID_OPS.has(op)) {
      return { ok: false, error: 'FileTool.operation 非法' };
    }
    if (typeof raw.path !== 'string' || !raw.path.trim()) {
      return { ok: false, error: 'FileTool.path 必须是非空字符串' };
    }
    if (op === 'write' && typeof raw.content !== 'string') {
      return { ok: false, error: 'FileTool write 操作必须提供字符串 content' };
    }
    if (op === 'rename' && (typeof raw.newPath !== 'string' || !raw.newPath.trim())) {
      return { ok: false, error: 'FileTool rename 操作必须提供非空字符串 newPath' };
    }
    if (
      op === 'chmod' &&
      typeof raw.mode !== 'number' &&
      (typeof raw.mode !== 'string' || !/^[0-7]{3,4}$/.test(raw.mode))
    ) {
      return { ok: false, error: 'FileTool chmod 操作必须提供有效的权限 mode' };
    }

    return {
      ok: true,
      data: {
        operation: op,
        path: raw.path.trim(),
        content: typeof raw.content === 'string' ? raw.content : undefined,
        newPath: typeof raw.newPath === 'string' ? raw.newPath.trim() : undefined,
        isDirectory: typeof raw.isDirectory === 'boolean' ? raw.isDirectory : undefined,
        mode: raw.mode as number | string | undefined
      }
    };
  }
};

function parseNumericMode(mode: number | string | undefined): number {
  if (typeof mode === 'number') return mode;
  if (typeof mode === 'string') return parseInt(mode, 8);
  return 0o644;
}

export class FileTool implements Tool<FileToolInput, unknown> {
  public readonly name = 'file';
  public readonly description =
    'Perform unified file system operations (list, stat, read, write, mkdir, delete, rename, chmod) on the active session.';
  public readonly schema = fileToolSchema;

  constructor(private readonly sessionManager: DefaultSessionManager) {}

  public toGuardrailAction(input: FileToolInput, ctx: ToolExecutionContext): GuardrailAction {
    const sessionRoot = this.sessionManager.get(ctx.sessionId)?.filesystem.rootPath;
    switch (input.operation) {
      case 'list':
        return { kind: 'fs:list', sessionId: ctx.sessionId, path: input.path, sessionRoot };
      case 'stat':
        return { kind: 'fs:stat', sessionId: ctx.sessionId, path: input.path, sessionRoot };
      case 'read':
        return { kind: 'fs:read', sessionId: ctx.sessionId, path: input.path, sessionRoot };
      case 'write':
        return {
          kind: 'fs:write',
          sessionId: ctx.sessionId,
          path: input.path,
          byteLength: Buffer.byteLength(input.content || '', 'utf-8'),
          sessionRoot
        };
      case 'mkdir':
        return { kind: 'fs:mkdir', sessionId: ctx.sessionId, path: input.path, sessionRoot };
      case 'delete':
        return {
          kind: 'fs:delete',
          sessionId: ctx.sessionId,
          path: input.path,
          isDirectory: input.isDirectory,
          sessionRoot
        };
      case 'rename':
        return {
          kind: 'fs:rename',
          sessionId: ctx.sessionId,
          oldPath: input.path,
          newPath: input.newPath || '',
          sessionRoot
        };
      case 'chmod':
        return {
          kind: 'fs:chmod',
          sessionId: ctx.sessionId,
          path: input.path,
          mode: parseNumericMode(input.mode),
          sessionRoot
        };
    }
  }

  public async execute(input: FileToolInput, ctx: ToolExecutionContext): Promise<ToolResult> {
    const startMs = Date.now();
    try {
      const { provider } = this.sessionManager.getFileSystemProvider(ctx.sessionId);

      switch (input.operation) {
        case 'list': {
          const entries = await provider.list(ctx.sessionId, input.path);
          return { success: true, output: entries, durationMs: Date.now() - startMs };
        }
        case 'stat': {
          const stat = await provider.stat(ctx.sessionId, input.path);
          return { success: true, output: stat, durationMs: Date.now() - startMs };
        }
        case 'read': {
          const content = await provider.read(ctx.sessionId, input.path);
          return { success: true, output: content, durationMs: Date.now() - startMs };
        }
        case 'write': {
          await provider.write(ctx.sessionId, input.path, input.content || '');
          return {
            success: true,
            output: { path: input.path, written: true },
            durationMs: Date.now() - startMs
          };
        }
        case 'mkdir': {
          await provider.mkdir(ctx.sessionId, input.path);
          return {
            success: true,
            output: { path: input.path, created: true },
            durationMs: Date.now() - startMs
          };
        }
        case 'delete': {
          let isDir = input.isDirectory;
          if (isDir === undefined) {
            try {
              const st = await provider.stat(ctx.sessionId, input.path);
              isDir = st.isDirectory;
            } catch {
              isDir = false;
            }
          }
          await provider.delete(ctx.sessionId, input.path, isDir);
          return {
            success: true,
            output: { path: input.path, deleted: true },
            durationMs: Date.now() - startMs
          };
        }
        case 'rename': {
          await provider.rename(ctx.sessionId, input.path, input.newPath!);
          return {
            success: true,
            output: { oldPath: input.path, newPath: input.newPath, renamed: true },
            durationMs: Date.now() - startMs
          };
        }
        case 'chmod': {
          const numMode = parseNumericMode(input.mode);
          await provider.chmod(ctx.sessionId, input.path, numMode);
          return {
            success: true,
            output: { path: input.path, mode: numMode, updated: true },
            durationMs: Date.now() - startMs
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        error: errorMessage(err),
        durationMs: Date.now() - startMs
      };
    }
  }
}
