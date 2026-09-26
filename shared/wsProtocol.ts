/**
 * Shared WebSocket wire protocol — single source of truth for the message
 * shapes exchanged between the browser client and the Node.js backend.
 *
 * Inbound  = client → server (WsInboundMessage)
 * Outbound = server → client (WsOutboundMessage)
 *
 * Both sides cast untrusted JSON to these unions exactly once at the
 * trust boundary, then rely on discriminated-union narrowing via `msg.type`.
 */

// ---------------------------------------------------------------------------
// FileSystem / SFTP shared payloads
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
  owner?: string;
}

export type FileItem = FileEntry;

// ---------------------------------------------------------------------------
// AI chat payloads
// ---------------------------------------------------------------------------

export interface ChatPayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpsContextPayload {
  /** Last ~50 lines captured from the terminal */
  terminalSnippet?: string;
  currentDir?: string;
  currentUser?: string;
  osInfo?: string;
  commandHistory?: string[];
  failedCommand?: {
    command?: string;
    exitCode: number;
    output?: string;
  };
}

/** Client-side callbacks for consuming a streamed AI response. */
export interface AiStreamCallbacks {
  onThinking?: (delta: string) => void;
  onContent?: (delta: string) => void;
  onDone?: (fullContent: string, fullThinking?: string) => void;
  onError?: (err: string) => void;
}

// ---------------------------------------------------------------------------
// Inbound messages (client → server)
// ---------------------------------------------------------------------------

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface TermInitMessage {
  type: 'term:init';
  sessionId: string;
  hostId: string;
  cols: number;
  rows: number;
}

export interface TermInputMessage {
  type: 'term:input';
  sessionId: string;
  data: string;
}

export interface TermResizeMessage {
  type: 'term:resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TermCloseMessage {
  type: 'term:close';
  sessionId: string;
}

export interface TermCmdEventMessage {
  type: 'term:cmd_event';
  sessionId: string;
  kind: 'started' | 'finished' | 'cwd' | 'heuristic_error';
  commandId?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  output?: string;
  timestamp?: number;
}

export interface SftpListMessage {
  type: 'sftp:list';
  requestId: string;
  sessionId: string;
  dirPath: string;
}

export interface SftpReadMessage {
  type: 'sftp:read';
  requestId: string;
  sessionId: string;
  filePath: string;
}

export interface SftpWriteMessage {
  type: 'sftp:write';
  requestId: string;
  sessionId: string;
  filePath: string;
  content: string;
}

export interface SftpDeleteMessage {
  type: 'sftp:delete';
  requestId: string;
  sessionId: string;
  targetPath: string;
  isDirectory: boolean;
}

export interface SftpRenameMessage {
  type: 'sftp:rename';
  requestId: string;
  sessionId: string;
  oldPath: string;
  newPath: string;
}

export interface SftpChmodMessage {
  type: 'sftp:chmod';
  requestId: string;
  sessionId: string;
  targetPath: string;
  mode: string;
}

export interface SftpMkdirMessage {
  type: 'sftp:mkdir';
  requestId: string;
  sessionId: string;
  dirPath: string;
}

export interface AiChatMessage {
  type: 'ai:chat';
  requestId: string;
  sessionId?: string;
  messages: ChatPayload[];
  opsContext?: OpsContextPayload;
}

export interface AgentRunMessage {
  type: 'agent:run';
  requestId: string;
  sessionId: string;
  goal: string;
}

export interface AgentApproveMessage {
  type: 'agent:approve';
  sessionId: string;
  approvalId: string;
}

export interface AgentRejectMessage {
  type: 'agent:reject';
  sessionId: string;
  approvalId: string;
  reason?: string;
}

export interface AgentCancelMessage {
  type: 'agent:cancel';
  sessionId: string;
}

export interface AgentConfirmPlanMessage {
  type: 'agent:confirm_plan';
  sessionId: string;
  planId: string;
}

export interface AgentSkipMessage {
  type: 'agent:skip';
  sessionId: string;
  approvalId: string;
}

export type WsInboundMessage =
  | PingMessage
  | TermInitMessage
  | TermInputMessage
  | TermResizeMessage
  | TermCloseMessage
  | TermCmdEventMessage
  | SftpListMessage
  | SftpReadMessage
  | SftpWriteMessage
  | SftpDeleteMessage
  | SftpRenameMessage
  | SftpChmodMessage
  | SftpMkdirMessage
  | AiChatMessage
  | AgentRunMessage
  | AgentApproveMessage
  | AgentRejectMessage
  | AgentCancelMessage
  | AgentConfirmPlanMessage
  | AgentSkipMessage;

