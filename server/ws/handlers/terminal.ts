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
  if (!host && hostId === 'ops-sandbox') {
    host = {
      id: 'ops-sandbox',
      name: '运维沙盒',
      group: '本机与沙盒',
      host: '127.0.0.1',
      port: 22,
      username: 'root',
      authType: 'mock',
      initialDir: '/etc/nginx',
      createdAt: 0
    };
  }

  if (!host) {
    conn.send({
      type: 'term:error',
      sessionId,
      message: `主机未找到 (hostId: "${hostId}")，请检查主机资产配置是否有效。`
    });
    return;
  }

  const isLocal = host.authType === 'local';
  const isMock = host.authType === 'mock';

  // Real SSH requires the encrypted store to be unlocked before decrypting credentials
  if (!isLocal && !isMock && deps.storage.isLocked()) {
    conn.send({
      type: 'term:error',
      sessionId,
      message: '本地加密存储已被主密码锁定，请先在 设置 → 安全 中解锁后再连接真实主机。'
    });
    return;
  }

  try {
    let credentials:
      | {
          password?: string;
          passphrase?: string;
          privateKey?: string;
        }
      | undefined;

    if (!isLocal && !isMock) {
      const password = host.passwordEncrypted
        ? deps.storage.decrypt(host.passwordEncrypted)
        : undefined;
      const passphrase = host.passphraseEncrypted
        ? deps.storage.decrypt(host.passphraseEncrypted)
        : undefined;
      let privateKey: string | undefined;
      if (host.privateKeyPath && fs.existsSync(host.privateKeyPath)) {
        privateKey = fs.readFileSync(host.privateKeyPath, 'utf8');
      }
      credentials = { password, passphrase, privateKey };
    }

    const session = await deps.sessionManager.getOrCreate({
      id: sessionId,
      host,
      cols: msg.cols,
      rows: msg.rows,
      credentials
    });

    conn.clientSessions.add(sessionId);
    const connId = conn.connectionId || 'default-conn';
    deps.sessionManager.attach(sessionId, connId, conn.send);

    if (typeof conn.socket?.once === 'function') {
      conn.socket.once('close', () => {
        deps.sessionManager.detach(sessionId, connId);
      });
    }

    conn.send({
      type: 'term:ready',
      sessionId,
      hostName: host.name,
      cwd: session.terminal.cwd
    });
  } catch (err) {
    const prefix = isLocal
      ? '本机终端启动失败'
      : isMock
        ? '仿真终端启动失败'
        : 'SSH 连接失败';
    conn.send({
      type: 'term:error',
      sessionId,
      message: `${prefix}: ${errorMessage(err)}`
    });
  }
};

export const handleTermInput: WsHandler<TermInputMessage> = (msg, conn, deps) => {
  const session = deps.sessionManager.get(msg.sessionId);
  if (!session) {
    conn.send({
      type: 'term:error',
      sessionId: msg.sessionId,
      message: `会话不存在或已关闭 (sessionId: "${msg.sessionId}")`
    });
    return;
  }
  deps.sessionManager.writeTerminal(msg.sessionId, msg.data);
};

export const handleTermResize: WsHandler<TermResizeMessage> = (msg, conn, deps) => {
  const session = deps.sessionManager.get(msg.sessionId);
  if (!session) {
    conn.send({
      type: 'term:error',
      sessionId: msg.sessionId,
      message: `会话不存在或已关闭 (sessionId: "${msg.sessionId}")`
    });
    return;
  }
  deps.sessionManager.resizeTerminal(msg.sessionId, msg.cols, msg.rows);
};

export const handleTermClose: WsHandler<TermCloseMessage> = async (msg, conn, deps) => {
  // Review-3 R6: a closed tab must not leave an agent plan hanging on the
  // 5-minute approval timeout — cancel any pending approval for this session.
  deps.approvalManager?.cancelSessionApprovals(msg.sessionId);
  // UX round-1 ③: also stop any in-flight agent run for this session —
  // including one paused on plan confirmation — so the gate is released.
  deps.agentRuntime?.cancel(msg.sessionId);
  await deps.sessionManager.close(msg.sessionId);
  conn.clientSessions.delete(msg.sessionId);
};
