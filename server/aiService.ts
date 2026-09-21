import { LocalStorageManager } from './storage';
import { toError } from '../shared/errors';
import { ThinkTagParser } from './thinkTagParser';

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
}

export class AIService {
  private storage: LocalStorageManager;

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
  opsContext.terminalSnippet
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
# 说明
command here
\`\`\`
4. 终端会自动将你的 Bash 代码块渲染为可穿梭交互的【可执行命令卡片】供用户一键回切 Shell 执行。因此请确保代码块中的命令语法完全准确。
5. 针对高危操作（如删除、格式化、修改底层权限）必须在正文中明确警示风险。

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
      // Run offline Mock AI engine
      return this.handleMockChat(messages, opsContext, callbacks);
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
    const baseUrl = (activeProvider.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const model = activeProvider.model || 'deepseek-chat';

    const systemPrompt = this.getSystemPrompt(opsContext);
    const fullMessages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // Idle watchdog: if the upstream stalls (no bytes for STREAM_IDLE_TIMEOUT_MS)
    // abort the fetch. Without this, a misbehaving provider that keeps the TCP
    // socket open but stops sending — or that never emits `data: [DONE]` —
    // would leave `reader.read()` blocked forever, callbacks.onDone would
    // never fire, and the frontend spinner would hang.
    const STREAM_IDLE_TIMEOUT_MS = 120_000;
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    };

    try {
      resetWatchdog();
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: fullMessages,
          stream: true,
          temperature: activeProvider.temperature ?? 0.7
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

      // Cross-chunk state machine for <think> tags — a tag split across
      // SSE deltas (e.g. "<thi" + "nk>") is buffered, never lost
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

      // `outer:` label so `data: [DONE]` breaks BOTH the per-line for-loop
      // and the read-loop. Without the label, `break` only exits the inner
      // for, the outer while calls `reader.read()` again, and on HTTP
      // keep-alive connections (where the server does NOT close the socket
      // after [DONE]) that read blocks forever.
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

            // Handle reasoning_content (DeepSeek-R1 / o1 / kimi)
            if (delta.reasoning_content) {
              fullThinking += delta.reasoning_content;
              callbacks.onThinking?.(delta.reasoning_content);
            }

            // Handle standard content (which may contain <think> tags)
            if (delta.content) {
              emitSegments(thinkParser.feed(delta.content));
            }
          } catch {
            // Ignore parse errors on chunk boundaries
          }
        }
      }

      // Proactively release the underlying TCP connection. On HTTP keep-alive
      // the socket would otherwise be returned to the pool with unread bytes
      // pending, or worse, remain half-open. cancel() also unblocks any
      // concurrent reader.read() that might still be parked.
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }

      // End of stream: emit any retained trailing fragment as plain text
      emitSegments(thinkParser.flush());

      callbacks.onDone?.(fullContent, fullThinking);
    } catch (err) {
      callbacks.onError?.(toError(err));
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }

  /**
   * High-quality offline Mock AI assistant.
   * Analyzes the context and error messages from the terminal, generates thinking stream
   * and practical ops shell commands with actionable codeblocks.
   */
  private async handleMockChat(
    messages: ChatMessage[],
    opsContext: OpsContext | undefined,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const userMsg = messages[messages.length - 1]?.content || '';
    const termContext = opsContext?.terminalSnippet || '';
    const lowerAll = `${userMsg} ${termContext}`.toLowerCase();

    let thinking = '正在分析运维现场...\n';
    // Assigned in every branch of the if/else chain below
    let content: string;

    if (lowerAll.includes('nginx') || lowerAll.includes('80') || lowerAll.includes('443')) {
      thinking +=
        '1. 检测到与 Nginx 服务或 Web 端口相关的问题。\n2. 需先测试配置文件语法，再检查端口占用情况与服务系统日志。\n3. 生成精准的安全排查与恢复命令。';
      content = `### 🔍 Nginx 状态排查与修复建议

根据诊断，Nginx 服务启动异常通常有以下两个常见诱因：
1. **/etc/nginx/nginx.conf** 存在语法错误或端口冲突（如 80 端口被占用）。
2. Nginx 主进程缺少 PID 文件写入权限或日志目录无权限。

#### 建议执行排查命令：

\`\`\`bash
# 1. 检查 Nginx 配置文件语法有效性
nginx -t
\`\`\`

\`\`\`bash
# 2. 查看 80 端口占用情况
ss -tulpn | grep :80 || netstat -tulpn | grep :80
\`\`\`

\`\`\`bash
# 3. 查看最近 30 行 systemd 启动失败详细日志
journalctl -u nginx.service -n 30 --no-pager
\`\`\`

如果配置测试通过，可直接重新加载 Nginx 服务：
\`\`\`bash
# 优雅重新加载配置
systemctl reload nginx || systemctl restart nginx
\`\`\`
`;
    } else if (
      lowerAll.includes('port') ||
      lowerAll.includes('占用') ||
      lowerAll.includes('bind') ||
      lowerAll.includes('address already in use')
    ) {
      thinking +=
        '1. 识别出典型的 Address already in use / 端口绑定冲突报错。\n2. 需要查询占用特定端口的进程 PID，并安全停止该进程。';
      content = `### ⚠️ 端口冲突分析与处理方案

错误表明目标端口已被其他进程绑定。请执行以下命令定位并释放端口：

\`\`\`bash
# 查找占用指定端口的进程 (例如 8080 或 80)
lsof -i :8080 -P -n || ss -lptn 'sport = :8080'
\`\`\`

确认占用该端口的 PID 之后，可选择平滑终止进程：
\`\`\`bash
# 安全终止目标进程 (请替换 <PID> 为实际进程号)
kill -15 <PID>
\`\`\`
`;
    } else if (
      lowerAll.includes('permission denied') ||
      lowerAll.includes('权限不足') ||
      lowerAll.includes('denied')
    ) {
      thinking +=
        '1. 检测到 Permission Denied 权限不足报错。\n2. 检查当前执行用户、文件权限及所属组。';
      content = `### 🛡️ 权限不足 (Permission Denied) 诊断

当前尝试访问或写入的文件/目录存在权限限制。

\`\`\`bash
# 查看当前登录用户与属组
id && whoami
\`\`\`

\`\`\`bash
# 查看目标路径的权限属性与属主
ls -ld /etc/nginx/
\`\`\`

若是生产维护环境，推荐使用 sudo 或切换特权身份执行：
\`\`\`bash
# 使用 sudo 提权排查
sudo ls -la /var/log/nginx/
\`\`\`
`;
    } else if (lowerAll.includes('docker') || lowerAll.includes('container')) {
      thinking += '1. 容器环境相关问题。\n2. 检查 Docker Daemon 状态及异常退出的容器。';
      content = `### 🐳 Docker 容器状态诊断

请检查 Docker 服务是否存活以及最近崩溃退出的容器列表：

\`\`\`bash
# 查看所有容器运行状态 (包含已退出容器)
docker ps -a --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
\`\`\`

\`\`\`bash
# 查看最近退出的容器的日志 (替换 <container_name>)
docker logs --tail 50 -f <container_name>
\`\`\`
`;
    } else {
      thinking += '1. 接收到运维辅助请求。\n2. 综合当前上下文，输出通用的系统健康巡检排查方案。';
      content = `### 📋 Linux 系统运行状态健康巡检

针对您提到的情况，建议首先执行以下系统基线命令排查 CPU、内存、磁盘与活跃负载：

\`\`\`bash
# 查看系统实时负载与 CPU/内存使用情况
top -b -n 1 | head -n 20
\`\`\`

\`\`\`bash
# 查看磁盘空间使用率
df -h
\`\`\`

\`\`\`bash
# 查看系统关键服务与网络监听连接
ss -tulpn | head -n 15
\`\`\`

您可以点击上方命令卡片中的 **[ ↵ 立即运行并切回 ]** 直接在 Shell 终端执行，回显结果将实时显示！
`;
    }

    // Stream thinking first
    const thinkChunks = thinking.split('\n');
    for (const chunk of thinkChunks) {
      callbacks.onThinking?.(chunk + '\n');
      await new Promise(r => setTimeout(r, 60));
    }

    // Stream content
    const contentChunks = content.split('\n');
    for (const chunk of contentChunks) {
      callbacks.onContent?.(chunk + '\n');
      await new Promise(r => setTimeout(r, 40));
    }

    callbacks.onDone?.(content, thinking);
  }
}
