# MonoTerminal 可执行文件打包指南

本文档详细介绍了如何将 **MonoTerminal** 项目打包为独立的可执行文件（重点针对 Windows `.exe` 单文件/安装包，同时兼容 macOS 和 Linux）。

---

## 目录

1. [项目架构与打包原理](#1-项目架构与打包原理)
2. [方案一：Electron 桌面客户端（推荐，独立 GUI 窗口）](#2-方案一electron-桌面客户端推荐独立-gui-窗口)
   - [2.1 前置准备与依赖安装](#21-前置准备与依赖安装)
   - [2.2 后端编译配置 (esbuild)](#22-后端编译配置-esbuild)
   - [2.3 改造 Electron 主进程 (服务拉起与保活)](#23-改造-electron-主进程-服务拉起与保活)
   - [2.4 配置 package.json 构建选项](#24-配置-packagejson-构建选项)
   - [2.5 一键打包命令与产物](#25-一键打包命令与产物)
   - [2.6 国内镜像网络加速配置](#26-国内镜像网络加速配置)
3. [方案二：轻量全栈单文件（控制台 .exe，无 Chromium 外壳）](#3-方案二轻量全栈单文件控制台-exe无-chromium-外壳)
4. [常见问题与排错指引 (FAQ)](#4-常见问题与排错指引-faq)
5. [附录：GitHub Actions 自动化打包 Workflow](#5-附录github-actions-自动化打包-workflow)

---

## 1. 项目架构与打包原理

MonoTerminal 是一个全栈架构的 AI 原生运维终端：
- **前端视图**：基于 React 18 + Vite + TailwindCSS + xterm.js，构建后产物位于 `dist/`。
- **后端服务**：基于 Node.js + Express + WebSocket + ssh2，负责真实 SSH2 会话池、沙盒模拟器、本地凭据 AES-256 加密与大模型接口中继，代码位于 `server/`。
- **桌面外壳**：基于 Electron，入口文件为 `electron/main.cjs`。

### 打包核心逻辑
将该应用打包为 Windows 独立 `.exe` 时，关键在于**让 Electron 桌面窗口与 Node.js 核心后台协同运行**：
1. 前端构建出静态资源目录 `dist/`。
2. 后端 TypeScript 编译为独立的 Node 可执行脚本 `dist-server/index.cjs`。
3. Electron 主进程在启动时，自动在后台拉起该 Node 服务（监听本地 `http://localhost:3001`）。
4. Electron 窗口加载该本地服务，并在窗口关闭/退出时自动终止后台服务。
5. `electron-builder` 将前端、后端、Electron 运行时及依赖项压制为单文件可执行程序（Portable）或安装包（NSIS）。

```
+-------------------------------------------------------------+
|                     MonoTerminal.exe                        |
|                                                             |
|  +-------------------------------------------------------+  |
|  |             Electron 主进程 (main.cjs)                |  |
|  |                                                       |  |
|  |   1. 后台拉起 Node.js 服务 (dist-server/index.cjs)    |  |
|  |   2. 打开 BrowserWindow -> http://localhost:3001      |  |
|  |   3. 退出时清理后台进程                                |  |
|  +---------------------------+---------------------------+  |
|                              |                              |
|         +--------------------+--------------------+         |
|         |                                         |         |
|         v                                         v         |
|  +----------------------+          +---------------------+  |
|  |     桌面前端窗口      |  HTTP/WS |   内置 Node 核心服务  |  |
|  | (Chromium 渲染进程)   |<-------->| Express + WebSocket |  |
|  | React + xterm.js UI  |          | SSH2 + AES + 沙盒   |  |
|  +----------------------+          +---------------------+  |
+-------------------------------------------------------------+
```

---

## 2. 方案一：Electron 桌面客户端（推荐，独立 GUI 窗口）

### 2.1 前置准备与依赖安装

打开命令行终端（Windows PowerShell 建议以管理员身份或使用 CMD）：

```bash
# 安装打包所需的核心开发依赖
npm install --save-dev electron electron-builder esbuild cross-env
```

*说明*：
- `electron`: 桌面运行时外壳。
- `electron-builder`: 跨平台打包与安装包分发工具。
- `esbuild`: 高性能后端打包器，负责将 `server/*.ts` 编译为单一 `dist-server/index.cjs`。
- `cross-env`: 跨平台环境变量设置工具。

---

### 2.2 后端编译配置 (esbuild)

后端采用 TypeScript 编写，打包前需将其打包为纯 JS 文件。在 `package.json` 的 `scripts` 中增加编译后端命令：

```bash
npx esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:cpu-features --external:node-pty --external:"*.node"
```

> [!NOTE]
> 三个 `--external` 都是必需的，缺一个都会在特定环境下炸：
> - `--external:cpu-features`：`ssh2` 的可选依赖，需要本地编译，标记为外部引用即可（其 `require` 本身包在 `try/catch` 中）。
> - `--external:node-pty`：终端组件，由 `build.extraResources` 单独随包分发。
> - `--external:"*.node"`：放行一切原生 `.node` 文件。`ssh2` 自带可选的 C++ 加密加速模块，本机没编译出来时 esbuild 会放过 `try/catch` 里不可解析的 require，**CI 上却会因为它真实存在而报 `No loader is configured for ".node" files`**，详见 [Q6](#q6-ci-报-no-loader-is-configured-for-node-files)。

> [!IMPORTANT]
> **不要**把 `ssh2` 标记成 `--external:ssh2`。`electron-builder` 的 `build.files` 只收 `dist`、`dist-server`、`electron` 与 `package.json`，不含 `node_modules`；`ssh2` 必须被 esbuild 打进 `dist-server/index.cjs`，否则打包后的应用启动时会 `Cannot find module 'ssh2'`。

---

### 2.3 改造 Electron 主进程 (服务拉起与保活)

编辑 `electron/main.cjs`，加入对后端服务的自动唤起与生命周期管理：

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess = null;
const SERVER_PORT = 3001;

// 启动后台 Node 服务
function startServer() {
  const isDev = process.env.NODE_ENV === 'development';
  const serverPath = isDev
    ? path.join(__dirname, '../server/index.ts')
    : path.join(__dirname, '../dist-server/index.cjs');

  if (isDev) {
    // 开发模式下通常由 npm run server 独立启动，无需重复拉起
    return;
  }

  const serverCwd = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');

  serverProcess = fork(serverPath, [], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: SERVER_PORT.toString(),
      NODE_ENV: 'production'
    },
    stdio: 'ignore'
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start internal server:', err);
  });
}

// 轮询检查后端服务是否就绪
function waitForServer(callback, maxRetries = 30) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    const req = http.get(`http://localhost:${SERVER_PORT}/api/hosts`, (res) => {
      if (res.statusCode === 200) {
        clearInterval(interval);
        callback();
      }
    });

    req.on('error', () => {
      if (attempts >= maxRetries) {
        clearInterval(interval);
        callback(); // 超过重试上限依然尝试加载
      }
    });
  }, 200);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'MonoTerminal - AI 原生运维终端',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  const devUrl = 'http://localhost:5173';
  const prodUrl = `http://localhost:${SERVER_PORT}`;

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl).catch(() => mainWindow.loadURL(prodUrl));
  } else {
    // 生产环境中等待本地服务器完全启动后载入
    waitForServer(() => {
      mainWindow.loadURL(prodUrl);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 应用关闭时销毁后台服务进程
app.on('will-quit', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {
      // 忽略清理异常
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

---

### 2.4 配置 package.json 构建选项

在根目录 `package.json` 中配置打包脚本和 `build` 选项（与仓库当前配置保持一致）：

```json
{
  "main": "electron/main.cjs",
  "scripts": {
    "build": "tsc && vite build",
    "build:server": "esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:cpu-features --external:node-pty --external:\"*.node\"",
    "build:all": "npm run build && npm run build:server",
    "clean:stage": "node scripts/clean-staging.mjs",
    "pack:win": "npm run clean:stage && npm run build:all && electron-builder --win --dir",
    "dist:win": "npm run clean:stage && npm run build:all && electron-builder --win portable",
    "dist:installer": "npm run clean:stage && npm run build:all && electron-builder --win nsis",
    "dist:all": "npm run clean:stage && npm run build:all && electron-builder --win"
  },
  "build": {
    "appId": "com.monoterminal.app",
    "productName": "MonoTerminal",
    "asar": true,
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "dist-server/**/*",
      "electron/**/*",
      "package.json"
    ],
    "extraResources": [
      { "from": "dist", "to": "dist" },
      { "from": "dist-server", "to": "dist-server" },
      { "from": "node_modules/node-pty", "to": "node_modules/node-pty" }
    ],
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        },
        {
          "target": "portable",
          "arch": ["x64"]
        }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    }
  }
}
```

> [!IMPORTANT]
> 三个容易漏掉、漏掉就直接白屏/超时的要点：
> 1. **`extraResources` 必须包含 `dist` 与 `dist-server`**，否则打包后主进程找不到 `dist-server/index.cjs`，窗口会显示「后台服务启动超时」。
> 2. **`node_modules/node-pty` 必须随包携带**（终端功能所需的原生模块与 `conpty.dll`、`OpenConsole.exe`）。
> 3. **打包脚本前要清理暂存目录**（`clean:stage`）。上一次打包被中断、或调试时运行过 `release\win-unpacked` 里的 exe，残留文件会被占用，下一次打包会直接报 `EBUSY: resource busy or locked`。

---

### 2.5 一键打包命令与产物

完成配置后，在终端中执行以下命令即可生成对应产物：

#### 生成单文件绿色便携版（免安装，单个 `.exe` 文件）
```bash
npm run dist:win
```
- **产物位置**：`release/MonoTerminal-<版本号>.exe`
- **使用体验**：直接双击运行，随拷随用，无须安装流程。

#### 生成标准 Windows 安装程序（NSIS 安装向导）
```bash
npm run dist:installer
```
- **产物位置**：`release/MonoTerminal-Setup-<版本号>.exe`
- **使用体验**：提供标准安装界面、选择安装路径、创建桌面与开始菜单快捷方式。

#### 一次生成全部产物
```bash
npm run dist:all
```

#### 仅生成解包目录（用于排错或快速验证）
```bash
npm run pack:win
```
- **产物位置**：`release/win-unpacked/`
- 可以直接在解包目录中双击 `MonoTerminal.exe` 验证功能是否正常。
- 打包完建议跑一次产物验证（会真实拉起内置服务并检查终端链路）：
  ```bash
  node scripts/verify-packaged.mjs release/win-unpacked
  ```

---

### 2.6 国内镜像网络加速配置

在中国大陆网络环境下，`electron` 二进制底座和 `electron-builder` 工具链下载可能会因网络超时导致失败。可提前在终端中配置国内镜像：

#### Windows PowerShell:
```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist:win
```

#### Windows CMD:
```cmd
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run dist:win
```

也可以在用户目录的 `.npmrc` 中永久配置：
```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

---

## 3. 方案二：轻量全栈单文件（控制台 .exe，无 Chromium 外壳）

如果您的目标使用场景是：
1. 作为服务器端运维工具；
2. 追求极致小巧的分发体积（无需携带 150MB+ 的 Chromium 内核）；
3. 双击启动后台服务后在系统默认浏览器中打开；

可以使用 `@yao-pkg/pkg` 打包方案：

### 1. 安装打包工具
```bash
npm install --save-dev @yao-pkg/pkg esbuild
```

### 2. 打包为控制台 .exe
```bash
# 1. 编译前端
npm run build

# 2. 将后端编译为单文件
npx esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:node-pty --external:cpu-features --external:"*.node"

# 3. 使用 pkg 打包为单个可执行文件
npx @yao-pkg/pkg dist-server/index.cjs --targets node20-win-x64 --output release/monoterminal-server.exe
```

双击 `release/monoterminal-server.exe` 后，控制台将输出服务地址 `http://localhost:3001`，直接在浏览器中访问即可。

---

## 4. 常见问题与排错指引 (FAQ)

### Q1: PowerShell 提示“因为在此系统上禁止运行脚本”
- **原因**：Windows PowerShell 默认的执行策略（ExecutionPolicy）为 `Restricted`。
- **解决办法**：
  1. 改用 **CMD (命令提示符)** 执行构建命令；
  2. 或者在 PowerShell 中临时放宽权限：
     ```powershell
     Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
     ```

### Q2: 安装后打开提示「后台服务启动超时」
- **原因**：内置的 Node 服务没能起来。按下面顺序排查（窗口里的错误页也会显示同样的提示）：
  1. **安全软件拦截**：360 / 火绒 / 联想电脑管家等可能拦截新程序；把 MonoTerminal 安装目录加入信任后重启应用。
  2. **端口被占用**：后端会优先使用 3001，被占用时自动顺延并在日志里说明；若顺延后仍失败，关闭占用端口的程序。
  3. **系统代理**：应用已强制绕开系统代理访问 `127.0.0.1`，但若是 TUN 模式等底层劫持，需要把 `127.0.0.1` 加入直连规则。
  4. **看日志**：`%APPDATA%\monoterminal\logs\main.log`（错误页里也会显示完整路径），把该文件发给开发者即可定位。

### Q3: 打包报 `EBUSY: resource busy or locked, unlink '...default_app.asar'`
- **原因**：`release/win-unpacked` 是 electron-builder 的暂存目录。上一次打包被中断、或调试时运行过其中的 `electron.exe`，残留文件被其他进程（正在运行的应用、杀软扫描、网盘同步）占用，electron-builder 复制 Electron 后无法删除 `default_app.asar`。
- **解决办法**：
  1. 脚本已内置清理步骤（`clean:stage`），正常情况下不会遇到；
  2. 若仍失败：关闭正在运行的 MonoTerminal 与相关 `electron.exe` 进程 → 将项目目录加入杀软信任 → 暂停网盘类同步工具（OneDrive / 坚果云等）→ 重试；实在不行重启电脑后再打包。

### Q4: 打包产物验证（推荐每次打包后执行）
```bash
node scripts/verify-packaged.mjs release/win-unpacked
```
脚本会以打包后的 `MonoTerminal.exe`（`ELECTRON_RUN_AS_NODE` 模式）真实拉起内置服务，检查静态页面、REST 接口与本地 PTY 终端链路，逐项输出 PASS/FAIL。

### Q5: `ssh2` 或 `node-pty` 提示找不到模块 / 加载异常
- **原因**：这两者都带原生依赖（`cpu-features`、`pty.node`），需要在打包时原样携带。
- **解决办法**：
  `package.json` 的 `build.extraResources` 中保留 `node_modules/node-pty`；`ssh2` 会被 electron-builder 自动打进 `app.asar`，其原生部分（如 `util/pagent.exe`）会自动解包到 `app.asar.unpacked`。若自有依赖报同类错误，同样在 `extraResources` 中显式声明该目录。

### Q6: CI 报 `No loader is configured for ".node" files: node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node`
- **现象**：本地 `npm run build:server` 一切正常，推到 GitHub Actions 上**必挂**——`Build Backend Server` 步骤失败，后面「验证产物 / 打包 / 发布 Release」全部跳过，tag 推上去了却什么都没发出来。
- **原因**：`ssh2` 附带一个**可选**的 C++ 加密加速模块 `sshcrypto.node`，源码里这样写：
  ```js
  try { binding = require('./crypto/build/Release/sshcrypto.node'); } catch {}
  ```
  本机若没编译出这个文件，esbuild 会放过 `try/catch` 中不可解析的 require（这是 esbuild 对容错型 require 的既定行为）；而 CI runner 自带完整构建工具链，`npm ci` 时把该 `.node` 编译了出来，esbuild 于是撞上「没有 `.node` 文件的 loader」直接报错。
  **典型特征是「本地必过、CI 必挂」，很容易误判成 CI 环境问题。**
- **解决办法**：`build:server` 中声明 `--external:"*.node"`，让 esbuild 原样保留这个 require（运行时抛错被 `catch` 吞掉，`bindingAvailable: !!binding` 保持 `false`，ssh2 自动退回纯 JS 实现——与「文件不存在」时的行为完全一致）。
- **反面教材**：不要改成 `--loader:.node=empty`。那会让 `binding` 变成 `{}`（truthy），ssh2 误判原生加密可用并据此宣告支持 `aes*-gcm` / `chacha20-poly1305`，真连 SSH 时反而崩溃。
- **本地复现 CI 条件**（改构建配置时建议跑一遍）：
  ```bash
  # 造一个占位文件模拟 CI 上编译出来的原生模块
  node -e "const fs=require('fs'),p='node_modules/ssh2/lib/protocol/crypto/build/Release';fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+'/sshcrypto.node',Buffer.from('x'))"
  npm run build:server          # 修复前应报 No loader，修复后应成功
  node -e "require('fs').rmSync('node_modules/ssh2/lib/protocol/crypto/build',{recursive:true,force:true})"  # 验完清理
  ```

---

## 5. 附录：GitHub Actions 自动化打包 Workflow

如果项目托管在 GitHub 上，可以在 `.github/workflows/build.yml` 中配置自动化流水线，在发布 Tag 时自动生成 Windows、macOS 和 Linux 可执行文件：

```yaml
name: Build Desktop Executable

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  release:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [windows-latest]

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Build App & Executable
        run: npm run dist:win
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: MonoTerminal-Windows
          path: release/*.exe
```
