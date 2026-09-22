import { errorMessage } from '../../../shared/errors';
import type {
  SftpListMessage,
  SftpReadMessage,
  SftpWriteMessage,
  SftpDeleteMessage,
  SftpRenameMessage,
  SftpChmodMessage,
  SftpMkdirMessage
} from '../../../shared/wsProtocol';
import type { WsHandler } from '../types';

export const handleSftpList: WsHandler<SftpListMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      const files = deps.localFsManager.list(msg.dirPath);
      conn.send({ type: 'sftp:response', requestId, success: true, data: files });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    conn.send({
      type: 'sftp:response',
      requestId,
      success: true,
      data: mockObj.fs.list(msg.dirPath)
    });
    return;
  }
  try {
    const files = await deps.sshManager.sftpList(sessionId, msg.dirPath);
    conn.send({ type: 'sftp:response', requestId, success: true, data: files });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpRead: WsHandler<SftpReadMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      const content = deps.localFsManager.readFile(msg.filePath);
      conn.send({ type: 'sftp:response', requestId, success: true, data: content });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    try {
      const content = mockObj.fs.readFile(msg.filePath);
      conn.send({ type: 'sftp:response', requestId, success: true, data: content });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  try {
    const content = await deps.sshManager.sftpReadFile(sessionId, msg.filePath);
    conn.send({ type: 'sftp:response', requestId, success: true, data: content });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpWrite: WsHandler<SftpWriteMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      deps.localFsManager.writeFile(msg.filePath, msg.content);
      conn.send({ type: 'sftp:response', requestId, success: true });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    mockObj.fs.writeFile(msg.filePath, msg.content);
    conn.send({ type: 'sftp:response', requestId, success: true });
    return;
  }
  try {
    await deps.sshManager.sftpWriteFile(sessionId, msg.filePath, msg.content);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpDelete: WsHandler<SftpDeleteMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      deps.localFsManager.delete(msg.targetPath, msg.isDirectory);
      conn.send({ type: 'sftp:response', requestId, success: true });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    mockObj.fs.delete(msg.targetPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
    return;
  }
  try {
    await deps.sshManager.sftpDelete(sessionId, msg.targetPath, msg.isDirectory);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpRename: WsHandler<SftpRenameMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      deps.localFsManager.rename(msg.oldPath, msg.newPath);
      conn.send({ type: 'sftp:response', requestId, success: true });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    mockObj.fs.rename(msg.oldPath, msg.newPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
    return;
  }
  try {
    await deps.sshManager.sftpRename(sessionId, msg.oldPath, msg.newPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpChmod: WsHandler<SftpChmodMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      deps.localFsManager.chmod(msg.targetPath, msg.mode);
      conn.send({ type: 'sftp:response', requestId, success: true });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    mockObj.fs.chmod(msg.targetPath, msg.mode);
    conn.send({ type: 'sftp:response', requestId, success: true });
    return;
  }
  try {
    await deps.sshManager.sftpChmod(sessionId, msg.targetPath, msg.mode);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpMkdir: WsHandler<SftpMkdirMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  if (deps.localPtyManager.has(sessionId)) {
    try {
      deps.localFsManager.mkdir(msg.dirPath);
      conn.send({ type: 'sftp:response', requestId, success: true });
    } catch (err) {
      conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
    }
    return;
  }
  const mockObj = deps.mockSessions.get(sessionId);
  if (mockObj) {
    mockObj.fs.mkdir(msg.dirPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
    return;
  }
  try {
    await deps.sshManager.sftpMkdir(sessionId, msg.dirPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};
