# 贡献指南

感谢你愿意为 **MonoTerminal** 贡献力量！本文档帮助你快速搭建开发环境、了解协作规范，并顺利提交第一个 Pull Request。

---

## 🧰 环境准备

- **Node.js** 18+ 或 20+（推荐 20 LTS）
- **npm**（随 Node.js 安装）

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/<your-name>/MonoTerminal.git
cd MonoTerminal

# 2. 安装依赖
npm install

# 3. 启动开发环境
npm run server   # 终端 1：后端服务 (端口 3001)
npm run dev      # 终端 2：前端开发服务器 (端口 5173，已配置接口代理)
```

打开 `http://localhost:5173` 即可开发调试。若只想快速体验，可 `npm run build && npm start` 后访问 `http://localhost:3001`。

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

  示例：`feat(agent): 支持 Markdown 表格渲染`

---

## ✅ 提交前自检

CI（`.github/workflows/ci.yml`）会在 PR 与 push 到 `main` 时执行以下门禁，请在本地先跑通：

```bash
npm run typecheck   # tsc --noEmit 类型检查
npm run lint        # ESLint（要求 0 error）
npm test            # Vitest 单元/集成测试
npm run build       # 生产构建验证
```

代码格式化统一使用 Prettier：

```bash
npm run format        # 写入格式化
npm run format:check  # 仅检查（CI 友好）
```

> ESLint 目前存在少量 `react-hooks/exhaustive-deps` **warning**，不会阻断 CI；但请**不要引入新的 error**。

---

## 📁 目录结构速览

```
MonoTerminal/
├── src/          # 前端 (React + Tailwind + xterm.js)
│   ├── components/  # 界面组件
│   ├── context/     # 全局状态 (Session / Settings / WebSocket)
│   ├── hooks/       # 业务 Hook (useAgentChat / useSftp)
│   └── utils/       # 报错检测、guardrail 前端入口
├── shared/       # 前后端共享 (guardrail 规则、id 生成、wsProtocol、errors)
├── server/       # 后端 (Express + ws)
│   ├── routes/      # REST 路由
│   ├── ws/          # WebSocket 路由
│   ├── auth.ts      # 访问控制中间件
│   ├── sshManager.ts / mockServer.ts / aiService.ts / storage.ts
├── tests/        # Vitest 测试
└── docs/         # 补充文档
```

---

## 🔒 安全与约定

- **单一事实来源**：高危命令规则只允许定义在 `shared/guardrail.ts`，前端 `src/utils/guardrail.ts` 与后端 `server/guardrail.ts` 均从其 re-export，**切勿在任一侧单独新增规则**，以免造成前后端拦截不一致。
- **WebSocket 消息**：新增消息类型时，请同步在 `shared/wsProtocol.ts` 补充类型定义与运行时校验，`wsRouter` 依赖它拒绝畸形消息。
- **凭据处理**：服务器密码、私钥口令、API Key 一律通过 `storage.ts` 的 AES-256-GCM 加密后落盘，**严禁**明文写入日志、配置或提交到仓库。
- **ID 生成**：统一使用 `shared/id.ts` 的 `generateId()`，不要用 `Math.random().toString(36)`。

---

## 🧪 测试要求

- 为新功能或修复补充对应的 Vitest 用例，放入 `tests/`。
- 涉及流式解析、guardrail、协议校验等核心逻辑的改动，**必须**带测试。
- 运行单个测试文件：`npx vitest run tests/<file>.test.ts`。

---

## 🔁 Pull Request 流程

1. 从最新的 `main` 切出功能分支并完成改动。
2. 本地跑通「提交前自检」的全部命令。
3. 推送分支到你的 Fork，向本仓库 `main` 发起 PR。
4. 在 PR 描述中说明**动机、改动点、测试方式**，关联相关 Issue（如 `Closes #123`）。
5. 等待 CI 通过与维护者 Review，按反馈迭代即可。

---

## 🐛 反馈问题

提交 Issue 时请尽量包含：操作系统与版本、Node.js 版本、复现步骤、期望行为与实际行为、相关日志或截图。信息越完整，定位越快。

祝编码愉快 🚀
