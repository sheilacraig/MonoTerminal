# MonoTerminal Code Review（第 2 轮 · 复评）

- **日期**：2026-09-24 15:30
- **对象**：第 1 轮报告（`CODE_REVIEW.md`）全部 13 条问题的修复验证 + 本轮修改自带缺陷的排查
- **基线**：`tsc --noEmit` 0 错误；`vitest` 13 套 / **134 项全过**（数量与上轮持平）
- **修改面**：21 个文件，+739/-119 行（含新的 shellIntegration 功能）；dist 已重建（15:22 > 最新源码 15:20）且抽查确认新逻辑已编译进产物

---

## 总结论

**13 条问题：11 条已修复（含实证），1 条修了一半（P3-1 mock 会话清理），1 条留尾巴（P2-3 的 list 同步 IO）。**
修复质量整体很高，没有引入 P0/P1 级回归。但发现 **1 个 P2 级新风险**（SFTP 保存先删后更名的丢失窗口）和若干 P3 级尾巴，详见下文。

### 上轮问题核对表

| # | 上轮问题 | 状态 | 实证 |
|---|---|---|---|
| P1-1 | 粘贴路径绕过 guardrail | ✅ 已修 | 三层缺口全部闭合（见下） |
| P1-2 | hostId 静默回退本机 shell | ✅ 已修 | 探针：`term:error` + 不创建 PTY |
| P1-3 | 配置静默丢失链 | ✅ 已修 | 三层全部加防护（见下） |
| P2-1 | guardrail 引号/参数误报 | ✅ 基本修复 | 上轮 2 例误报全部转 SAFE；残余 2 例新误报（N5） |
| P2-2 | `chmod -R 777 /etc` 漏报 | ✅ 已修 | 实测 DANGER；chmod/chown 均结构化 + 复用 `CRITICAL_ABSOLUTE_DIRS` |
| P2-3 | SFTP 读取无上限 | ✅ 主体已修 | local+SFTP 均 stat + 10MB 上限；**list 同步 IO 未改**（N6） |
| P2-4 | 保存非原子 | ✅ 已修 | local/SFTP 均 tmp+rename；**SFTP 版引入新风险**（N1） |
| P2-5 | dist 落后 src | ✅ 已修 | dist 15:22:11 > src 15:20:39；产物含 `slice(6,-6)`/`主机未找到` 等新逻辑 |
| P3-1 | mock 会话跨连接串流 | 🟡 修一半 | data 改按连接绑定 ✓，但 `conn.socket` 从未赋值 → close 清理是死代码（N8） |
| P3-2 | ssh client close 残留 | ✅ 已修 | `closeSession(sessionId)` 已挂到 client close |
| P3-3 | waitForServer 500+ 死轮询 | ✅ 已修 | 500+ 计入重试上限 |
| P3-4 | 无全局 error handler | ✅ 已修 | JSON 500（位置在静态路由前，`app.get('*')` 的错误仍走默认 HTML，小尾巴） |
| P3-5 | 主机密码无法清除 | ✅ 已修 | `clearPassword`/`clearPassphrase` 字段（但见 N2 脏字段问题） |

---

## P1 修复验证详情

### P1-1 粘贴绕过（三层全闭合）

1. **多行漏判**：`splitShellSegments` 增加 `[\r\n]+` 分段。实测 `'echo hi\nrm -rf /'` → **DANGER (RM_ROOT_RECURSIVE)**（上轮 SAFE）；`'ls\nsudo rm -rf /'` → DANGER。
2. **单行不查**：`pasteIntoTerminal` 已移除 `isMultiLine` 条件，所有粘贴文本均过 `checkCommandSafety`。
3. **Ctrl+V 绕过**：`onData` 层新增 bracketed-paste 检测（`\x1b[200~...\x1b[201~` 提取后检查）。产物抽查确认 `startsWith("\x1B[200~")` / `slice(6,-6)` 已编译进 `dist/assets`。提取逻辑实测：`\x1b[200~rm -rf /\x1b[201~` → 提取 `rm -rf /` → DANGER；正常粘贴 `nginx -t` → SAFE 不打扰。

