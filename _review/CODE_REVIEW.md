# MonoTerminal Code Review（第 1 轮）

- **日期**：2026-09-24
- **评审方式**：实证型 —— 所有结论均有代码链或探针实跑输出支撑（探针脚本与原始输出见 `_review/`，文末有清单）
- **基线**：`tsc --noEmit` 0 错误；`vitest run` 13 套 / **134 项全部通过**；`tests/e2e-ws.ts` 为独立 e2e 脚本，不在 vitest 链内

---

## 等级汇总

| 等级 | 数量 | 条目 |
|---|---|---|
| 🔴 P0 阻断级 | 0 | — |
| 🟠 P1 真实缺陷 | 3 | 粘贴路径绕过 guardrail；hostId 静默回退本机 shell；配置静默丢失链 |
| 🟡 P2 隐患 | 5 | guardrail 误报；chmod 系统目录漏报；SFTP 读取无上限+同步 IO；写文件非原子；dist 落后 src |
| 🔵 P3 风格/边缘 | 5 | mock 会话跨连接串流；ssh client close 残留；waitForServer 500+ 死轮询；无全局 error handler；主机密码无法清除 |

---

## 🟠 P1-1 粘贴路径大面积绕过 guardrail

**现象**：README 宣称「内置危险命令检测，对 `rm -rf /` 等破坏性指令进行拦截」。实际拦截面只有两处：AI 命令卡片（`AgentChatContext.runCommand/fillCommand`）和多行粘贴（`TerminalView.pasteIntoTerminal`）。粘贴路径存在三层缺口：

1. **Ctrl+V 原生粘贴完全绕过**：`TerminalView.tsx:224` 对 Ctrl+V `return false` 让浏览器执行默认粘贴 → xterm 核心把文本（bracketed-paste 包裹）通过 `term.onData` 直接发出 → `sendTermInput` 直写 pty。**全链路没有任何 `checkCommandSafety` 调用**，连多行都不检查。
2. **单行危险命令不检查**：`pasteIntoTerminal`（`TerminalView.tsx:104-113`）仅当 `isMultiLine` 时才做检查。单行粘贴 `rm -rf /`（右键粘贴路径）直接进 shell。
3. **多行粘贴首行为普通命令时漏判**（实证）：

```
探针 out-guardrail.txt：
MISMATCH expect=DANGER got=SAFE  cmd="echo hi\nrm -rf /"   ← 漏判
对照：    'ls; rm -rf /' → DANGER ✓   'rm -rf /' → DANGER ✓
```

根因：`splitShellSegments`（`shared/guardrail.ts:67`）按 `&&`/`||`/`;`/`|` 分段但**不按换行分段**，`echo hi\nrm -rf /` 整段 token 化后首 token 是 `echo`，`analyzeRmCommand` 只认首 token 为 `rm`，直接 `continue`。

**影响**：用户从网页/文档复制一条危险命令粘贴进终端（运维最常见的中毒路径），三种常见形态全部无提示执行。

**建议**：
- `splitShellSegments` 增加换行 `\n`/`\r` 作为分隔符（一行 = 一段，多行粘贴天然逐行检查）；
- 粘贴检查不应区分单行/多行：单行文本同样过 `checkCommandSafety`；
- Ctrl+V 路径：注册 xterm 的自定义 paste 拦截不可行（浏览器默认粘贴绕过 JS 层），可行方案是把检查下沉到 `onData` 层——对非按键来源的批量输入（bracketed paste 序列 `\x1b[200~...\x1b[201~` 之间的内容）做一次 guardrail 检查，命中则不发送并弹确认框。

---

## 🟠 P1-2 hostId 不存在时静默回退到本机 shell

**现象**：`server/ws/handlers/terminal.ts:14`：

```ts
const host = hosts.find(h => h.id === hostId) || deps.demoHost;
```

**实证**（探针 out-hostfallback.txt）：向 `handleTermInit` 传 `hostId='totally-nonexistent-host'`（hosts 列表为空），结果是 `localPtyManager.createSession` 被调用、前端收到 `term:ready`：

```
localPtyManager.createSession 调用次数: 1
发送给前端的消息: [{ "type": "term:ready", "hostName": "本机终端 (Local Shell)", ... }]
结论: 返回 term:ready 并创建了【本机】PTY —— 静默回退实证成立
```

**影响**：任何 hostId 解析失败（主机被删除后前端缓存了旧列表、并发编辑、前端 bug）都导致「以为连的是生产服务器，实际命令全部在本机执行」——错误的机器上执行命令是运维工具最严重的事故类别之一，且界面毫无提示。

**建议**：hostId 找不到时返回 `term:error`（消息里带上原始 hostId 便于排查）。`demoHost` 回退应仅限显式的 `hostId === 'local-shell'`。

---

## 🟠 P1-3 配置「读失败 → 空值 → 写回」静默丢失链

**现象**（三层叠加，均已实证/代码链完整）：

