# Changelog

All notable changes to **MonoTerminal** will be documented in this file.

## [v1.0.4] - 2026-09-26

### ✨ Features (新增特性)
- **左侧「会话 / 文件」双 Tab 一体化 Dock**：
  - 左侧面板重构为「会话 / 文件」双 Tab 共用 Dock，统一承载主机资产分组树（支持搜索过滤、双击当前标签连接、中键/Ctrl+双击新标签打开、跨分组拖拽移动、右键快捷菜单）与 SFTP/本地文件管理器。
  - 在「会话」Dock 底部集成醒目的靛蓝渐变「AI 与系统设置」药丸按钮（带在线状态绿点），并精简顶部导航栏（移除命令库、产品介绍与重复的 AI 助手切换按钮）。
  - 移除默认预设中的「运维沙盒」主机项及「会话」Tab 顶部的快速连接输入框，界面更加清爽克制。
- **AI 助手「计划执行」历史留痕与大模型执行总结报告**：
  - 在「计划执行」模式下，用户发起的目标与内联 `AgentPlanPanel` 步骤执行轨迹卡片完整保存在对话历史流中。
  - 计划执行结束（完成/失败/取消）后，自动将完整步骤输入、退出码、标准输出/错误与校验结果发送给大模型，流式生成最终执行情况总结报告。
- **自主运维 Agent 运行时与领域分层架构**：
  - 新增 `server/domain`、`server/application`、`server/infrastructure` 与 `server/agent` 四层架构，支持 **Plan-Execute-Verify 自主巡检与排障闭环**、**Human-in-the-Loop 高危操作内联审批卡片** 与 **会话统一时间线面板**。
  - 新增 **Qwen 官方 API**（通义千问 DashScope 兼容端点，默认模型 `qwen-plus`），并支持 `AgentInputBar` 高度拖拽调节。

### 🛡️ Security & Reliability (安全与可靠性加固)
- **P1-1 · Agent 广播输出净化，防止污染 OSC 133/7 语义通道**：
  - 新增 `sanitizeBroadcastTerminalOutput`，在 `DefaultSessionManager.broadcastTerminalData` 与 `ShellTool` 广播出口剥离所有 7-bit/8-bit OSC、DCS/SOS/PM/APC 控制序列及尾部未闭合转义符，防止命令输出伪造退出码或工作目录。
- **P1-2 · 交互式 PowerShell 缺失 OSC 133 Hook 快速探测与会话级降级**：
  - `ShellTool` 新增命令回显后无 `133;C` 快速探测（默认 `800ms`）与裸 `PS ...>` 提示符提前返回探测，自动将受执行策略拦截或无 Hook 的会话降级为后台隔离执行模式，彻底避免多步计划连环超时。
- **P2 细节闭环**：
  - `Planner.createPlanWithModel` 在模型调用失败时显式返回 `createFailedPlan`，不再静默降级为启发式假步骤；
  - `SessionContext` 与 `TerminalView` 连接状态从 `'connecting'` 起步，待收到 `term:ready` 或首帧 `term:data` 后再转为 `'connected'`，收到 `term:error` 时转为 `'disconnected'`；
  - `formatSshCommand` 按平台返回本地 Shell 命令（Windows 返回 `'powershell'`，macOS/Linux 返回 `'$SHELL'`）；
  - 将构建产物 `dist-server/` 加入 `.gitignore` 并移出 Git 跟踪。

### 🧪 Tests & Docs (测试与文档)
- 全量自动化测试扩充至 **19 个测试套件 / 182 项用例** 100% 通过。
- 同步更新 GitHub Pages 落地页（`LandingPage.tsx`）交互预览图、`README.md` 与 `CHANGELOG.md`。

---

## [v1.0.3] - 2026-09-24
- 集成 Shell Integration 语义感知（OSC 133 / OSC 7），实现真实命令生命周期与退出码捕获。
- 修复 Sudo 提权安全防护、PAM 时延竞态及选中即复制 / 右键粘贴体验。
- 闭环两轮 Code Review 安全与可靠性缺陷，完善桌面端打包与自检脚本。
