import fs from 'fs';
import { errorMessage } from '../../../shared/errors';
import type {
  TermInitMessage,
  TermInputMessage,
  TermResizeMessage,
  TermCloseMessage
} from '../../../shared/wsProtocol';
import type { WsHandler } from '../types';

export const handleTermInit: WsHandler<TermInitMessage> = async (msg, conn, deps) => {
  const { sessionId, hostId } = msg;
  const hosts = deps.storage.getHosts();
  const host = hosts.find(h => h.id === hostId) || deps.demoHost;

  conn.clientSessions.add(sessionId);

  if (host.authType === 'mock') {
    let sessionObj = deps.mockSessions.get(sessionId);
    if (!sessionObj) {
      sessionObj = deps.createMockSession(sessionId);
      deps.mockSessions.set(sessionId, sessionObj);
      sessionObj.term.on('data', (data: string) => {
        conn.send({ type: 'term:data', sessionId, data });
      });
      sessionObj.term.init();
    }
    conn.send({
      type: 'term:ready',
      sessionId,
      hostName: host.name,
      cwd: sessionObj.term.getCurrentDir()
    });
    return;
  }

  // Real SSH — requires the encrypted store to be unlocked
  if (deps.storage.isLocked()) {
    conn.send({
      type: 'term:error',
      sessionId,
      message: '本地加密存储已被主密码锁定，请先在 设置 → 安全 中解锁后再连接真实主机。'
    });
    return;
  }

  try {
    const decryptedPass = host.passwordEncrypted
      ? deps.storage.decrypt(host.passwordEncrypted)
      : undefined;
    const decryptedPassphrase = host.passphraseEncrypted
      ? deps.storage.decrypt(host.passphraseEncrypted)
      : undefined;
    let privKey: string | undefined;
    if (host.privateKeyPath && fs.existsSync(host.privateKeyPath)) {
      privKey = fs.readFileSync(host.privateKeyPath, 'utf8');
    }

    const session = await deps.sshManager.createSession(
      sessionId,
      host,
      decryptedPass,
      decryptedPassphrase,
      privKey
    );
    session.events.on('data', (data: string) => {
      conn.send({ type: 'term:data', sessionId, data });
    });
    session.events.on('close', () => {
      conn.send({ type: 'term:close', sessionId });
    });
    session.events.on('error', (err: unknown) => {
      conn.send({ type: 'term:error', sessionId, message: errorMessage(err) });
    });

    conn.send({
      type: 'term:ready',
      sessionId,
      hostName: host.name,
      cwd: host.initialDir || '/root'
    });
  } catch (err) {
    conn.send({
      type: 'term:error',
      sessionId,
      message: `SSH 连接失败: ${errorMessage(err)}`
    });
  }
};

export const handleTermInput: WsHandler<TermInputMessage> = (msg, _conn, deps) => {
  const mockObj = deps.mockSessions.get(msg.sessionId);
  if (mockObj) {
    mockObj.term.write(msg.data);
  } else {
    deps.sshManager.writeToShell(msg.sessionId, msg.data);
  }
};

export const handleTermResize: WsHandler<TermResizeMessage> = (msg, _conn, deps) => {
  const mockObj = deps.mockSessions.get(msg.sessionId);
  if (mockObj) {
    mockObj.term.resize(msg.cols, msg.rows);
  } else {
    deps.sshManager.resize(msg.sessionId, msg.cols, msg.rows);
  }
};

export const handleTermClose: WsHandler<TermCloseMessage> = (msg, conn, deps) => {
  deps.mockSessions.delete(msg.sessionId);
  deps.sshManager.closeSession(msg.sessionId);
  conn.clientSessions.delete(msg.sessionId);
};
