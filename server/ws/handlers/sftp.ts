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
import { GuardrailPipeline } from '../../application/security/GuardrailPipeline';
import type { WsHandler } from '../types';

const defaultGuardrailPipeline = new GuardrailPipeline();

export const handleSftpList: WsHandler<SftpListMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const files = await provider.list(sessionId, msg.dirPath);
    conn.send({ type: 'sftp:response', requestId, success: true, data: files });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpRead: WsHandler<SftpReadMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const content = await provider.read(sessionId, msg.filePath);
    conn.send({ type: 'sftp:response', requestId, success: true, data: content });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpWrite: WsHandler<SftpWriteMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { session, provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const pipeline = deps.guardrailPipeline ?? defaultGuardrailPipeline;
    const policy = pipeline.evaluate({
      kind: 'fs:write',
      sessionId,
      path: msg.filePath,
      byteLength: Buffer.byteLength(msg.content || '', 'utf-8'),
      sessionRoot: session.filesystem.rootPath
    });
    if (policy.decision === 'deny') {
      conn.send({
        type: 'sftp:response',
        requestId,
        success: false,
        error: policy.assessment.reason || '安全策略拒绝覆写受保护文件'
      });
      return;
    }

    await provider.write(sessionId, msg.filePath, msg.content);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpDelete: WsHandler<SftpDeleteMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { session, provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const pipeline = deps.guardrailPipeline ?? defaultGuardrailPipeline;
    const policy = pipeline.evaluate({
      kind: 'fs:delete',
      sessionId,
      path: msg.targetPath,
      isDirectory: msg.isDirectory,
      sessionRoot: session.filesystem.rootPath
    });
    if (policy.decision === 'deny') {
      conn.send({
        type: 'sftp:response',
        requestId,
        success: false,
        error: policy.assessment.reason || '安全策略拒绝删除受保护路径'
      });
      return;
    }

    await provider.delete(sessionId, msg.targetPath, msg.isDirectory);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpRename: WsHandler<SftpRenameMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { session, provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const pipeline = deps.guardrailPipeline ?? defaultGuardrailPipeline;
    const policy = pipeline.evaluate({
      kind: 'fs:rename',
      sessionId,
      oldPath: msg.oldPath,
      newPath: msg.newPath,
      sessionRoot: session.filesystem.rootPath
    });
    if (policy.decision === 'deny') {
      conn.send({
        type: 'sftp:response',
        requestId,
        success: false,
        error: policy.assessment.reason || '安全策略拒绝移动或重命名受保护路径'
      });
      return;
    }

    await provider.rename(sessionId, msg.oldPath, msg.newPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpChmod: WsHandler<SftpChmodMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { session, provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const numMode = parseInt(msg.mode, 8);
    const pipeline = deps.guardrailPipeline ?? defaultGuardrailPipeline;
    const policy = pipeline.evaluate({
      kind: 'fs:chmod',
      sessionId,
      path: msg.targetPath,
      mode: numMode,
      sessionRoot: session.filesystem.rootPath
    });
    if (policy.decision === 'deny') {
      conn.send({
        type: 'sftp:response',
        requestId,
        success: false,
        error: policy.assessment.reason || '安全策略拒绝修改受保护路径权限'
      });
      return;
    }

    await provider.chmod(sessionId, msg.targetPath, numMode);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};

export const handleSftpMkdir: WsHandler<SftpMkdirMessage> = async (msg, conn, deps) => {
  const { requestId, sessionId } = msg;
  try {
    const { session, provider } = deps.sessionManager.getFileSystemProvider(sessionId);
    const pipeline = deps.guardrailPipeline ?? defaultGuardrailPipeline;
    const policy = pipeline.evaluate({
      kind: 'fs:mkdir',
      sessionId,
      path: msg.dirPath,
      sessionRoot: session.filesystem.rootPath
    });
    if (policy.decision === 'deny') {
      conn.send({
        type: 'sftp:response',
        requestId,
        success: false,
        error: policy.assessment.reason || '安全策略拒绝在该受保护路径创建目录'
      });
      return;
    }

    await provider.mkdir(sessionId, msg.dirPath);
    conn.send({ type: 'sftp:response', requestId, success: true });
  } catch (err) {
    conn.send({ type: 'sftp:response', requestId, success: false, error: errorMessage(err) });
  }
};
