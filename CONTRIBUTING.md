# 贡献指南

感谢你愿意为 **MonoTerminal** 贡献力量！本文档帮助你快速搭建开发环境、了解协作规范，并顺利提交第一个 Pull Request。

---

## 🧰 环境准备

- **Node.js** 20 及以上（推荐 22 LTS，与项目 `package.json` 中的 `engines` 严格对齐）
- **npm**（随 Node.js 安装）

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/<your-name>/MonoTerminal.git
cd MonoTerminal

# 2. 安装依赖
npm install

# 3. 启动开发环境
npm run server   # 终端 1：后端开发服务 (端口 3001)
npm run dev      # 终端 2：前端开发服务器 (端口 5173，已配置接口代理)
```

打开 `http://localhost:5173` 即可开发调试。若只想快速体验完整生产产物，可执行 `npm run serve`（或 `npm run build:all && npm start`）后访问 `http://localhost:3001`。

---

## 🌿 分支与提交规范

- **主分支**：`main`（受 CI 保护，禁止直接强推）。
- **功能分支**：从 `main` 切出，命名建议 `feat/<简述>`、`fix/<简述>`、`docs/<简述>`。
- **提交信息**：建议遵循 [Conventional Commits](https://www.conventionalcommits.org/) 风格：

  | 前缀 | 用途 |
  | :--- | :--- |
  | `feat:` | 新功能 |
  | `fix:` | 缺陷修复 |
  | `docs:` | 文档变更 |
  | `refactor:` | 重构（不改变外部行为） |
  | `test:` | 新增或修改测试 |
  | `chore:` | 构建/工具/依赖等杂项 |

  示例：`feat(terminal): 集成 OSC 133 语义感知退出码捕获`

---

## ✅ 提交前自检

CI（`.github/workflows/ci.yml`）会在 PR 与 push 到 `main` 时执行门禁，请在本地先确保通过：

```bash
npm run typecheck       # tsc --noEmit 类型检查
npm run lint            # ESLint（要求 0 error）
npm test                # Vitest 单元/集成测试（140 项全量通过）
npm run build:all       # 生产构建验证（同时构建前端与后端）
npm run verify:source   # 源码全链路自检（鉴权、白名单、WS握手及产物特征验证）
```

代码格式化统一使用 Prettier：

```bash
npm run format        # 写入格式化
npm run format:check  # 仅检查（CI 友好）
```

> [!NOTE]
> ESLint 目前允许少量不影响安全与功能的 warning，但**严禁引入新的 error**。

---

## 📁 目录结构速览

```
MonoTerminal/
├── src/                  # 前端 (React + Tailwind + xterm.js)
│   ├── components/       # 界面组件 (终端视图、AI 对话窗、SFTP/本地文件树、提权浮层等)
│   ├── context/          # 全局状态 (Session / Settings / WebSocket / AgentChat)
│   ├── services/         # 业务服务 (terminalAuth 提权状态机与敏感凭据管控)
│   ├── utils/            # 实用工具 (OSC 133/7 语义感知、剪贴板作用域、命令清洗)
│   └── hooks/            # 业务 Hook (useAgentChat / useSftp)
├── shared/               # 前后端共享 (guardrail 规则、id 生成、wsProtocol、errors)
├── server/               # 后端 (Node.js + Express + WebSocket + ssh2)
│   ├── localPtyManager.ts# 本机伪终端管理器 (基于 node-pty)
│   ├── localFsManager.ts # 本机文件系统管理器 (Local FS 读写与原子保存)
│   ├── sshManager.ts     # SSH2 连接池与远程 SFTP 管理
│   ├── mockServer.ts     # 内置虚拟 Linux 沙盒
│   ├── aiService.ts      # 大模型中继接口 (Ollama / DeepSeek / OpenAI 等)
│   ├── storage.ts        # 本地 AES-256-GCM 硬件派生加密存储与配置管理
│   ├── auth.ts           # HTTP / WebSocket 安全与白名单鉴权中间件
│   ├── ws/               # WebSocket 路由与处理器 (term, sftp, ai)
│   └── routes/           # REST 路由 (hosts, settings, guardrail, security)
├── electron/             # Electron 桌面客户端外壳 (main.cjs)
├── scripts/              # 维护与自检脚本 (doctor, verify-source, verify-packaged)
├── tests/                # Vitest 单元与集成测试用例
└── docs/                 # 项目文档 (打包指南等)
```

---

## 🔒 安全与架构约定

在近期的架构演进与两轮全面 Code Review 中，项目固化了以下关键不变式（Invariants），开发新特性或提交 PR 时请严格遵守：

1. **高危命令单一事实来源**：
   - 高危命令拦截规则**只允许**定义在 `shared/guardrail.ts`。
   - 前端 `src/utils/guardrail.ts` 与后端 `server/guardrail.ts` 均从其 re-export，**切勿在任一侧单独新增私有规则**，确保前后端判定 100% 一致。
2. **WebSocket 消息协议严格校验**：
   - 新增消息类型时，必须在 `shared/wsProtocol.ts` 补充对应类型定义与运行时校验。
   - `wsRouter` 依赖该校验拒绝对端发送的畸形数据。
3. **凭据安全与本地加密**：
   - 服务器密码、私钥口令、API Key 一律通过 `storage.ts` 使用机器派生密钥的 **AES-256-GCM** 加密后落盘，**严禁**明文写入日志、配置或提交到仓库。
4. **Sudo 提权与凭据防泄露**：
   - 严防密码作为明文命令被 Shell 消费或回显在终端；
   - 多行脚本或 heredoc 执行前，必须调用 `sudo -v` 前置探测，通过密码浮层交互放行后再执行原命令块；
   - 敏感凭据输入统一由 `terminalAuth` 状态机管理。
5. **文件读写门禁与原子持久化**：
   - SFTP 与本地文件系统读写统一设置 **10MB 门禁**，防止大文件引发内存耗尽崩溃；
   - 文件保存统一采用临时文件写入 + 原子重命名（Atomic Rename）策略，防止进程异常退出导致文件被截断或损坏。
6. **配置存储防丢失与形状校验**：
   - `storage.ts` 读取 `hosts.json` 与 `settings.json` 时必须做 JSON 损坏检测与结构形状（shape）校验；
   - 写入前必须执行防御性校验，杜绝意外使用空对象覆盖破坏用户已有配置。
7. **ID 生成**：
   - 统一使用 `shared/id.ts` 的 `generateId()`，不要用 `Math.random().toString(36)`。

---

## 🧪 测试要求

- 为新功能或缺陷修复补充对应的 Vitest 用例，放入 `tests/`；
- 涉及流式解析、Guardrail 门禁、Shell Integration 语义感知、TerminalAuth 提权、存储加密等核心逻辑的改动，**必须**附带自动化测试；
- 运行单个测试文件：`npx vitest run tests/<file>.test.ts`；
- 运行全量测试：`npm test`。

---

## 🔁 Pull Request 流程

1. 从最新的 `main` 切出功能分支并完成改动；
2. 本地跑通「提交前自检」的全部命令（类型检查、Lint、测试、构建、链路自检）；
3. 推送分支到你的 Fork，向本仓库 `main` 发起 PR；
4. 在 PR 描述中清晰说明**动机、改动点、测试方式**，关联相关 Issue（如 `Closes #123`）；
5. 等待 CI 通过与维护者 Review，按反馈快速迭代。

---

## 🐛 反馈问题

提交 Issue 时请尽量包含：操作系统与版本、Node.js 版本、复现步骤、期望行为与实际行为、相关日志或截图。信息越完整，定位越快。

祝编码愉快 🚀