/** All SFTP request types accepted by the client-side `requestSftp` helper. */
export type SftpRequestType =
  | 'sftp:list'
  | 'sftp:read'
  | 'sftp:write'
  | 'sftp:delete'
  | 'sftp:rename'
  | 'sftp:chmod'
  | 'sftp:mkdir';

// ---------------------------------------------------------------------------
// Outbound messages (server → client)
// ---------------------------------------------------------------------------

export interface PongMessage {
  type: 'pong';
  clientTime: number;
  serverTime: number;
}

export interface TermDataMessage {
  type: 'term:data';
  sessionId: string;
  data: string;
}

export interface TermReadyMessage {
  type: 'term:ready';
  sessionId: string;
  hostName: string;
  cwd: string;
}

export interface TermCloseNotifyMessage {
  type: 'term:close';
  sessionId: string;
}

export interface TermErrorMessage {
  type: 'term:error';
  sessionId: string;
  message: string;
}

export interface SftpResponseMessage {
  type: 'sftp:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AiThinkingMessage {
  type: 'ai:thinking';
  requestId: string;
  delta: string;
}

export interface AiContentMessage {
  type: 'ai:content';
  requestId: string;
  delta: string;
}

export interface AiDoneMessage {
  type: 'ai:done';
  requestId: string;
  fullContent: string;
  fullThinking?: string;
}

export interface AiErrorMessage {
  type: 'ai:error';
  requestId: string;
  error: string;
}

export interface AgentPlanStepPayload {
  id: string;
  title: string;
  description?: string;
  toolName: 'shell' | 'file' | 'git' | 'ssh';
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';
  outputSummary?: string;
  error?: string;
  approvalId?: string;
}

export interface AgentPlanPayload {
  id: string;
  sessionId: string;
  goal: string;
  status:
    | 'planning'
    | 'awaiting_confirmation'
    | 'running'
    | 'awaiting_approval'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled';
  steps: AgentPlanStepPayload[];
  createdAt: number;
  updatedAt: number;
  summary?: string;
}

export interface ApprovalRequestPayload {
  id: string;
  sessionId: string;
  planId?: string;
  stepId?: string;
  toolName: string;
  action: Record<string, unknown>;
  assessment: {
    level: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    reason?: string;
    matchedRule?: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'skipped' | 'expired';
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  reason?: string;
}

export interface TimelineEntryPayload {
  id: string;
  sessionId: string;
  kind: 'command' | 'file' | 'agent' | 'session';
  title: string;
  detail?: string;
  status?: 'running' | 'success' | 'failed' | 'info';
  exitCode?: number;
  cwd?: string;
  durationMs?: number;
  timestamp: number;
}

export interface AgentPlanMessage {
  type: 'agent:plan';
  sessionId: string;
  plan: AgentPlanPayload;
}

export interface AgentApprovalRequestMessage {
  type: 'agent:approval_request';
  sessionId: string;
  approval: ApprovalRequestPayload;
}

export interface AgentApprovalResolvedMessage {
  type: 'agent:approval_resolved';
  sessionId: string;
  approvalId: string;
  status: 'approved' | 'rejected' | 'skipped' | 'expired';
  reason?: string;
}

export interface AgentErrorMessage {
  type: 'agent:error';
  sessionId: string;
  requestId?: string;
  message: string;
}

export interface AgentTimelineMessage {
  type: 'agent:timeline';
  sessionId: string;
  entries: TimelineEntryPayload[];
}

export type WsOutboundMessage =
  | PongMessage
  | TermDataMessage
  | TermReadyMessage
  | TermCloseNotifyMessage
  | TermErrorMessage
  | SftpResponseMessage
  | AiThinkingMessage
  | AiContentMessage
  | AiDoneMessage
  | AiErrorMessage
  | AgentPlanMessage
  | AgentApprovalRequestMessage
  | AgentApprovalResolvedMessage
  | AgentTimelineMessage
  | AgentErrorMessage;

// ---------------------------------------------------------------------------
// Runtime validation — server-side trust boundary
// ---------------------------------------------------------------------------

/** Identifiers (sessionId / requestId / hostId) must be safe token-like strings. */
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

const MAX_PATH_LEN = 4096;
const MAX_INPUT_LEN = 65_536;
const MAX_FILE_CONTENT_LEN = 20_000_000;
const MAX_AI_MESSAGES = 200;
const MAX_AI_MESSAGE_LEN = 100_000;
const MAX_SNIPPET_LEN = 100_000;

export type WsValidationResult =
  { ok: true; msg: WsInboundMessage } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length <= maxLen;
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function fail(reason: string): WsValidationResult {
  return { ok: false, reason };
}

function parseOpsContext(v: unknown): OpsContextPayload | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v)) return undefined;
  const ctx: OpsContextPayload = {};
  if (isStr(v.terminalSnippet, MAX_SNIPPET_LEN)) ctx.terminalSnippet = v.terminalSnippet;
  if (isStr(v.currentDir, MAX_PATH_LEN)) ctx.currentDir = v.currentDir;
  if (isStr(v.currentUser, 256)) ctx.currentUser = v.currentUser;
  if (isStr(v.osInfo, 512)) ctx.osInfo = v.osInfo;
  if (Array.isArray(v.commandHistory)) {
    ctx.commandHistory = v.commandHistory.filter((h): h is string => isStr(h, 2000)).slice(0, 500);
  }
  if (isRecord(v.failedCommand)) {
    const fc = v.failedCommand;
    if (typeof fc.exitCode === 'number' && Number.isFinite(fc.exitCode)) {
      ctx.failedCommand = {
        exitCode: fc.exitCode,
        ...(isStr(fc.command, 2000) ? { command: fc.command } : {}),
        ...(isStr(fc.output, MAX_SNIPPET_LEN) ? { output: fc.output } : {})
      };
    }
  }
  return ctx;
}

