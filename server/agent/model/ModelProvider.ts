export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export interface ModelStreamCallbacks {
  onThinking?: (delta: string) => void;
  onContent?: (delta: string) => void;
  onDone?: (fullContent: string, fullThinking?: string) => void;
  onError?: (error: Error) => void;
}

export interface ModelProviderConfig {
  id: string;
  type: 'openai' | 'ollama' | 'mock' | string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  idleTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface ModelProvider {
  readonly type: string;
  streamChat(
    messages: ModelMessage[],
    callbacks: ModelStreamCallbacks,
    config: ModelProviderConfig
  ): Promise<void>;
}
