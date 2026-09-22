import express from 'express';
import http from 'http';
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

const PORT = parseInt(process.env.PORT || '3001', 10);
/** Frontend dev-server ports whose Origin/Host are also trusted (vite). */
const DEV_PORTS = [5173];
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

// Serve frontend in production
const distCandidates = [
  path.resolve(process.cwd(), 'dist'),
  path.resolve(process.cwd(), '../dist'),
  typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../dist') : ''
].filter(Boolean);
const distPath = distCandidates.find((p) => fs.existsSync(p)) || distCandidates[0];
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

server.listen(PORT, () => {
  console.log(`\x1b[32m[MonoTerminal Server]\x1b[0m 后端服务已就绪: http://localhost:${PORT}`);
});