**反向边界**：正常按键流（逐键 <5 字符）不进检查分支（实测 `'mkfs'.length >= 5` = false）——键盘路径仍不拦完整命令，这是 guardrail 的固有设计边界（无法感知命令边界），可接受。5 字符以上的非粘贴 onData（如 F5 功能键序列 `\x1b[15~`）会进检查分支，但不匹配任何规则，无害。

### P1-2 hostId 回退

实测：`hostId='totally-nonexistent-host'` → `term:error`（"主机未找到…"），`localPtyManager.createSession` 调用 0 次。demoHost 回退限定为显式 `hostId === 'local-shell'`。✅

### P1-3 配置丢失链（三层防护全部就位）

- **后端**：损坏标记（`isHostsCorrupted`）+ 保存拒绝（抛错）+ tmp+rename 原子写 + `.bak` 备份。实测：损坏文件保存被拒、原内容保留、第二次保存后 `.bak` 为上一版内容、无 tmp 残留。
- **前端**：`hasLoaded` 门控——fetch 未成功前 `updateSettings` 直接拒绝（产物含该守卫）。
- **服务端 merge**：POST /api/settings 改为逐节 merge，providers 空数组在无 `allowEmptyProviders` 标志时保留旧值。

---

## 🟠 本轮新发现

### N1（P2）SFTP 保存「先 unlink 后 rename」引入数据丢失窗口

`sshManager.sftpWriteFile` 新实现：

```ts
sftp.unlink(filePath, () => {
  sftp.rename(tmpPath, filePath, err => {
    if (err) { sftp.unlink(tmpPath, () => {}); reject(err); }
    ...
```

**动机可以理解**（SFTP v3 标准 rename 不能覆盖已存在目标，所以先删），但引入了新风险：**unlink 成功、rename 失败**（网络中断、服务器端错误）时，目标文件已被删除、tmp 也被清理——**两头全丢，且远端没有 .bak**。这正是为修 P2-4（非原子写）而引入的更糟的原子性缺口。

**建议**：改用 ssh2 的 `extRename('posix-rename@openssh.com', ...)`（OpenSSH 全系支持，原子覆盖已存在目标，ssh2 v1.x 的 SFTPWrapper 已提供该方法）。退而求其次：rename 失败时先把 tmp rename 回一个 `.recovered` 名而不是删掉，保住内容。

### N2（P3）控制字段持久化进 JSON（脏字段）

- `POST /api/hosts` 的 `clearPassword`/`clearPassphrase` 留在 `hostData` 里随 `...hostData` 展开进 `hosts[index]` → **存进 hosts.json**；
- `POST /api/settings` 的 `allowEmptyProviders` 随 `{...current, ...incoming}` → **存进 settings.json**。

不影响功能，但污染存储、向后兼容埋雷。建议在落盘前显式 delete 这几个字段（与 `plainApiKey` 同等待遇）。

### N3（P3）corrupted 判定不校验形状

实测：`hosts.json` 内容为合法 JSON 对象（`{"not":"an array"}`）→ `getHosts()` 返回 `[]` 且 `isHostsCorrupted()=false` → **保存不被拒**，覆盖链在「形状损坏」场景下仍然存在。建议：解析成功但 `!Array.isArray(parsed)` 时同样置 corrupted（settings 同理可校验顶层关键字段）。

### N4（P3）`chmod 777 /`（无 -R）从拦截变为放行

旧正则里 `-R` 是可选的，新版结构化规则要求 `hasRecursive`。`chmod 777 /` 只改根目录自身权限，同样能破坏系统（如 / 变 777 后 sudo 拒绝工作）。行为变化需要拍板：要么接受（说明文档化），要么危险 mode + root-like 目标即拦（不要求 -R）。

### N5（P3）残余误报 2 例

实测仍误报：`mkfs.txt notes.md`（`mkfs.txt` 被 `/^mkfs\.[a-z0-9]+$/` 当成 mkfs 家族二进制）、`grep dd if=x of=/dev/sda docs`（dd 规则还是旧正则）。低频场景，可后续把 dd/REDIRECT_TO_DISK 也结构化。