1. **后端读侧**：`storage.ts getHosts/getSettings` 在 JSON 解析失败时 catch 后返回 `[]`/默认值（`providers: []`），无备份、无告警。同时 `saveHosts/saveSettings` 直接 `writeFileSync` 覆盖，**无 temp+rename 原子写**，进程崩溃/断电即可制造损坏文件。
2. **前端加载侧**：`SettingsContext.tsx:69-101` —— `fetchSettings` 失败（后端启动慢、静态演示模式、网络抖动）后 settings 维持**前端默认值**（`providers: []`）；`updateSettings` **没有 `isLoading`/加载失败门控**，用户此时改任意一项（如字号），`{...settings, ...new}` 整包 POST。
3. **后端写侧**：`routes/settings.ts:21-43` 把请求体原样 `saveSettings`，**整包替换、无 merge、无 providers 非空校验**。

**实证**（探针 out-storage.txt）：

```
场景1: hosts.json 损坏 → getHosts() 返回 0 条（原有主机信息静默丢失）
场景1: 新增一台主机后落盘 1 条（原有主机已被空值覆盖，不可恢复）
场景2: settings.json 损坏 → getSettings().ai.providers = 0 个
场景2: 保存后 settings.json 的 providers = 0 个（空配置已固化）
```

**影响**：用户配置的全部 SSH 主机、AI provider（含加密 API Key 密文）可能被一次「后端没起来时顺手改了个设置」清空，且无任何提示、不可恢复。

**建议**（修根，三层都动）：
- 写侧原子化：`writeFileSync(tmp)` → `renameSync(tmp, target)`，顺手在写前把旧文件复制为 `hosts.json.bak`；
- 读侧：解析失败时**拒绝写入**（置一个 `corrupted` 标志，saveXxx 直接抛错并提示用户从 .bak 恢复），而不是返回空值；
- 前端：`updateSettings` 在 `isLoading` 或 fetch 失败状态下禁止保存（或保存前重新拉取服务端配置做 merge）；
- 服务端 POST：对 `ai.providers` 做保护性校验（请求体 providers 为空但磁盘上非空时，要求显式确认标志）。

---

## 🟡 P2-1 guardrail 规则误报（引号内/参数中的关键词）

**实证**：

```
MISMATCH expect=SAFE got=DANGER rule=FORMAT_DISK cmd="echo \"mkfs.ext4 is scary\""  ← 误报
MISMATCH expect=SAFE got=DANGER rule=FORMAT_DISK cmd="grep mkfs manual.txt"          ← 误报
对照： 'echo "a > b"' → SAFE ✓（REDIRECT 类规则没误报）
```

`FORMAT_DISK` 等正则规则不做引号剥离，`grep mkfs 手册.txt`、`echo "聊到 mkfs 那件事"` 都会弹高危确认框。本项目拦截后是确认弹窗（非阻断），但按「误报让用户无脑按 y」的规律，误报会削弱真高危时的警觉。建议给正则规则补一层简单的引号上下文过滤（tokenize 已有剥引号逻辑可复用——把 `mkfs` 类规则也改造成结构化 `match`）。

## 🟡 P2-2 `chmod -R 777 /etc` 漏报

**实证**：`chmod -R 777 /etc` → SAFE。`CHMOD_ROOT_777` 正则只匹配 `/` 与 `/*`，而 `rm` 规则的 `CRITICAL_ABSOLUTE_DIRS`（etc/usr/var/...）没有同步给 chmod/chown。同一个「系统关键目录」概念在两处规则中口径不一致。建议 chmod/chown 也走 `CRITICAL_ABSOLUTE_DIRS` 判定。

## 🟡 P2-3 SFTP/本地读文件无大小上限 + 本地 list 同步 IO

- `sftpReadFile`（`sshManager.ts:196`）与 `localFsManager.readFile` 无大小限制，协议层 `sftp:read` 也不带 size 校验（对比 `sftp:write` 有 20MB 上限，**读写不对称**）。在 SFTP 面板双击一个 2GB 日志 → 全量读入内存 + utf8 解码 → 服务进程 OOM，所有终端会话一起死。
- `localFsManager.list` 对每个 entry `statSync`（`localFsManager.ts:53`），打开 `node_modules` 级目录（上万条目）会阻塞事件循环数秒，期间所有 WS 会话卡死。

**建议**：读文件前 `stat` 取大小，超过阈值（如 5MB）返回错误让前端提示「文件过大，请下载后查看」；list 改异步或限制条目数。

## 🟡 P2-4 在线编辑器保存非原子

`localFsManager.writeFile` / `sftpWriteFile` 直接覆盖写目标文件。编辑远程配置文件 Ctrl+S 保存时断网/进程被杀 → 目标文件半截损坏。对以「改服务器配置」为核心场景的工具，建议 temp+rename（本地）/ SFTP 先写 `.tmp` 再 rename（远端）。

## 🟡 P2-5 dist 前端产物落后源码（当下工作区状态）

