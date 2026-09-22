const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let serverProcess = null;
const SERVER_PORT = 3001;

// 启动后台 Node 服务
function startServer() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    // 开发模式下通常由 npm run server 独立启动，无需重复拉起
    return;
  }

  // 生产环境中，优先检查 app.asar.unpacked 下的后端脚本，兼容未 unpack 的路径
  const unpackedServerPath = path.join(process.resourcesPath || '', 'app.asar.unpacked/dist-server/index.cjs');
  const asarServerPath = path.join(__dirname, '../dist-server/index.cjs');
  const serverPath =
    app.isPackaged && fs.existsSync(unpackedServerPath)
      ? unpackedServerPath
      : asarServerPath;

  const unpackedCwd = path.join(process.resourcesPath || '', 'app.asar.unpacked');
  const serverCwd = app.isPackaged
    ? (fs.existsSync(unpackedCwd) ? unpackedCwd : (process.resourcesPath || path.join(__dirname, '..')))
    : path.join(__dirname, '..');

  const extraNodeModules = path.join(process.resourcesPath || '', 'node_modules');
  const nodePath =
    app.isPackaged && fs.existsSync(extraNodeModules)
      ? `${extraNodeModules}${path.delimiter}${process.env.NODE_PATH || ''}`
      : process.env.NODE_PATH;

  serverProcess = fork(serverPath, [], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PORT: SERVER_PORT.toString(),
      NODE_ENV: 'production',
      ...(nodePath ? { NODE_PATH: nodePath } : {})
    },
    stdio: 'ignore'
  });

  serverProcess.on('error', (err) => {
    console.error('[MonoTerminal] Failed to start internal server:', err);
  });
}

// 轮询检查后端服务是否就绪（/api/auth/bootstrap 无需 token 即可返回 200）
function waitForServer(callback, maxRetries = 50) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/auth/bootstrap`, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
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
  const prodUrl = `http://127.0.0.1:${SERVER_PORT}`;

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl).catch(() => mainWindow.loadURL(prodUrl));
  } else {
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
