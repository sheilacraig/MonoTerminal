const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

// 单实例锁：防止重复启动多个进程导致端口冲突和黑屏
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow = null;
  let serverProcess = null;
  let lastServerError = '';
  const SERVER_PORT = 3001;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 启动后台 Node 服务
  function startServer() {
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
      // 开发模式下通常由 npm run server 独立启动，无需重复拉起
      return;
    }

    // 生产环境中，优先检查 resources 目录或 app.asar.unpacked 下的后端脚本
    const candidates = [
      path.join(process.resourcesPath || '', 'dist-server', 'index.cjs'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist-server', 'index.cjs'),
      path.join(app.getAppPath(), '..', 'dist-server', 'index.cjs'),
      path.join(app.getAppPath(), 'dist-server', 'index.cjs'),
      path.join(__dirname, '..', 'dist-server', 'index.cjs')
    ];
    const serverPath = candidates.find((p) => fs.existsSync(p));
    if (!serverPath) {
      const errMsg = `[MonoTerminal] 致命错误: 未找到后台服务脚本 dist-server/index.cjs\n` +
        `已检查路径:\n${candidates.map((c) => `  - ${c}`).join('\n')}\n` +
        `resourcesPath: ${process.resourcesPath}\n` +
        `appPath: ${app.getAppPath()}`;
      console.error(errMsg);
      lastServerError = errMsg;
      return;
    }

    const serverCwd = app.isPackaged
      ? (process.resourcesPath || path.dirname(path.dirname(serverPath)))
      : path.join(__dirname, '..');

    const extraNodeModules = path.join(process.resourcesPath || '', 'node_modules');
    const unpackedNodeModules = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules');
    const nodePaths = [
      extraNodeModules,
      unpackedNodeModules,
      path.join(serverCwd, 'node_modules'),
      path.join(path.dirname(serverPath), '..', 'node_modules'),
      process.env.NODE_PATH
    ]
      .filter(Boolean)
      .join(path.delimiter);

    serverProcess = fork(serverPath, [], {
      cwd: serverCwd,
      env: {
        ...process.env,
        PORT: SERVER_PORT.toString(),
        NODE_ENV: 'production',
        // 关键配置：让打包后的 Electron 可执行文件以标准 Node 进程模式运行后台脚本
        ELECTRON_RUN_AS_NODE: '1',
        RESOURCES_PATH: process.resourcesPath || '',
        NODE_PATH: nodePaths
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    serverProcess.stdout?.on('data', (chunk) => {
      console.log(`[MonoTerminal Server] ${chunk}`);
    });

    serverProcess.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      console.error(`[MonoTerminal Server Error] ${msg}`);
      lastServerError = (lastServerError + msg).slice(-4000);
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[MonoTerminal Server] Exited unexpectedly with code ${code}, signal ${signal}`);
      }
    });

    serverProcess.on('error', (err) => {
      console.error('[MonoTerminal] Failed to start internal server:', err);
      lastServerError = `${lastServerError}\n${err.message}`.slice(-4000);
    });
  }

  // 轮询检查后端服务是否就绪（/api/auth/bootstrap 无需 token 即可返回 200）
  function waitForServer(onReady, onFailed, maxRetries = 60) {
    let attempts = 0;
    let finished = false;
    const interval = setInterval(() => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/auth/bootstrap`, (res) => {
        res.resume();
        if (!finished && res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          finished = true;
          clearInterval(interval);
          onReady();
        }
      });

      req.on('error', () => {
        if (!finished && attempts >= maxRetries) {
          finished = true;
          clearInterval(interval);
          if (onFailed) {
            onFailed();
          } else {
            onReady();
          }
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
    const prodUrl = `http://127.0.0.1:${SERVER_PORT}`;

    if (process.env.NODE_ENV === 'development') {
      mainWindow.loadURL(devUrl).catch(() => mainWindow.loadURL(prodUrl));
    } else {
      // 先显示优雅的暗黑加载状态，避免出现纯黑无响应窗口
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>MonoTerminal</title>
          <style>
            body {
              background-color: #0d1117;
              color: #c9d1d9;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              user-select: none;
            }
            .spinner {
              width: 36px;
              height: 36px;
              border: 3px solid rgba(56, 139, 253, 0.2);
              border-top-color: #58a6ff;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              margin-bottom: 20px;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
            .title { font-size: 16px; font-weight: 600; color: #58a6ff; margin-bottom: 8px; }
            .desc { font-size: 13px; color: #8b949e; }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <div class="title">MonoTerminal</div>
          <div class="desc">正在初始化本地运维服务，请稍候...</div>
        </body>
        </html>
      `)}`);

      waitForServer(
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(prodUrl);
          }
        },
        () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const errorHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>MonoTerminal - 服务启动异常</title>
              <style>
                body {
                  background-color: #0d1117;
                  color: #c9d1d9;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  padding: 40px;
                  margin: 0;
                }
                h2 { color: #f85149; margin-top: 0; font-size: 20px; }
                p { color: #8b949e; line-height: 1.6; font-size: 14px; }
                pre {
                  background: #161b22;
                  border: 1px solid #30363d;
                  border-radius: 6px;
                  padding: 16px;
                  color: #ff7b72;
                  overflow: auto;
                  max-height: 320px;
                  font-family: Consolas, "Courier New", monospace;
                  font-size: 13px;
                  white-space: pre-wrap;
                  word-break: break-all;
                }
                button {
                  background: #238636;
                  color: white;
                  border: none;
                  padding: 8px 18px;
                  border-radius: 6px;
                  cursor: pointer;
                  font-size: 14px;
                  margin-top: 16px;
                  font-weight: 500;
                }
                button:hover { background: #2ea043; }
              </style>
            </head>
            <body>
              <h2>MonoTerminal 后台服务启动超时</h2>
              <p>应用未能连接到内部服务端口 (127.0.0.1:${SERVER_PORT})。可能原因：服务启动异常或端口冲突。</p>
              ${lastServerError ? `<pre>${lastServerError.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` : '<p style="color:#6e7681;">（未捕获到内部错误输出）</p>'}
              <button onclick="location.reload()">重新连接</button>
            </body>
            </html>
          `;
          mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
        }
      );
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

  app.on('will-quit', () => {
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {
        // 忽略清理异常
      }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