### N6（P3）`localFsManager.list` 同步 IO 未改

P2-3 的另一半：大目录（node_modules 量级）`statSync` 逐项仍会阻塞事件循环数秒。建议改 `readdir` 异步 + 限量，或至少给条目数上限。

### N7（P3）修复未补回归测试

`guardrail.test.ts` 仍 4 项、`storage.test.ts` 仍 8 项——本轮改了多行分段、mkfs/chmod/chown 结构化、损坏拒绝保存、原子写等**多处行为**，均无针对性用例。测试数 134 → 134 持平也印证了这点（新增的 shellIntegration.test.ts 弥补了它自己的 23 项）。**没有用例保护的修复，下次重构会静默退化**。建议至少补：多行粘贴漏判用例、chmod /etc 用例、corrupted 拒绝保存用例、clearPassword 用例。

### N8（P3）P3-1 只修了一半：`conn.socket` 是死代码

`terminal.ts` mock 会话修复依赖 `conn.socket?.once('close', ...)` 清理监听器，但 `wsRouter.ts` **没有修改**——`conn` 对象从未赋值 `socket` 字段，清理分支永远不执行。后果有限（连接关闭时 `mockSessions.delete(sid)` 会丢弃整个 term 对象），但同一连接对同一 sessionId 重复 init 会叠加 data 监听器（输出重复 N 次）。修法：`wsRouter.ts` 构造 `conn` 时加 `socket: ws`。

### N9（P3，暂不可达）`allowEmptyProviders` 前端未接线

当前 UI 没有删除 AI provider 的入口，暂不触发；但未来加「删除 provider」功能时若不带 `allowEmptyProviders: true`，服务端会静默恢复旧值 → **界面显示已删除、磁盘未变**。届时必须接线，建议现在就在类型上注释说明。

---

## ✅ 值得肯定

- **P1-3 的三层防护设计正确**：不是只堵一处，而是读侧（损坏标记）、写侧（原子写+备份）、传输侧（merge+空保护）同时收口——这是修根而非打补丁。
- **guardrail 结构化改造方向对**：mkfs/chmod/chown 全部改用 `extractCommandInvocation` 复用 escalator 跳过逻辑，与 rm 规则同一套分析框架，规则间口径开始统一。
- **onData 的 bracketed-paste 检测是最难的一层**（浏览器原生粘贴无法在 JS 层拦截），用 `\x1b[200~/\x1b[201~` 帧识别是正确方案，且对未启用 bracketed-paste 的 shell 用 `length>=5 || 含换行` 兜底。
- 修复面广但 tsc/vitest 全绿，无类型回归；dist 同步重建且产物验证含新逻辑。

---

## 修正说明

- 首次产物抽查误报 2 处「未编译进去」：`主机未找到` 实为 esbuild 将非 ASCII 转义成 `\uXXXX`；`hasLoaded` 实为 minify 重命名。换用转义形式/逻辑特征（`slice(6,-6)`、`startsWith("\x1B[200~")`）复查均命中，**产物验证实际通过**。教训：产物抽查的标识符要选 minify/转义不会破坏的特征。

---

## 附：本轮探针与证据

| 文件 | 内容 |
|---|---|
| `out-guardrail.txt` | 55 例判定（上轮 40 + 复评新增 15 反向边界），4→2 mismatch |
| `out-hostfallback.txt` | hostId 回退已拒绝 |
| `out-storage.txt` | 损坏拒绝保存 / 原子写 / .bak / 形状错误边界（场景4） |
| `verify-build-2*.txt` | 产物抽查（含一次误报修正） |
| `dist-drift-2.txt` | dist 15:22 > src 15:20 |
| `tsc-out-2.txt` / `vitest-out-2.txt` | 基线 0 错误 / 134 项全过 |
| `git-state.txt` / `diff-*.txt` | 修改范围与逐文件 diff |

**建议处理顺序**：N1（SFTP unlink 窗口，唯一 P2）→ N8（一行修复）→ N3 → N7（补测试）→ 其余 P3 排期。
