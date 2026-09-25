# Changelog

All notable changes to **MonoTerminal** will be documented in this file.

## [Unreleased] - 2026-09-25

### ✨ Features (新增特性)
- **自主运维 Agent 运行时与领域分层架构**：
  - 新增 `server/domain`、`server/application`、`server/infrastructure` 与 `server/agent` 四层架构，统一抽象 `Session`、`TerminalProvider` 与 `FileSystemProvider`（支持 Local / SSH / Mock 三端一致调度）。
  - 新增 **Plan-Execute-Verify 自主巡检与排障闭环**（`Planner`、`AgentRuntime`、`VerifierRegistry`、`AgentPlanPanel`），支持命令退出码校验、文件变更校验（内部校验静默读取，不污染时间线）与服务存活状态校验。
  - 新增 **Human-in-the-Loop 高危操作内联审批卡片**（`GuardrailPipeline`、`ApprovalManager`、`ApprovalCard`）及沙盒路径逃逸防护（拦截路径穿越、`..` 及敏感系统文件写入）。
  - 新增 **会话统一时间线面板**（`CommandEngine`、`ContextEngine`、`TimelinePanel`），实时聚合终端命令、文件操作与 Agent 活动轨迹，并支持断线重连后的会话状态恢复。
- **大模型接入扩展**：
  - 在设置面板中新增 **Qwen 官方 API**（通义千问 DashScope 兼容端点，默认模型 `qwen-plus`），并支持既有 `settings.json` 自动平滑迁移。
- **AI 助手输入框高度拖拽调节**：
  - `AgentInputBar` 顶部新增拖拽调节手柄（`cursor-row-resize`），支持手动上下拖动调整提问输入框高度（`56px ~ 380px`）。

### 💄 UI & UX Improvements (体验优化)
- **SFTP 侧边栏默认收起与精简**：
  - SFTP 远程文件面板默认收起为窄边栏，由用户点击或按 `Ctrl + B` 主动展开，最大化终端可视区域。
  - 精简 SFTP 收起态侧边栏图标，仅保留顶部展开按钮，移除多余的文件夹与上传图标。
- **AI 助手面板与状态栏精简**：
  - 移除 AI 助手顶部栏冗长的模型提示与「已捕获最近 50 行终端上下文」标签，将 `MonoTerminal Ops Agent` 标题提至顶部栏并去除气泡上方重复标题。
  - 移除设置面板中的「内置运维专家（离线演示）」标签页及底部状态栏的模型名称提示（未配置云端 API Key 时后台仍自动回退至离线诊断引擎兜底）。

### 🐛 Bug Fixes (问题修复)
- **快捷键显示转义修复**：
  - 修复 AI 助手默认欢迎语中 `**[Ctrl + \]**` 因 Markdown 转义 `\]` 导致反斜杠 `\` 丢失的问题。
- **设置弹窗状态同步**：
  - 修复 `SettingsModal` 打开时未实时同步最新 AI 提供商列表与激活状态的问题。
- **Shell Integration & SFTP 细节加固**：
  - 加固 PowerShell OSC 133 注入脚本及长行折行拼接处理；完善 SFTP 目录树与 WebSocket 协议校验。

### 🧪 Tests & Docs (测试与文档)
- 新增 `agentSecurityAndTools`、`commandAndContext`、`plannerAndVerifier`、`sessionDomain`、`sessionResume` 等测试套件，全量自动化测试扩充至 **18 个测试文件 / 168 项用例** 100% 通过。
- 同步更新 `README.md` 与 `index.html` 的功能特性、目录结构、架构拓扑图及关键词描述。

---

## [v1.0.3] - 2026-09-24
- 集成 Shell Integration 语义感知（OSC 133 / OSC 7），实现真实命令生命周期与退出码捕获。
- 修复 Sudo 提权安全防护、PAM 时延竞态及选中即复制 / 右键粘贴体验。
- 闭环两轮 Code Review 安全与可靠性缺陷，完善桌面端打包与自检脚本。
