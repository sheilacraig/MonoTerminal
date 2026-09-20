import { useState, useCallback } from 'react';
import { ChatMessage } from '../types';
import { useWebSocket } from '../context/WebSocketContext';
import { useSession } from '../context/SessionContext';

const INITIAL_GREETING: ChatMessage = {
  id: 'init-msg',
  role: 'assistant',
  content: '👋 您好！我是 MonoTerminal 智能运维助手。\n已就绪连接至当前服务器。您可以随时向我咨询故障排查、日志分析或命令生成。按 **[Ctrl + \\]** 可随时在同一窗口展开或收起助手！',
  timestamp: Date.now()
};

export function useAgentChat() {
  const { activeSession, executeCommandWithGuardrail } = useSession();
  const { streamAI, sendTermInput } = useWebSocket();

  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_GREETING]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<{ [msgId: string]: boolean }>({});
  const [commandExplanations, setCommandExplanations] = useState<{ [cmdKey: string]: string }>({});

  const toggleThinking = useCallback((msgId: string) => {
    setExpandedThinking(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!content.trim() || isStreaming || !activeSession) return;

    const userMsgId = 'msg-' + Date.now();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: content.trim(),
      timestamp: Date.now()
    };

    const assistantMsgId = 'msg-' + (Date.now() + 1);
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      isStreaming: true
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const opsContext = {
      terminalSnippet: activeSession.terminalContext || undefined,
      currentDir: activeSession.cwd,
      currentUser: 'root',
      osInfo: 'Ubuntu 22.04 LTS x86_64'
    };

    const historyForAI = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content
    }));

    streamAI(historyForAI, opsContext, {
      onThinking: (delta) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId ? { ...m, thinking: (m.thinking || '') + delta } : m
          )
        );
      },
      onContent: (delta) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
          )
        );
      },
      onDone: (fullContent, fullThinking) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: fullContent,
                  thinking: fullThinking || m.thinking,
                  isStreaming: false
                }
              : m
          )
        );
        setIsStreaming(false);
      },
      onError: (err) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content + `\n\n❌ 请求出错: ${err}`,
                  isStreaming: false
                }
              : m
          )
        );
        setIsStreaming(false);
      }
    });
  }, [messages, isStreaming, activeSession, streamAI]);

  // Execute in terminal
  const runCommand = useCallback((cmd: string) => {
    if (!activeSession) return;
    executeCommandWithGuardrail(cmd, () => {
      sendTermInput(activeSession.id, `${cmd}\r`);
    });
  }, [activeSession, executeCommandWithGuardrail, sendTermInput]);

  // Fill in terminal
  const fillCommand = useCallback((cmd: string) => {
    if (!activeSession) return;
    executeCommandWithGuardrail(cmd, () => {
      sendTermInput(activeSession.id, cmd);
    });
  }, [activeSession, executeCommandWithGuardrail, sendTermInput]);

  // Explain command
  const explainCommand = useCallback((cmd: string) => {
    const lines = cmd.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    const cleanCmd = lines[0] || cmd;
    const parts = cleanCmd.split(/\s+/);
    const mainBin = parts[0];
    const flags = parts.slice(1);

    let explanation = `📌 命令 **${mainBin}** 结构解析：\n`;
    if (mainBin === 'systemctl') {
      explanation += `• 操作服务单元控制器：对系统服务进行管理与排障。\n`;
    } else if (mainBin === 'nginx') {
      explanation += `• Nginx 核心程序：-t 参数代表语法合规性检查。\n`;
    } else if (mainBin === 'ss' || mainBin === 'netstat') {
      explanation += `• 网络套接字诊断工具：-tulpn 参数代表查看正在监听的 TCP/UDP 端口并显示 PID/进程名。\n`;
    } else if (mainBin === 'lsof') {
      explanation += `• 列出打开的文件/网络连接：-i 参数指定监听端口。\n`;
    } else {
      explanation += `• 参数列表: ${flags.join(', ') || '无额外参数'}\n`;
    }
    explanation += `• 建议在生产环境中核实后再行落地。`;

    setCommandExplanations(prev => ({ ...prev, [cmd]: explanation }));
  }, []);

  return {
    messages,
    isStreaming,
    expandedThinking,
    commandExplanations,
    toggleThinking,
    sendMessage,
    runCommand,
    fillCommand,
    explainCommand
  };
}
