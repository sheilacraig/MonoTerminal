import type { GuardrailAction } from '../../domain/security/types';

/**
 * Lightweight zero-dependency schema validator (P1-8).
 */
export interface ToolSchema<T> {
  jsonSchema: Record<string, unknown>;
  validate(raw: unknown): { ok: true; data: T } | { ok: false; error: string };
}

export interface ToolExecutionContext {
  sessionId: string;
  cwd?: string;
  abortSignal?: AbortSignal;
  onCwdChange?: (newCwd: string) => void;
}

export interface ToolResult<O = unknown> {
  success: boolean;
  output?: O;
  error?: string;
  durationMs: number;
}

export interface Tool<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSchema<I>;
  toGuardrailAction(input: I, ctx: ToolExecutionContext): GuardrailAction;
  execute(input: I, ctx: ToolExecutionContext): Promise<ToolResult<O>>;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
