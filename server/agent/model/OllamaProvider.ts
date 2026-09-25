import { OpenAIProvider } from './OpenAIProvider';
import type {
  ModelMessage,
  ModelProvider,
  ModelProviderConfig,
  ModelStreamCallbacks
} from './ModelProvider';

/**
 * Ollama model provider supporting Ollama's OpenAI-compatible `/v1/chat/completions`
 * endpoint (default `http://127.0.0.1:11434/v1`).
 */
export class OllamaProvider implements ModelProvider {
  public readonly type = 'ollama';
  private readonly openAiCompat = new OpenAIProvider();

  public async streamChat(
    messages: ModelMessage[],
    callbacks: ModelStreamCallbacks,
    config: ModelProviderConfig
  ): Promise<void> {
    const rawBase = (config.baseUrl || 'http://127.0.0.1:11434/v1').replace(/\/+$/, '');
    const normalizedBase = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;

    return this.openAiCompat.streamChat(messages, callbacks, {
      ...config,
      baseUrl: normalizedBase,
      model: config.model || 'qwen2.5-coder:7b'
    });
  }
}
