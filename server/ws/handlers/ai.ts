import type { AiChatMessage } from '../../../shared/wsProtocol';
import type { WsHandler } from '../types';

export const handleAiChat: WsHandler<AiChatMessage> = async (msg, conn, deps) => {
  const { requestId } = msg;
  await deps.aiService.streamChat(msg.messages, msg.opsContext, {
    onThinking: delta => conn.send({ type: 'ai:thinking', requestId, delta }),
    onContent: delta => conn.send({ type: 'ai:content', requestId, delta }),
    onDone: (fullContent, fullThinking) =>
      conn.send({ type: 'ai:done', requestId, fullContent, fullThinking }),
    onError: err => conn.send({ type: 'ai:error', requestId, error: err.message })
  });
};
