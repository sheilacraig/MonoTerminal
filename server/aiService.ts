import { LocalStorageManager } from './storage';
import { OpenAIProvider } from './agent/model/OpenAIProvider';
import { OllamaProvider } from './agent/model/OllamaProvider';
import { MockModelProvider } from './agent/model/MockModelProvider';
import type { ModelMessage } from './agent/model/ModelProvider';

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

    const isWindows =
      Boolean(opsContext?.osInfo && /windows|powershell/i.test(opsContext.osInfo)) ||
      Boolean(opsContext?.currentDir && /^[a-zA-Z]:[\\/]/.test(opsContext.currentDir));
    const shellLabel = isWindows ? 'powershell' : 'bash';
    const shellDesc = isWindows ? 'Windows PowerShell 命令' : 'Linux Shell 命令';

    return `你是一款集成在 MonoTerminal 运维终端中的下一代 AI 智能运维专家 (SRE & Shell Assistant)。
你的职责：协助工程师排查故障、分析日志、生成精准安全的 ${shellDesc}。

核心准则：
1. 分析问题必须直击要害，解释清晰简明。
2. 遇到故障诊断，请遵循“先排查、后修复、再验证”的原则。
3. 凡是给用户推荐执行的操作，必须用标准 Markdown 代码块包裹，指定 \`${shellLabel}\` 或 \`shell\` 语言标签（严格匹配当前操作系统与终端环境）：
\`\`\`${shellLabel}
command here
\`\`\`
4. 终端会自动将你的代码块渲染为可穿梭交互的【可执行命令卡片】供用户一键在终端运行。因此请确保代码块中的命令语法完全符合当前系统 (${isWindows ? 'Windows PowerShell 5.1+' : 'Linux Bash'})。
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

  /** Generate non-chat model output for structured agent planning. */
  public async generateStructuredText(messages: ModelMessage[]): Promise<string> {
    const settings = this.storage.getSettings();
    const activeProvider =
      settings.ai.providers.find(p => p.id === settings.ai.activeProvider) ||
      settings.ai.providers[0];

    if (!activeProvider || activeProvider.type === 'mock') {
      throw new Error('自主计划需要配置 AI API 或连接 Ollama；当前使用的演示模型不支持工具计划。');
    }
    if (this.storage.isLocked() && activeProvider.apiKeyEncrypted) {
      throw new Error('本地加密存储已锁定，请先解锁 AI API Key。');
    }

    const apiKey = activeProvider.apiKeyEncrypted
      ? this.storage.decrypt(activeProvider.apiKeyEncrypted)
      : '';
    if (activeProvider.type !== 'ollama' && !apiKey) {
      throw new Error('当前 AI 服务没有可用的 API Key，请在设置中配置后重试。');
    }

    const baseUrl = (activeProvider.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const provider = activeProvider.type === 'ollama' ? this.ollamaProvider : this.openAiProvider;
    const config = {
      id: activeProvider.id,
      type: activeProvider.type,
      baseUrl,
      apiKey,
      model: activeProvider.model || 'deepseek-chat',
      temperature: 0.1,
      idleTimeoutMs: 120_000
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let streamedText = '';
      void provider.streamChat(
        messages,
        {
          onContent: delta => {
            streamedText += delta;
          },
          onDone: fullContent => {
            if (settled) return;
            settled = true;
            const result = fullContent || streamedText;
            if (!result.trim()) reject(new Error('AI 模型返回了空的计划内容。'));
            else resolve(result);
          },
          onError: error => {
            if (settled) return;
            settled = true;
            reject(error);
          }
        },
        config
      ).catch(error => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  }
}