`dist/assets` 构建于 14:04:52，但 `TerminalView.tsx`（14:23:01）、`shellIntegration.ts`（14:22:22）等在其后又有改动。当前直接 `npm run pack:win` / `npm start` 会发布/运行**旧前端**（所有测试跑 `src`，全绿也发现不了）。打包前记得 `npm run build`（`pack:win` 等脚本已内含 `build:all`，风险主要在手动 `npm start` 复用旧 dist）。长期建议：`start` 前加 mtime 守卫或在 doctor 里检查 drift。

---

## 🔵 P3 清单

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| 1 | `terminal.ts:49-57` | mock 会话的 `data` 事件只在创建时绑定到当时的 `conn`；`mockSessions` 跨连接共享，第二个连接复用同一 sessionId 会拿不到输出流 | mock 会话 data 改为按 conn 广播，或 mockSessions 也按连接隔离 |
| 2 | `sshManager.ts:106-109` | `client.on('close')` 只置 `isAlive=false`，不从 sessions Map 删除；若 shell stream 的 close 未触发（异常断链），会话对象残留 | close 里调用 `closeSession(sessionId)`（注意防重入） |
| 3 | `electron/main.cjs:139-146` | `waitForServer` 只在「请求出错」时检查重试上限；若 bootstrap 持续返回 ≥500，既不 onReady 也不 onFailed，无限轮询 | 成功响应但 statusCode≥500 也计入失败重试 |
| 4 | `routes/*` | 路由内 `throw err` 落到 express 默认 500，`npm start`（未设 NODE_ENV=production）时返回含 stack 的 HTML | 加一个统一 JSON error handler |
| 5 | `routes/hosts.ts` | 更新主机时 `plainPassword` 为空即保留旧密码——**没有清除已存密码的途径**（只能删主机重建） | 支持 `clearPassword: true` 显式字段 |

---

## ✅ 值得肯定的地方

- **`shared/wsProtocol.ts` 是全项目安全设计的范本**：逐字段重建消息（unknown 属性剥离）、ID 白名单正则、每类消息独立长度上限——信任边界干净且注释解释了为什么。
- **`server/auth.ts` 双层防护**（Host/Origin 白名单防 DNS rebinding + 每次启动随机 token + `timingSafeEqual`），威胁模型写在注释里，同类项目少见。
- **`storage.ts` 主密码设计成熟**：旋转时全量重加密、legacy 派生保持字节级兼容、verify token 验证而非存哈希、改密必须验证当前密码（注释里明确写了防本地进程 CSRF 的理由）。
- **`WebSocketContext.tsx` 的生命周期守卫**（disposedRef / socket 身份检查 / outbox 上限）把 React 18 StrictMode 和 HMR 的 ghost 重连问题解释得非常透彻，注释即文档。
- **`aiService.ts` 的三个细节**：idle watchdog 防 SSE 挂死、`outer:` label 防 keep-alive 下 `[DONE]` 后 read 阻塞、`<think>` 标签跨 chunk 状态机——都是真实踩坑后写的代码。
- **测试质量高**：134 项覆盖 storage 加密旋转、ws 协议校验、authPrompt、shellIntegration 等核心路径。
- **进程清理验证过没有问题**（本轮实证）：node-pty spawn 的 shell 会随后端服务进程一起退出，Electron `will-quit` 只 kill 直接子进程即可，无孤儿残留（见 out-orphan.txt）。

---

## 修正说明（评审过程中推翻的初步判断）

- **Electron 退出不杀孙进程 → 孤儿 shell 残留**：初判为 P1 候选。探针实证（fork 模拟服务进程 + node-pty powershell + kill 后 3 秒复查）显示 shell 随服务进程正常退出，**判断错误，不成立**，已从问题清单移除并记入「验证过无问题」。
- **探针自身的一个教训**：hostfallback 探针首跑因 `demoHost` 传 undefined 崩溃，修复后成功。已在 `probe-hostfallback.mts` 中修正。

---

## 附：`_review/` 探针清单（可复现）

| 文件 | 用途 |
|---|---|
| `probe-guardrail.mts` → `out-guardrail.txt` | 40 条命令的拦截/放行判定，实锤多行漏判、chmod 漏报、引号误报 |
| `probe-hostfallback.mts` → `out-hostfallback.txt` | hostId 不存在时静默回退本机 PTY |
| `probe-orphan-parent.cjs` + `probe-orphan-child.cjs` → `out-orphan.txt` | 进程树清理验证（结论：无残留） |
| `probe-storage.mts` → `out-storage.txt` | 配置损坏 → 空值 → 写回丢失链 |
| `tsc-out.txt` / `vitest-out.txt` | 基线输出（0 错误 / 134 项全过） |
| `run1-4.txt` | 各探针运行的原始 stdout/stderr |

运行方式：`node node_modules\tsx\dist\cli.mjs _review\probe-xxx.mts`（探针 3 直接 `node _review\probe-orphan-parent.cjs`）。
