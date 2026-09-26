import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIService } from '../server/aiService';
import { LocalStorageManager } from '../server/storage';
import { formatPlanTraceMarkdown } from '../src/context/AgentChatContext';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('AIService & Ops Prompt Generation', () => {
  let tempDir: string;
  let storage: LocalStorageManager;
  let aiService: AIService;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'monoterminal-ai-test-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(tempDir, { recursive: true });
    storage = new LocalStorageManager(tempDir);
    aiService = new AIService(storage);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should generate system prompt with terminal context and host profile', () => {
    const prompt = aiService.getSystemPrompt({
      currentUser: 'deploy',
      currentDir: '/var/log/nginx',
      osInfo: 'Ubuntu 22.04 LTS',
      terminalSnippet: 'nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)'
    });

    expect(prompt).toContain('当前用户: deploy');
    expect(prompt).toContain('当前工作目录: /var/log/nginx');
    expect(prompt).toContain('Address already in use');
    expect(prompt).toContain('可执行命令卡片');
  });

  it('should provide offline mock AI ops diagnosis with thinking and actionable codeblocks', async () => {
    let streamedThinking = '';
    let streamedContent = '';
    let isCompleted = false;

    await aiService.streamChat(
      [{ role: 'user', content: 'Nginx 80 端口启动报错，查下原因' }],
      {
        terminalSnippet: 'nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)',
        currentDir: '/etc/nginx',
        currentUser: 'root'
      },
      {
        onThinking: chunk => {
          streamedThinking += chunk;
        },
        onContent: chunk => {
          streamedContent += chunk;
        },
        onDone: (_content, _thinking) => {
          isCompleted = true;
        }
      }
    );

    expect(isCompleted).toBe(true);
    expect(streamedThinking.length).toBeGreaterThan(0);
    expect(streamedThinking).toContain('Nginx');
    expect(streamedContent).toContain('```bash');
    expect(streamedContent).toContain('nginx -t');
  });

  it('should format plan trace markdown and summarize final plan execution status', async () => {
    const trace = formatPlanTraceMarkdown({
      id: 'plan-123',
      sessionId: 'sess-1',
      goal: '检查当前目录文件与磁盘空间',
      status: 'completed',
      createdAt: 1000,
      updatedAt: 2000,
      steps: [
        {
          id: 'step-1',
          title: '列出当前目录文件',
          toolName: 'shell',
          input: { command: 'ls -la' },
          status: 'completed',
          outputSummary: 'total 12\ndrwxr-xr-x 2 root root 4096'
        }
      ]
    });

    expect(trace).toContain('[计划执行记录] 目标: 检查当前目录文件与磁盘空间');
    expect(trace).toContain('状态: 已完成');
    expect(trace).toContain('1. [completed] 列出当前目录文件 (shell) `ls -la`');
    expect(trace).toContain('输出结果: total 12');

    let summaryContent = '';
    await aiService.streamChat(
      [{ role: 'user', content: `请根据以下记录汇报最后执行情况：\n\n${trace}` }],
      { currentDir: '/root', currentUser: 'root' },
      {
        onContent: chunk => {
          summaryContent += chunk;
        }
      }
    );

    expect(summaryContent).toContain('计划执行完成报告');
    expect(summaryContent).toContain('检查当前目录文件与磁盘空间');
  });
});
