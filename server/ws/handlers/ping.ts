import type { PingMessage } from '../../../shared/wsProtocol';
import type { WsHandler } from '../types';

export const handlePing: WsHandler<PingMessage> = (msg, conn) => {
  conn.send({ type: 'pong', clientTime: msg.timestamp, serverTime: Date.now() });
};
