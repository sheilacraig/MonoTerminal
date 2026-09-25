import type { GuardrailAction } from '../../domain/security/types';
import type { ShellTool, ShellToolOutput } from './ShellTool';
import {
  isPlainObject,
  type Tool,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSchema
} from './Tool';

export interface SshToolInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export const sshToolSchema: ToolSchema<SshToolInput> = {
  jsonSchema: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string', description: 'Remote command to execute via SSH exec channel' },
      cwd: { type: 'string' },
      timeoutMs: { type: 'number' }
    }
  },
  validate(raw: unknown) {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'SshTool 参数必须是对象' };
    }
    if (typeof raw.command !== 'string' || !raw.command.trim()) {
      return { ok: false, error: 'SshTool.command 必须是非空字符串' };
    }
    return {
      ok: true,
      data: {
        command: raw.command.trim(),
        cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        timeoutMs: typeof raw.timeoutMs === 'number' ? raw.timeoutMs : undefined
      }
    };
  }
};

export class SshTool implements Tool<SshToolInput, ShellToolOutput> {
  public readonly name = 'ssh';
  public readonly description =
    'Execute a remote command over an isolated SSH exec channel on the active session.';
  public readonly schema = sshToolSchema;

  constructor(private readonly shellTool: ShellTool) {}

  public toGuardrailAction(input: SshToolInput, ctx: ToolExecutionContext): GuardrailAction {
    return {
      kind: 'shell:exec',
      sessionId: ctx.sessionId,
      command: input.command,
      cwd: input.cwd || ctx.cwd
    };
  }

  public async execute(
    input: SshToolInput,
    ctx: ToolExecutionContext
  ): Promise<ToolResult<ShellToolOutput>> {
    return this.shellTool.execute(input, ctx);
  }
}
