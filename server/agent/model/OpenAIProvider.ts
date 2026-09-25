import { toError } from '../../../shared/errors';
import { ThinkTagParser } from '../../thinkTagParser';
import type {
  ModelMessage,
  ModelProvider,
  ModelProviderConfig,
  ModelStreamCallbacks
} from './ModelProvider';

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120_000;

export class OpenAIProvider implements ModelProvider {
  public readonly type = 'openai';

  public async streamChat(
    messages: ModelMessage[],
    callbacks: ModelStreamCallbacks,
    config: ModelProviderConfig
  ): Promise<void> {
    const baseUrl = (config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = config.model || 'deepseek-chat';
    const apiKey = config.apiKey || '';
    const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), idleTimeoutMs);
    };

    const onExternalAbort = () => controller.abort();
    config.abortSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      resetWatchdog();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
          temperature: config.temperature ?? 0.7
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API 返回错误 (${response.status}): ${errText}`);
      }

      if (!response.body) {
        throw new Error('AI API 未返回可读流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullContent = '';
      let fullThinking = '';
      let buffer = '';

      const thinkParser = new ThinkTagParser();
      const emitSegments = (seg: { content: string; thinking: string }) => {
        if (seg.thinking) {
          fullThinking += seg.thinking;
          callbacks.onThinking?.(seg.thinking);
        }
        if (seg.content) {
          fullContent += seg.content;
          callbacks.onContent?.(seg.content);
        }
      };

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetWatchdog();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
            break outer;
          }

          try {
            const data = JSON.parse(trimmed.slice(5).trim());
            const delta = data.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content;
              callbacks.onThinking?.(delta.reasoning_content);
            }

            if (delta.content) {
              emitSegments(thinkParser.feed(delta.content));
            }
          } catch {
            // Ignore parse errors on chunk boundaries
          }
        }
      }

      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }

      emitSegments(thinkParser.flush());
      callbacks.onDone?.(fullContent, fullThinking);
    } catch (err) {
      callbacks.onError?.(toError(err));
    } finally {
      if (watchdog) clearTimeout(watchdog);
      config.abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
}