/**
 * Validate and normalize an untrusted parsed JSON value into a typed inbound
 * message. Messages are REBUILT field-by-field so unknown/extra properties
 * are stripped instead of silently flowing into handlers.
 */
export function validateWsInboundMessage(value: unknown): WsValidationResult {
  if (!isRecord(value)) return fail('消息必须是 JSON 对象');
  const { type } = value;
  if (typeof type !== 'string') return fail('缺少消息类型 type');

  switch (type) {
    case 'ping': {
      if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) {
        return fail('ping.timestamp 必须是有限数值');
      }
      return { ok: true, msg: { type: 'ping', timestamp: value.timestamp } };
    }

    case 'term:init': {
      if (!isId(value.sessionId))
        return fail('term:init.sessionId 非法（仅允许字母数字 _ . : -，≤128 字符）');
      if (!isId(value.hostId)) return fail('term:init.hostId 非法');
      if (!isInt(value.cols, 1, 1000)) return fail('term:init.cols 必须是 1-1000 的整数');
      if (!isInt(value.rows, 1, 1000)) return fail('term:init.rows 必须是 1-1000 的整数');
      return {
        ok: true,
        msg: {
          type: 'term:init',
          sessionId: value.sessionId,
          hostId: value.hostId,
          cols: value.cols,
          rows: value.rows
        }
      };
    }

    case 'term:input': {
      if (!isId(value.sessionId)) return fail('term:input.sessionId 非法');
      if (!isStr(value.data, MAX_INPUT_LEN)) return fail('term:input.data 必须是 ≤64KB 的字符串');
      return {
        ok: true,
        msg: { type: 'term:input', sessionId: value.sessionId, data: value.data }
      };
    }

    case 'term:resize': {
      if (!isId(value.sessionId)) return fail('term:resize.sessionId 非法');
      if (!isInt(value.cols, 1, 1000)) return fail('term:resize.cols 必须是 1-1000 的整数');
      if (!isInt(value.rows, 1, 1000)) return fail('term:resize.rows 必须是 1-1000 的整数');
      return {
        ok: true,
        msg: { type: 'term:resize', sessionId: value.sessionId, cols: value.cols, rows: value.rows }
      };
    }

    case 'term:close': {
      if (!isId(value.sessionId)) return fail('term:close.sessionId 非法');
      return { ok: true, msg: { type: 'term:close', sessionId: value.sessionId } };
    }

    case 'term:cmd_event': {
      if (!isId(value.sessionId)) return fail('term:cmd_event.sessionId 非法');
      const kind = value.kind;
      if (
        kind !== 'started' &&
        kind !== 'finished' &&
        kind !== 'cwd' &&
        kind !== 'heuristic_error'
      ) {
        return fail('term:cmd_event.kind 必须是 started/finished/cwd/heuristic_error');
      }
      if (value.commandId !== undefined && !isId(value.commandId)) {
        return fail('term:cmd_event.commandId 非法');
      }
      if (value.command !== undefined && !isStr(value.command, 4000)) {
        return fail('term:cmd_event.command 过长或非法');
      }
      if (value.cwd !== undefined && !isStr(value.cwd, MAX_PATH_LEN)) {
        return fail('term:cmd_event.cwd 非法');
      }
      if (
        value.exitCode !== undefined &&
        (typeof value.exitCode !== 'number' || !Number.isInteger(value.exitCode))
      ) {
        return fail('term:cmd_event.exitCode 必须是整数');
      }
      if (value.output !== undefined && !isStr(value.output, MAX_SNIPPET_LEN)) {
        return fail('term:cmd_event.output 过长或非法');
      }
      if (
        value.timestamp !== undefined &&
        (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp))
      ) {
        return fail('term:cmd_event.timestamp 必须是有限数值');
      }
      return {
        ok: true,
        msg: {
          type: 'term:cmd_event',
          sessionId: value.sessionId,
          kind,
          ...(value.commandId !== undefined ? { commandId: value.commandId } : {}),
          ...(value.command !== undefined ? { command: value.command } : {}),
          ...(value.cwd !== undefined ? { cwd: value.cwd } : {}),
          ...(value.exitCode !== undefined ? { exitCode: value.exitCode } : {}),
          ...(value.output !== undefined ? { output: value.output } : {}),
          ...(value.timestamp !== undefined ? { timestamp: value.timestamp } : {})
        }
      };
    }

    case 'sftp:list': {
      if (!isId(value.requestId)) return fail('sftp:list.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:list.sessionId 非法');
      if (!isStr(value.dirPath, MAX_PATH_LEN)) return fail('sftp:list.dirPath 非法');
      return {
        ok: true,
        msg: {
          type: 'sftp:list',
          requestId: value.requestId,
          sessionId: value.sessionId,
          dirPath: value.dirPath
        }
      };
    }

    case 'sftp:read': {
      if (!isId(value.requestId)) return fail('sftp:read.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:read.sessionId 非法');
      if (!isStr(value.filePath, MAX_PATH_LEN)) return fail('sftp:read.filePath 非法');
      return {
        ok: true,
        msg: {
          type: 'sftp:read',
          requestId: value.requestId,
          sessionId: value.sessionId,
          filePath: value.filePath
        }
      };
    }

    case 'sftp:write': {
      if (!isId(value.requestId)) return fail('sftp:write.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:write.sessionId 非法');
      if (!isStr(value.filePath, MAX_PATH_LEN)) return fail('sftp:write.filePath 非法');
      if (!isStr(value.content, MAX_FILE_CONTENT_LEN))
        return fail('sftp:write.content 非法或超出大小限制');
      return {
        ok: true,
        msg: {
          type: 'sftp:write',
          requestId: value.requestId,
          sessionId: value.sessionId,
          filePath: value.filePath,
          content: value.content
        }
      };
    }

    case 'sftp:delete': {
      if (!isId(value.requestId)) return fail('sftp:delete.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:delete.sessionId 非法');
      if (!isStr(value.targetPath, MAX_PATH_LEN)) return fail('sftp:delete.targetPath 非法');
      if (typeof value.isDirectory !== 'boolean')
        return fail('sftp:delete.isDirectory 必须是布尔值');
      return {
        ok: true,
        msg: {
          type: 'sftp:delete',
          requestId: value.requestId,
          sessionId: value.sessionId,
          targetPath: value.targetPath,
          isDirectory: value.isDirectory
        }
      };
    }

    case 'sftp:rename': {
      if (!isId(value.requestId)) return fail('sftp:rename.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:rename.sessionId 非法');
      if (!isStr(value.oldPath, MAX_PATH_LEN)) return fail('sftp:rename.oldPath 非法');
      if (!isStr(value.newPath, MAX_PATH_LEN)) return fail('sftp:rename.newPath 非法');
      return {
        ok: true,
        msg: {
          type: 'sftp:rename',
          requestId: value.requestId,
          sessionId: value.sessionId,
          oldPath: value.oldPath,
          newPath: value.newPath
        }
      };
    }

    case 'sftp:chmod': {
      if (!isId(value.requestId)) return fail('sftp:chmod.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:chmod.sessionId 非法');
      if (!isStr(value.targetPath, MAX_PATH_LEN)) return fail('sftp:chmod.targetPath 非法');
      if (typeof value.mode !== 'string' || !/^[0-7]{3,4}$/.test(value.mode)) {
        return fail('sftp:chmod.mode 必须是 3-4 位八进制字符串');
      }
      return {
        ok: true,
        msg: {
          type: 'sftp:chmod',
          requestId: value.requestId,
          sessionId: value.sessionId,
          targetPath: value.targetPath,
          mode: value.mode
        }
      };
    }

    case 'sftp:mkdir': {
      if (!isId(value.requestId)) return fail('sftp:mkdir.requestId 非法');
      if (!isId(value.sessionId)) return fail('sftp:mkdir.sessionId 非法');
      if (!isStr(value.dirPath, MAX_PATH_LEN)) return fail('sftp:mkdir.dirPath 非法');
      return {
        ok: true,
        msg: {
          type: 'sftp:mkdir',
          requestId: value.requestId,
          sessionId: value.sessionId,
          dirPath: value.dirPath
        }
      };
    }

    case 'ai:chat': {
      if (!isId(value.requestId)) return fail('ai:chat.requestId 非法');
      if (value.sessionId !== undefined && !isId(value.sessionId)) {
        return fail('ai:chat.sessionId 非法');
      }
      if (!Array.isArray(value.messages) || value.messages.length > MAX_AI_MESSAGES) {
        return fail(`ai:chat.messages 必须是 ≤${MAX_AI_MESSAGES} 条的数组`);
      }
      const messages: ChatPayload[] = [];
      for (const m of value.messages) {
        if (!isRecord(m)) return fail('ai:chat.messages 包含非对象条目');
        const role = m.role;
        if (role !== 'system' && role !== 'user' && role !== 'assistant') {
          return fail('ai:chat.messages[].role 必须是 system/user/assistant');
        }
        if (!isStr(m.content, MAX_AI_MESSAGE_LEN))
          return fail('ai:chat.messages[].content 非法或过长');
        messages.push({ role, content: m.content });
      }
      return {
        ok: true,
        msg: {
          type: 'ai:chat',
          requestId: value.requestId,
          ...(value.sessionId !== undefined ? { sessionId: value.sessionId } : {}),
          messages,
          opsContext: parseOpsContext(value.opsContext)
        }
      };
    }

    case 'agent:run': {
      if (!isId(value.requestId)) return fail('agent:run.requestId 非法');
      if (!isId(value.sessionId)) return fail('agent:run.sessionId 非法');
      if (typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > MAX_AI_MESSAGE_LEN) {
        return fail('agent:run.goal 必须是非空字符串');
      }
      return {
        ok: true,
        msg: {
          type: 'agent:run',
          requestId: value.requestId,
          sessionId: value.sessionId,
          goal: value.goal.trim()
        }
      };
    }

    case 'agent:approve': {
      if (!isId(value.sessionId)) return fail('agent:approve.sessionId 非法');
      if (!isId(value.approvalId)) return fail('agent:approve.approvalId 非法');
      return {
        ok: true,
        msg: {
          type: 'agent:approve',
          sessionId: value.sessionId,
          approvalId: value.approvalId
        }
      };
    }

    case 'agent:reject': {
      if (!isId(value.sessionId)) return fail('agent:reject.sessionId 非法');
      if (!isId(value.approvalId)) return fail('agent:reject.approvalId 非法');
      if (value.reason !== undefined && !isStr(value.reason, 2000)) {
        return fail('agent:reject.reason 非法');
      }
      return {
        ok: true,
        msg: {
          type: 'agent:reject',
          sessionId: value.sessionId,
          approvalId: value.approvalId,
          ...(value.reason !== undefined ? { reason: value.reason } : {})
        }
      };
    }

    case 'agent:cancel': {
      if (!isId(value.sessionId)) return fail('agent:cancel.sessionId 非法');
      return {
        ok: true,
        msg: {
          type: 'agent:cancel',
          sessionId: value.sessionId
        }
      };
    }

    case 'agent:confirm_plan': {
      if (!isId(value.sessionId)) return fail('agent:confirm_plan.sessionId 非法');
      if (!isId(value.planId)) return fail('agent:confirm_plan.planId 非法');
      return {
        ok: true,
        msg: {
          type: 'agent:confirm_plan',
          sessionId: value.sessionId,
          planId: value.planId
        }
      };
    }

    case 'agent:skip': {
      if (!isId(value.sessionId)) return fail('agent:skip.sessionId 非法');
      if (!isId(value.approvalId)) return fail('agent:skip.approvalId 非法');
      return {
        ok: true,
        msg: {
          type: 'agent:skip',
          sessionId: value.sessionId,
          approvalId: value.approvalId
        }
      };
    }

    default:
      return fail(`未知消息类型: ${type.slice(0, 64)}`);
  }
}
