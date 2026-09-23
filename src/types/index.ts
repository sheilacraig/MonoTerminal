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
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string;
  owner?: string;
}

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

export interface CommandSnippet {
  id: string;
  title: string;
  category: string;
  command: string;
  description?: string;
}
