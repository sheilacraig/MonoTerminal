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
  let host = hosts.find(h => h.id === hostId);
  if (!host && deps.demoHost && (hostId === 'local-shell' || hostId === deps.demoHost.id)) {
    host = deps.demoHost;
  }

  if (!host) {
    conn.send({
      type: 'term:error',
      sessionId,
      message: `主机未找到 (hostId: "${hostId}")，请检查主机资产配置是否有效。`
    });
    return;
  }

  conn.clientSessions.add(sessionId);

  if (host.authType === 'local') {
    try {
      const session = deps.localPtyManager.createSession(
        sessionId,
        msg.cols,
        msg.rows,
        host.initialDir
      );
      session.events.on('data', (data: string) => {
        conn.send({ type: 'term:data', sessionId, data });
      });
      session.events.on('exit', () => {
        conn.send({ type: 'term:close', sessionId });
      });
      conn.send({
        type: 'term:ready',
        sessionId,
        hostName: host.name,
        cwd: session.initialCwd
      });
    } catch (err) {
      conn.send({
        type: 'term:error',
        sessionId,
        message: `本机终端启动失败: ${errorMessage(err)}`
      });
    }
    return;
  }

  if (host.authType === 'mock') {
    let sessionObj = deps.mockSessions.get(sessionId);
    if (!sessionObj) {
      sessionObj = deps.createMockSession(sessionId);
      deps.mockSessions.set(sessionId, sessionObj);
      sessionObj.term.init();
    }
    const onData = (data: string) => {
      conn.send({ type: 'term:data', sessionId, data });
    };
    sessionObj.term.on('data', onData);
    if (typeof conn.socket?.once === 'function') {
      conn.socket.once('close', () => {
        sessionObj?.term.off?.('data', onData);
      });
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
  if (deps.localPtyManager.has(msg.sessionId)) {
    deps.localPtyManager.write(msg.sessionId, msg.data);
    return;
  }
  const mockObj = deps.mockSessions.get(msg.sessionId);
  if (mockObj) {
    mockObj.term.write(msg.data);
  } else {
    deps.sshManager.writeToShell(msg.sessionId, msg.data);
  }
};

export const handleTermResize: WsHandler<TermResizeMessage> = (msg, _conn, deps) => {
  if (deps.localPtyManager.has(msg.sessionId)) {
    deps.localPtyManager.resize(msg.sessionId, msg.cols, msg.rows);
    return;
  }
  const mockObj = deps.mockSessions.get(msg.sessionId);
  if (mockObj) {
    mockObj.term.resize(msg.cols, msg.rows);
  } else {
    deps.sshManager.resize(msg.sessionId, msg.cols, msg.rows);
  }
};

export const handleTermClose: WsHandler<TermCloseMessage> = (msg, conn, deps) => {
  deps.localPtyManager.closeSession(msg.sessionId);
  deps.mockSessions.delete(msg.sessionId);
  deps.sshManager.closeSession(msg.sessionId);
  conn.clientSessions.delete(msg.sessionId);
};
