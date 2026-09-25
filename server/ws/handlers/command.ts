import type { TermCmdEventMessage } from '../../../shared/wsProtocol';
import type { WsHandler } from '../types';

export const handleTermCmdEvent: WsHandler<TermCmdEventMessage> = (msg, _conn, deps) => {
  if (!deps.commandEngine) return;
  deps.commandEngine.ingestClientEvent({
    sessionId: msg.sessionId,
    kind: msg.kind,
    commandId: msg.commandId,
    command: msg.command,
    cwd: msg.cwd,
    exitCode: msg.exitCode,
    output: msg.output,
    timestamp: msg.timestamp
  });
};
