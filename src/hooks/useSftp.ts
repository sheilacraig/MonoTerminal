import { useState, useEffect, useCallback } from 'react';
import { FileItem } from '../types';
import { useSession } from '../context/SessionContext';
import { useWebSocket } from '../context/WebSocketContext';

export function useSftp() {
  const { activeSession } = useSession();
  const { requestSftp } = useWebSocket();

  const [currentPath, setCurrentPath] = useState<string>('/etc/nginx');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Sync initial dir from active session
  useEffect(() => {
    if (activeSession?.cwd && activeSession.cwd !== currentPath) {
      setCurrentPath(activeSession.cwd);
    }
  }, [activeSession?.id]);

  // Load files for currentPath
  const loadDirectory = useCallback(async (dir: string) => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const items = await requestSftp<FileItem[]>('sftp:list', {
        sessionId: activeSession.id,
        dirPath: dir
      });
      setFiles(items || []);
    } catch (err) {
      console.warn('Failed to load sftp directory', err);
    } finally {
      setLoading(false);
    }
  }, [activeSession, requestSftp]);

  useEffect(() => {
    if (activeSession) {
      loadDirectory(currentPath);
    }
  }, [currentPath, activeSession?.id, loadDirectory]);

  // Navigate up
  const goUp = useCallback(() => {
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    setCurrentPath(parent);
  }, [currentPath]);

  // Read file
  const readFile = useCallback(async (filePath: string): Promise<string> => {
    if (!activeSession) throw new Error('无活跃会话');
    return await requestSftp<string>('sftp:read', {
      sessionId: activeSession.id,
      filePath
    });
  }, [activeSession, requestSftp]);

  // Write file
  const writeFile = useCallback(async (filePath: string, content: string): Promise<void> => {
    if (!activeSession) throw new Error('无活跃会话');
    await requestSftp('sftp:write', {
      sessionId: activeSession.id,
      filePath,
      content
    });
    loadDirectory(currentPath);
  }, [activeSession, requestSftp, loadDirectory, currentPath]);

  // Delete file or dir
  const deleteItem = useCallback(async (targetPath: string, isDirectory: boolean): Promise<void> => {
    if (!activeSession) throw new Error('无活跃会话');
    await requestSftp('sftp:delete', {
      sessionId: activeSession.id,
      targetPath,
      isDirectory
    });
    loadDirectory(currentPath);
  }, [activeSession, requestSftp, loadDirectory, currentPath]);

  // Rename
  const renameItem = useCallback(async (oldPath: string, newPath: string): Promise<void> => {
    if (!activeSession) throw new Error('无活跃会话');
    await requestSftp('sftp:rename', {
      sessionId: activeSession.id,
      oldPath,
      newPath
    });
    loadDirectory(currentPath);
  }, [activeSession, requestSftp, loadDirectory, currentPath]);

  // Chmod
  const chmodItem = useCallback(async (targetPath: string, mode: string): Promise<void> => {
    if (!activeSession) throw new Error('无活跃会话');
    await requestSftp('sftp:chmod', {
      sessionId: activeSession.id,
      targetPath,
      mode
    });
    loadDirectory(currentPath);
  }, [activeSession, requestSftp, loadDirectory, currentPath]);

  // Mkdir
  const makeDirectory = useCallback(async (dirPath: string): Promise<void> => {
    if (!activeSession) throw new Error('无活跃会话');
    await requestSftp('sftp:mkdir', {
      sessionId: activeSession.id,
      dirPath
    });
    loadDirectory(currentPath);
  }, [activeSession, requestSftp, loadDirectory, currentPath]);

  return {
    currentPath,
    setCurrentPath,
    files,
    loading,
    refresh: () => loadDirectory(currentPath),
    goUp,
    readFile,
    writeFile,
    deleteItem,
    renameItem,
    chmodItem,
    makeDirectory
  };
}
