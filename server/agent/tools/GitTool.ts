import type { GuardrailAction } from '../../domain/security/types';
import type { ShellTool, ShellToolOutput } from './ShellTool';
import {
  isPlainObject,
  type Tool,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSchema
} from './Tool';

export type GitToolOperation = 'status' | 'diff' | 'log' | 'branch';

export interface GitToolInput {
  operation: GitToolOperation;
  cwd?: string;
  args?: string[];
}

const VALID_GIT_OPS = new Set<GitToolOperation>(['status', 'diff', 'log', 'branch']);

export const gitToolSchema: ToolSchema<GitToolInput> = {
  jsonSchema: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['status', 'diff', 'log', 'branch'] },
      cwd: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } }
    }
  },
  validate(raw: unknown) {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'GitTool 参数必须是对象' };
    }
    const op = raw.operation as GitToolOperation;
    if (typeof op !== 'string' || !VALID_GIT_OPS.has(op)) {
      return { ok: false, error: 'GitTool.operation 必须是 status/diff/log/branch' };
    }
    if (raw.cwd !== undefined && typeof raw.cwd !== 'string') {
      return { ok: false, error: 'GitTool.cwd 必须是字符串' };
    }
    const safeArgs = Array.isArray(raw.args)
      ? raw.args.filter((a): a is string => typeof a === 'string' && /^[A-Za-z0-9_./:-]+$/.test(a))
      : undefined;
    return {
      ok: true,
      data: {
        operation: op,
        cwd: raw.cwd,
        args: safeArgs
      }
    };
  }
};

function buildGitCommand(input: GitToolInput): string {
  switch (input.operation) {
    case 'status':
      return 'git status --short --branch';
    case 'diff':
      return 'git diff --stat';
    case 'log':
      return 'git log -n 10 --oneline';
    case 'branch':
      return 'git branch -a';
  }
}

export class GitTool implements Tool<GitToolInput, ShellToolOutput> {
  public readonly name = 'git';
  public readonly description =
    'Inspect Git repository status, branches, recent commits, and diff summary.';
  public readonly schema = gitToolSchema;

  constructor(private readonly shellTool: ShellTool) {}

  public toGuardrailAction(input: GitToolInput, ctx: ToolExecutionContext): GuardrailAction {
    return {
      kind: 'shell:exec',
      sessionId: ctx.sessionId,
      command: buildGitCommand(input),
      cwd: input.cwd || ctx.cwd
    };
  }

  public async execute(
    input: GitToolInput,
    ctx: ToolExecutionContext
  ): Promise<ToolResult<ShellToolOutput>> {
    return this.shellTool.execute(
      {
        command: buildGitCommand(input),
        cwd: input.cwd || ctx.cwd,
        timeoutMs: 10_000
      },
      ctx
    );
  }
}
