import { WebSocketServer, WebSocket } from 'ws';
import fs from 'fs';
import { localStorageManager } from '../storage';
import { sshManager } from '../sshManager';
import { MockFileSystem, MockTerminalSession } from '../mockServer';
import { AIService } from '../aiService';

export function setupWsRouter(wss: WebSocketServer, aiService: AIService) {
  // Session storage for active terminals
  const mockSessions = new Map<string, { term: MockTerminalSession; fs: MockFileSystem }>();

  wss.on('connection', (ws: WebSocket) => {
    const clientSessions = new Set<string>();

    const send = (msg: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.on('message', async (raw: string) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, sessionId, requestId } = msg;

        // Ping / Pong for latency RTT
        if (type === 'ping') {
          send({ type: 'pong', clientTime: msg.timestamp, serverTime: Date.now() });
          return;
        }

        // Terminal Init
        if (type === 'term:init') {
          const { hostId, cols, rows } = msg;
          const hosts = localStorageManager.getHosts();
          const host = hosts.find(h => h.id === hostId) || {
            id: 'mock-local-demo',
            name: 'Demo Linux',
            group: '演示',
            host: '127.0.0.1',
            port: 22,
            username: 'root',
            authType: 'mock',
            initialDir: '/etc/nginx',
            createdAt: Date.now()
          };

          clientSessions.add(sessionId);

          if (host.authType === 'mock') {
            let sessionObj = mockSessions.get(sessionId);
            if (!sessionObj) {
              const mockFs = new MockFileSystem();
              const term = new MockTerminalSession(sessionId, mockFs);
              sessionObj = { term, fs: mockFs };
              mockSessions.set(sessionId, sessionObj);

              term.on('data', (data: string) => {
                send({ type: 'term:data', sessionId, data });
              });
              term.init();
            }
            send({ type: 'term:ready', sessionId, hostName: host.name, cwd: sessionObj.term.getCurrentDir() });
          } else {
            // Real SSH
            try {
              const decryptedPass = host.passwordEncrypted ? localStorageManager.decrypt(host.passwordEncrypted) : undefined;
              const decryptedPassphrase = host.passphraseEncrypted ? localStorageManager.decrypt(host.passphraseEncrypted) : undefined;
              let privKey: string | undefined;
              if (host.privateKeyPath && fs.existsSync(host.privateKeyPath)) {
                privKey = fs.readFileSync(host.privateKeyPath, 'utf8');
              }

              const session = await sshManager.createSession(sessionId, host, decryptedPass, decryptedPassphrase, privKey);
              session.events.on('data', (data: string) => {
                send({ type: 'term:data', sessionId, data });
              });
              session.events.on('close', () => {
                send({ type: 'term:close', sessionId });
              });
              session.events.on('error', (err: any) => {
                send({ type: 'term:error', sessionId, message: err.message });
              });

              send({ type: 'term:ready', sessionId, hostName: host.name, cwd: host.initialDir || '/root' });
            } catch (err: any) {
              send({ type: 'term:error', sessionId, message: `SSH 连接失败: ${err.message}` });
            }
          }
          return;
        }

        // Terminal Input
        if (type === 'term:input') {
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.term.write(msg.data);
          } else {
            sshManager.writeToShell(sessionId, msg.data);
          }
          return;
        }

        // Terminal Resize
        if (type === 'term:resize') {
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.term.resize(msg.cols, msg.rows);
          } else {
            sshManager.resize(sessionId, msg.cols, msg.rows);
          }
          return;
        }

        // Terminal Close
        if (type === 'term:close') {
          mockSessions.delete(sessionId);
          sshManager.closeSession(sessionId);
          clientSessions.delete(sessionId);
          return;
        }

        // SFTP: List
        if (type === 'sftp:list') {
          const { dirPath } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            const files = mockObj.fs.list(dirPath);
            send({ type: 'sftp:response', requestId, success: true, data: files });
          } else {
            try {
              const files = await sshManager.sftpList(sessionId, dirPath);
              send({ type: 'sftp:response', requestId, success: true, data: files });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Read File
        if (type === 'sftp:read') {
          const { filePath } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            try {
              const content = mockObj.fs.readFile(filePath);
              send({ type: 'sftp:response', requestId, success: true, data: content });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          } else {
            try {
              const content = await sshManager.sftpReadFile(sessionId, filePath);
              send({ type: 'sftp:response', requestId, success: true, data: content });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Write File
        if (type === 'sftp:write') {
          const { filePath, content } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.fs.writeFile(filePath, content);
            send({ type: 'sftp:response', requestId, success: true });
          } else {
            try {
              await sshManager.sftpWriteFile(sessionId, filePath, content);
              send({ type: 'sftp:response', requestId, success: true });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Delete
        if (type === 'sftp:delete') {
          const { targetPath, isDirectory } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.fs.delete(targetPath);
            send({ type: 'sftp:response', requestId, success: true });
          } else {
            try {
              await sshManager.sftpDelete(sessionId, targetPath, isDirectory);
              send({ type: 'sftp:response', requestId, success: true });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Rename
        if (type === 'sftp:rename') {
          const { oldPath, newPath } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.fs.rename(oldPath, newPath);
            send({ type: 'sftp:response', requestId, success: true });
          } else {
            try {
              await sshManager.sftpRename(sessionId, oldPath, newPath);
              send({ type: 'sftp:response', requestId, success: true });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Chmod
        if (type === 'sftp:chmod') {
          const { targetPath, mode } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.fs.chmod(targetPath, mode);
            send({ type: 'sftp:response', requestId, success: true });
          } else {
            try {
              await sshManager.sftpChmod(sessionId, targetPath, mode);
              send({ type: 'sftp:response', requestId, success: true });
            } catch (err: any) {
              send({ type: 'sftp:response', requestId, success: false, error: err.message });
            }
          }
          return;
        }

        // SFTP: Mkdir
        if (type === 'sftp:mkdir') {
          const { dirPath } = msg;
          const mockObj = mockSessions.get(sessionId);
          if (mockObj) {
            mockObj.fs.mkdir(dirPath);
            send({ type: 'sftp:response', requestId, success: true });
          } else {
            send({ type: 'sftp:response', requestId, success: true });
          }
          return;
        }

        // AI Chat Streaming
        if (type === 'ai:chat') {
          const { messages, opsContext } = msg;
          await aiService.streamChat(messages, opsContext, {
            onThinking: (delta) => {
              send({ type: 'ai:thinking', requestId, delta });
            },
            onContent: (delta) => {
              send({ type: 'ai:content', requestId, delta });
            },
            onDone: (fullContent, fullThinking) => {
              send({ type: 'ai:done', requestId, fullContent, fullThinking });
            },
            onError: (err) => {
              send({ type: 'ai:error', requestId, error: err.message });
            }
          });
          return;
        }
      } catch (err: any) {
        console.error('WebSocket message handling error:', err);
      }
    });

    ws.on('close', () => {
      for (const sid of clientSessions) {
        mockSessions.delete(sid);
        sshManager.closeSession(sid);
      }
    });
  });
}
