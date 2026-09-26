import type {
  ModelMessage,
  ModelProvider,
  ModelProviderConfig,
  ModelStreamCallbacks
} from './ModelProvider';

export class MockModelProvider implements ModelProvider {
  public readonly type = 'mock';

  public async streamChat(
    messages: ModelMessage[],
    callbacks: ModelStreamCallbacks,
    _config: ModelProviderConfig,
    contextHint = ''
  ): Promise<void> {
    const userMsg = messages[messages.length - 1]?.content || '';
    const sysMsg = messages.find(m => m.role === 'system')?.content || '';
    const lowerAll = `${userMsg} ${contextHint} ${sysMsg}`.toLowerCase();

    let thinking = '正在分析运维现场...\n';
    let content: string;

    if (userMsg.includes('[计划执行记录]')) {
      thinking =
        '正在汇总计划执行结果...\n1. 核对各步骤退出状态与终端回显数据。\n2. 评估目标达成情况并生成最终执行报告。';
      const isCompleted = userMsg.includes('状态: 已完成');
      const isCancelled = userMsg.includes('状态: 已取消');
      const statusIcon = isCompleted ? '✅' : isCancelled ? '⏹️' : '⚠️';
      const statusTitle = isCompleted
        ? '计划执行完成报告'
        : isCancelled
          ? '计划已中止报告'
          : '计划执行异常报告';
      const traceMatch = userMsg.match(/\[计划执行记录\][\s\S]*?(?=\n\n请基于以上|$)/);
      const traceBlock = traceMatch ? traceMatch[0].trim() : userMsg;
      content = [
        `### ${statusIcon} ${statusTitle}`,
        '',
        isCompleted
          ? '所有计划步骤均已按序执行完毕并通过校验，以下是本次执行的汇总情况：'
          : isCancelled
            ? '本次计划在执行过程中已被手动中止，以下是截至中止时的执行记录：'
            : '计划执行过程中遇到步骤异常，后续待执行步骤已自动跳过，详情如下：',
        '',
        '```text',
        traceBlock,
        '```',
        '',
        isCompleted
          ? '**结论**：目标任务已顺利完成。如需进一步操作或深入排查，请继续在下方输入指令。'
          : '**建议**：请检查上方报错信息或终端输出，确认权限、路径或服务状态后重新发起计划执行。'
      ].join('\n');
    } else if (lowerAll.includes('nginx') || lowerAll.includes('80') || lowerAll.includes('443')) {
      thinking +=
        '1. 检测到与 Nginx 服务或 Web 端口相关的问题。\n2. 需先测试配置文件语法，再检查端口占用情况与服务系统日志。\n3. 生成精准的安全排查与恢复命令。';
      content = `### 🔍 Nginx 状态排查与修复建议

根据诊断，Nginx 服务启动异常通常有以下两个常见诱因：
1. **/etc/nginx/nginx.conf** 存在语法错误或端口冲突（如 80 端口被占用）。
2. Nginx 主进程缺少 PID 文件写入权限或日志目录无权限。

#### 建议执行排查命令：

1. **检查 Nginx 配置文件语法有效性**：
\`\`\`bash
nginx -t
\`\`\`

2. **查看 80 端口占用情况**：
\`\`\`bash
ss -tulpn | grep :80 || netstat -tulpn | grep :80
\`\`\`

3. **查看最近 30 行 systemd 启动失败详细日志**：
\`\`\`bash
journalctl -u nginx.service -n 30 --no-pager
\`\`\`

如果配置测试通过，可直接重新加载 Nginx 服务：
\`\`\`bash
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

1. **查找占用指定端口的进程 (例如 8080 或 80)**：
\`\`\`bash
lsof -i :8080 -P -n || ss -lptn 'sport = :8080'
\`\`\`

2. **确认占用该进程的 PID 之后，平滑终止目标进程** (请替换 <PID> 为实际进程号)：
\`\`\`bash
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

1. **查看当前登录用户与属组**：
\`\`\`bash
id && whoami
\`\`\`

2. **查看目标路径的权限属性与属主**：
\`\`\`bash
ls -ld /etc/nginx/
\`\`\`

3. **使用 sudo 提权排查**：
\`\`\`bash
sudo ls -la /var/log/nginx/
\`\`\`
`;
    } else if (lowerAll.includes('docker') || lowerAll.includes('container')) {
      thinking += '1. 容器环境相关问题。\n2. 检查 Docker Daemon 状态及异常退出的容器。';
      content = `### 🐳 Docker 容器状态诊断

请检查 Docker 服务是否存活以及最近崩溃退出的容器列表：

1. **查看所有容器运行状态 (包含已退出容器)**：
\`\`\`bash
docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"
\`\`\`

2. **查看最近退出的容器的日志** (替换 <container_name>)：
\`\`\`bash
docker logs --tail 50 -f <container_name>
\`\`\`
`;
    } else {
      thinking += '1. 接收到运维辅助请求。\n2. 综合当前上下文，输出通用的系统健康巡检排查方案。';
      content = `### 📋 Linux 系统运行状态健康巡检

针对您提到的情况，建议首先执行以下系统基线命令排查 CPU、内存、磁盘与活跃负载：

1. **查看系统实时负载与 CPU/内存使用情况**：
\`\`\`bash
top -b -n 1 | head -n 20
\`\`\`

2. **查看磁盘空间使用率**：
\`\`\`bash
df -h
\`\`\`

3. **查看系统关键服务与网络监听连接**：
\`\`\`bash
ss -tulpn | head -n 15
\`\`\`

您可以点击上方命令卡片中的 **[ 立即在终端运行 ]** 直接在终端执行，回显结果将实时显示！
`;
    }

    const thinkChunks = thinking.split('\n');
    for (const chunk of thinkChunks) {
      callbacks.onThinking?.(chunk + '\n');
      await new Promise(r => setTimeout(r, 60));
    }

    const contentChunks = content.split('\n');
    for (const chunk of contentChunks) {
      callbacks.onContent?.(chunk + '\n');
      await new Promise(r => setTimeout(r, 40));
    }

    callbacks.onDone?.(content, thinking);
  }
}
