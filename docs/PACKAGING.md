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
npx esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:ssh2 --external:cpu-features
```

> [!NOTE]
> `ssh2` 模块内部包含可能需本地平台编译的 `cpu-features` 模块，因此在 esbuild 中标记为 `--external` 保持外部引用，在 electron-builder 打包时作为额外资源复制。

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

在根目录 `package.json` 中配置打包脚本和 `build` 选项：

```json
{
  "main": "electron/main.cjs",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:server": "esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:ssh2 --external:cpu-features",
    "build:all": "npm run build && npm run build:server",
    "electron:dev": "cross-env NODE_ENV=development electron .",
    "pack:win": "npm run build:all && electron-builder --win --dir",
    "dist:win": "npm run build:all && electron-builder --win portable",
    "dist:installer": "npm run build:all && electron-builder --win nsis"
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
      {
        "from": "node_modules/ssh2",
        "to": "node_modules/ssh2"
      }
    ],
    "win": {
      "target": [
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

---

### 2.5 一键打包命令与产物

完成配置后，在终端中执行以下命令即可生成对应产物：

#### 生成单文件绿色便携版（免安装，单个 `.exe` 文件）
```bash
npm run dist:win
```
- **产物位置**：`release/MonoTerminal 1.0.0.exe`
- **使用体验**：直接双击运行，随拷随用，无须安装流程。

#### 生成标准 Windows 安装程序（NSIS 安装向导）
```bash
npm run dist:installer
```
- **产物位置**：`release/MonoTerminal Setup 1.0.0.exe`
- **使用体验**：提供标准安装界面、选择安装路径、创建桌面与开始菜单快捷方式。

#### 仅生成解包目录（用于排错或快速验证）
```bash
npm run pack:win
```
- **产物位置**：`release/win-unpacked/`
- 可以直接在解包目录中双击 `MonoTerminal.exe` 验证功能是否正常。

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
npx esbuild server/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist-server/index.cjs --external:ssh2

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

### Q2: 打包运行后界面白屏，提示无法连接 WebSocket / SSH 连接失败
- **原因**：后端服务未正常启动或静态资源未被托管。
- **排查步骤**：
  1. 确保在运行 Electron 前已执行 `npm run build` 和 `npm run build:server`；
  2. 检查后台端口 `3001` 是否被其他程序占用；
  3. 查看 `server/storage.ts` 中的本地数据存储路径是否具有读写权限（默认位于系统的 `%APPDATA%/monoterminal`）。

### Q3: `ssh2` 提示找不到模块或加载异常
- **原因**：`ssh2` 依赖的 `cpu-features` 含有部分平台二进制绑定。
- **解决办法**：
  确保在 `package.json` 的 `build.extraResources` 中包含了 `node_modules/ssh2`，这样在打包时会将该依赖原样放入应用资源目录。

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
