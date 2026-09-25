import express from 'express';
import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { localStorageManager } from './storage';
import { AIService } from './aiService';
import { hostsRouter } from './routes/hosts';
import { settingsRouter } from './routes/settings';
import { guardrailRouter } from './routes/guardrail';
import { securityRouter } from './routes/security';
import { setupWsRouter } from './ws/wsRouter';
import { generateAuthToken, createAuthMiddleware, isAllowedOrigin, AuthContext } from './auth';
import { errorMessage } from '../shared/errors';

/** Preferred port; if taken we fall back to the next free one instead of crashing. */
const PREFERRED_PORT = parseInt(process.env.PORT || '3001', 10);
/** Frontend dev-server ports whose Origin/Host are also trusted (vite). */
const DEV_PORTS = [5173];
/** How many consecutive ports to probe when the preferred one is busy. */
const PORT_PROBE_RANGE = 20;

/** Probe the loopback address the app uses; the backend must not be LAN-accessible. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Resolve the port to listen on. A busy port must never take the whole app
 * down: on a user's machine 3001 may well be occupied by another tool, so we
 * walk forward until a free port is found and report the switch loudly
 * (electron/main.cjs picks the real port up from the READY line below).
 */
async function resolvePort(preferred: number): Promise<number> {
  if (await isPortFree(preferred)) return preferred;
  for (let offset = 1; offset <= PORT_PROBE_RANGE; offset++) {
    const candidate = preferred + offset;
    if (candidate <= 65535 && (await isPortFree(candidate))) {
      console.warn(
        `\x1b[33m[MonoTerminal Server]\x1b[0m 端口 ${preferred} 已被占用，自动切换到 ${candidate}`
      );
      return candidate;
    }
  }
  throw new Error(
    `端口 ${preferred}~${preferred + PORT_PROBE_RANGE} 均被占用。请关闭占用端口的程序，或指定其他端口后重试：` +
      `PORT=4000 npm start`
  );
}

/** Locate the built frontend so the server can also serve the UI itself. */
function resolveDistPath(): string {
  const candidates = [
    process.env.RESOURCES_PATH ? path.join(process.env.RESOURCES_PATH, 'app.asar.unpacked/dist') : '',
    process.env.RESOURCES_PATH ? path.join(process.env.RESOURCES_PATH, 'dist') : '',
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd(), '../dist'),
    typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../dist') : ''
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

async function main(): Promise<void> {
  const PORT = await resolvePort(PREFERRED_PORT);
  const ALLOWED_PORTS = [PORT, ...DEV_PORTS];

  const app = express();

  // Restrictive CORS: only loopback origins may READ responses (defense in
  // depth — the auth middleware below independently rejects foreign Origins)
  app.use(
    cors({
      origin: (origin, cb) => {
        cb(null, isAllowedOrigin(origin, ALLOWED_PORTS));
      },
      credentials: false
    })
  );
  app.use(express.json());

  // Per-startup bearer token gating all /api routes (see server/auth.ts for the
  // threat model). Persisted owner-only for local debugging / future Electron IPC.
  const authContext: AuthContext = {
    token: generateAuthToken(),
    allowedPorts: ALLOWED_PORTS
  };
  try {
    fs.writeFileSync(path.join(localStorageManager.getDataDir(), 'server_token'), authContext.token, {
      mode: 0o600
    });
  } catch {
    // Non-fatal: browser clients obtain the token via /api/auth/bootstrap
  }
  app.use(createAuthMiddleware(authContext));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Services
  const aiService = new AIService(localStorageManager);

  // REST API Routers
  app.use('/api/hosts', hostsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/guardrail', guardrailRouter);
  app.use('/api/security', securityRouter);

  // WebSocket RPC Router (handshake enforces the same auth boundary)
  setupWsRouter(wss, aiService, authContext);

  const distPath = resolveDistPath();
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Only the API is up: tell the user exactly how to get the UI instead of
    // letting them stare at "Cannot GET /".
    console.warn(
      `\x1b[33m[MonoTerminal Server]\x1b[0m 未找到前端构建产物 dist/（查找路径：${distPath}）。\n` +
        `  当前仅提供 API，浏览器打开会显示 404。请先执行 \x1b[36mnpm run build\x1b[0m，` +
        `或直接使用 \x1b[36mnpm run serve\x1b[0m（自动构建并启动）。`
    );
  }

  // Global error handler: ensure clean JSON responses for /api and avoid HTML stack leak
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[MonoTerminal Server Error]', err);
    if (res.headersSent) return;
    if (req.path.startsWith('/api')) {
      res.status(500).json({ success: false, error: errorMessage(err) });
    } else {
      res.status(500).type('text/plain').send(`MonoTerminal Server Error: ${errorMessage(err)}`);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\x1b[31m[MonoTerminal Server]\x1b[0m 端口 ${PORT} 已被占用，服务启动失败。\n` +
          `  请关闭占用该端口的程序，或换一个端口启动：PORT=4000 npm start`
      );
    } else if (err.code === 'EACCES') {
      console.error(
        `\x1b[31m[MonoTerminal Server]\x1b[0m 没有权限监听端口 ${PORT}，请改用 1024 以上的端口。`
      );
    } else {
      console.error(`\x1b[31m[MonoTerminal Server]\x1b[0m 服务启动失败：${err.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\x1b[32m[MonoTerminal Server]\x1b[0m 后端服务已就绪: http://127.0.0.1:${PORT}`);
    // Machine-readable handshake for the Electron shell (see electron/main.cjs):
    // it must know the *real* port, since the preferred one may have been busy.
    console.log(`MONOTERMINAL_READY port=${PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error(
    `\x1b[31m[MonoTerminal Server]\x1b[0m 启动失败：${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
});
