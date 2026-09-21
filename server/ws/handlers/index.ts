import type { WsInboundMessage } from '../../../shared/wsProtocol';
import type { WsConnection, WsDependencies, WsHandler, WsHandlerMap } from '../types';
import { handlePing } from './ping';
import { handleTermInit, handleTermInput, handleTermResize, handleTermClose } from './terminal';
import {
  handleSftpList,
  handleSftpRead,
  handleSftpWrite,
  handleSftpDelete,
  handleSftpRename,
  handleSftpChmod,
  handleSftpMkdir
} from './sftp';
import { handleAiChat } from './ai';

/** Message-type → handler registry. Add new message types here. */
export const wsHandlers: WsHandlerMap = {
  ping: handlePing,
  'term:init': handleTermInit,
  'term:input': handleTermInput,
  'term:resize': handleTermResize,
  'term:close': handleTermClose,
  'sftp:list': handleSftpList,
  'sftp:read': handleSftpRead,
  'sftp:write': handleSftpWrite,
  'sftp:delete': handleSftpDelete,
  'sftp:rename': handleSftpRename,
  'sftp:chmod': handleSftpChmod,
  'sftp:mkdir': handleSftpMkdir,
  'ai:chat': handleAiChat
};

/**
 * Route a validated inbound message to its handler. Unknown types are logged
 * and ignored (upstream validation normally prevents them reaching here).
 */
export async function dispatchWsMessage(
  msg: WsInboundMessage,
  conn: WsConnection,
  deps: WsDependencies
): Promise<void> {
  const handler = wsHandlers[msg.type] as unknown as WsHandler<WsInboundMessage> | undefined;
  if (!handler) {
    console.warn(`[wsRouter] 未知的消息类型: ${String(msg.type)}`);
    return;
  }
  await handler(msg, conn, deps);
}
