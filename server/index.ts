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
import { setupWsRouter } from './ws/wsRouter';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Services
const aiService = new AIService(localStorageManager);

// REST API Routers
app.use('/api/hosts', hostsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/guardrail', guardrailRouter);

// WebSocket RPC Router
setupWsRouter(wss, aiService);

// Serve frontend in production
const distPath = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, () => {
  console.log(`\x1b[32m[MonoTerminal Server]\x1b[0m 后端服务已就绪: http://localhost:${PORT}`);
});
