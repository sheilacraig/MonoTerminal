export interface HostAsset {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent' | 'mock' | 'local';
  passwordEncrypted?: string;
  hasPassword?: boolean;
  plainPassword?: string;
  privateKeyPath?: string;
  passphraseEncrypted?: string;
  hasPassphrase?: boolean;
  plainPassphrase?: string;
  initialDir?: string;
  createdAt: number;
  lastConnectedAt?: number;
}

export interface FailedCommandInfo {
  command?: string;
  exitCode: number;
  output: string;
  cwd?: string;
  timestamp: number;
}

export interface SessionTab {
  id: string;
  hostId: string;
  title: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'busy';
  mode: 'shell' | 'agent';
  isAgentOpen?: boolean;
  agentWidth?: number;
  cwd: string;
  terminalContext: string; // Last 50 lines buffer for Agent shuttle
  unreadError?: string | null; // Trigger for [⚡ 报错排查 (Ctrl + \)] bubble
  lastFailedCommand?: FailedCommandInfo | null; // Exact command & output from OSC 133
}

export type { FileEntry, FileItem } from '../../shared/wsProtocol';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface AIProvider {
  id: string;
  name: string;
  type: 'deepseek' | 'ollama' | 'openai' | 'qwen' | 'moonshot' | 'custom' | 'mock';
  baseUrl: string;
  apiKeyEncrypted?: string;
  plainApiKey?: string;
  model: string;
  temperature: number;
}

export interface AppSettings {
  ai: {
    activeProvider: string;
    providers: AIProvider[];
  };
  shortcuts: {
    toggleMode: string;
    toggleSidebar: string;
    newTab: string;
    closeTab: string;
  };
  guardrail: {
    enabled: boolean;
    requireConfirmPhrase: boolean;
  };
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorBlink: boolean;
    scrollback: number;
    /** Selecting text with the mouse copies it to the clipboard immediately. */
    copyOnSelect?: boolean;
    /** Right-click pastes clipboard content (terminal) / at the caret (AI input). */
    rightClickPaste?: boolean;
  };
}

/**
 * Payload sent to POST /api/settings.
 * Note: If a future UI allows clearing all AI providers, it must set
 * `allowEmptyProviders: true` so the backend does not restore previous providers
 * as a protective fallback against empty payload overwrites.
 */
export interface UpdateSettingsPayload extends Partial<AppSettings> {
  allowEmptyProviders?: boolean;
}

export interface CommandSnippet {
  id: string;
  title: string;
  category: string;
  command: string;
  description?: string;
}
