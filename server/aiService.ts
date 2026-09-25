import { LocalStorageManager } from './storage';
import { OpenAIProvider } from './agent/model/OpenAIProvider';
import { OllamaProvider } from './agent/model/OllamaProvider';
import { MockModelProvider } from './agent/model/MockModelProvider';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export interface StreamCallbacks {
  onThinking?: (delta: string) => void;
  onContent?: (delta: string) => void;
  onDone?: (fullContent: string, fullThinking?: string) => void;
  onError?: (error: Error) => void;
}

export interface OpsContext {
  terminalSnippet?: string; // Last 50 lines from terminal
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

export class AIService {
  private storage: LocalStorageManager;
  private openAiProvider = new OpenAIProvider();
  private ollamaProvider = new OllamaProvider();
  private mockProvider = new MockModelProvider();

  constructor(storage: LocalStorageManager) {
    this.storage = storage;
  }

  public getSystemPrompt(opsContext?: OpsContext): string {
    let contextStr = '';
    if (opsContext) {
      contextStr = `
=== 当前服务器与会话上下文 ===
- 当前用户: ${opsContext.currentUser || 'root'}
- 当前工作目录: ${opsContext.currentDir || '/etc/nginx'}
- 操作系统画像: ${opsContext.osInfo || 'Linux x86_64 Ubuntu 22.04 LTS'}
${
  opsContext.failedCommand
    ? `
- 异常命令生命周期 (OSC 133 语义感知):
  * 执行命令: ${opsContext.failedCommand.command || '(未知命令)'}
  * 退出状态码: ${opsContext.failedCommand.exitCode}
  * 命令隔离输出:\n\`\`\`text\n${opsContext.failedCommand.output || opsContext.terminalSnippet || ''}\n\`\`\`
`
    : opsContext.terminalSnippet
      ? `
- 终端最近输出 (背景上下文):\n\`\`\`text\n${opsContext.terminalSnippet}\n\`\`\`
`
      : ''
}
================================
`;
    }

    return `你是一款集成在 MonoTerminal 运维终端中的下一代 AI 智能运维专家 (SRE & Linux Assistant)。
你的职责：协助运维工程师排查故障、分析日志、生成精准安全的 Linux Shell 命令。

核心准则：
1. 分析问题必须直击要害，解释清晰简明。
2. 遇到故障诊断，请遵循“先排查、后修复、再验证”的原则。
3. 凡是给用户推荐执行的操作，必须用标准 Markdown 代码块包裹，指定 \`bash\` 或 \`shell\` 语言标签：
\`\`\`bash
command here
\`\`\`
4. 终端会自动将你的 Bash 代码块渲染为可穿梭交互的【可执行命令卡片】供用户一键在终端运行。因此请确保代码块中的命令语法完全准确。
5. 针对高危操作（如删除、格式化、修改底层权限）必须在正文中明确警示风险。
6. 【关键格式规范】：
- 代码块内部【绝对不要】写入以 '#' 开头的说明注释行，所有说明与解析请一律写在代码块外面的 Markdown 正文中，确保代码块干净利落，避免注释复制进终端。
- 如有多个不同目的的排查步骤，请分别放置在不同的独立代码块中，方便用户按需分步执行。

${contextStr}
`;
  }

  public async streamChat(
    messages: ChatMessage[],
    opsContext: OpsContext | undefined,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const settings = this.storage.getSettings();
    const activeProvider =
      settings.ai.providers.find(p => p.id === settings.ai.activeProvider) ||
      settings.ai.providers[0];

    if (!activeProvider || activeProvider.type === 'mock') {
      return this.mockProvider.streamChat(
        messages,
        callbacks,
        { id: activeProvider?.id || 'mock', type: 'mock' },
        opsContext?.terminalSnippet || opsContext?.failedCommand?.output || ''
      );
    }

    // A locked store cannot decrypt the API key — fail with a clear message
    if (this.storage.isLocked() && activeProvider.apiKeyEncrypted) {
      callbacks.onError?.(
        new Error('本地加密存储已被主密码锁定，请先在 设置 → 安全 中解锁（离线演示模型不受影响）。')
      );
      return;
    }

    const apiKey = activeProvider.apiKeyEncrypted
      ? this.storage.decrypt(activeProvider.apiKeyEncrypted)
      : '';

    if (activeProvider.type !== 'ollama' && !apiKey) {
      return this.mockProvider.streamChat(
        messages,
        callbacks,
        { id: activeProvider.id, type: 'mock' },
        opsContext?.terminalSnippet || opsContext?.failedCommand?.output || ''
      );
    }

    const baseUrl = (activeProvider.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = activeProvider.model || 'deepseek-chat';

    const systemPrompt = this.getSystemPrompt(opsContext);
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const config = {
      id: activeProvider.id,
      type: activeProvider.type,
      baseUrl,
      apiKey,
      model,
      temperature: activeProvider.temperature ?? 0.7
    };

    if (activeProvider.type === 'ollama') {
      return this.ollamaProvider.streamChat(fullMessages, callbacks, config);
    }

    return this.openAiProvider.streamChat(fullMessages, callbacks, config);
  }
}

