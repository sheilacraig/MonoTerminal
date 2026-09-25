import { useState, useEffect, useCallback } from 'react';
import { FileEntry, FileItem } from '../types';
import { useSession } from '../context/SessionContext';
import { useWebSocket } from '../context/WebSocketContext';

import { normalizePath, getParentPath } from '../utils/pathUtils';

export function useSftp() {
  const { activeSession } = useSession();
  const { requestSftp } = useWebSocket();

  // Read primitives (id/cwd) rather than the whole `activeSession` object.
  // `activeSession` gets a new reference on every `setSessions` call — which
  // happens on every terminal write via `appendTerminalContext` — so depending
  // on the object directly would make `loadDirectory` churn and re-fire the
  // SFTP list request on every keystroke.
  const activeSessionId = activeSession?.id;
  const activeSessionCwd = activeSession?.cwd;

  const [currentPath, setCurrentPath] = useState<string>(
    activeSessionCwd ? normalizePath(activeSessionCwd) : '/etc/nginx'
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Follow the terminal's cwd: fires on tab switch AND whenever the shell
  // reports a directory change (e.g. user runs `cd /var/log`). Previously the
  // dependency array only listed `activeSession?.id`, so cd-driven updates
  // never propagated to the SFTP sidebar.
  useEffect(() => {
    if (activeSessionCwd) {
      const normalized = normalizePath(activeSessionCwd);
      if (normalized !== currentPath) {
        setCurrentPath(normalized);
      }
    }
  }, [activeSessionId, activeSessionCwd, currentPath]);

  // Load files for currentPath
  const loadDirectory = useCallback(
    async (dir: string) => {
      if (!activeSessionId) return;
      setLoading(true);
      try {
        const items = await requestSftp<FileItem[]>('sftp:list', {
          sessionId: activeSessionId,
          dirPath: dir
        });
        setFiles(items || []);
      } catch (err) {
        console.warn('Failed to load sftp directory', err);
      } finally {
        setLoading(false);
      }
    },
    [activeSessionId, requestSftp]
  );

  useEffect(() => {
    if (activeSessionId) {
      loadDirectory(currentPath);
    }
  }, [currentPath, activeSessionId, loadDirectory]);

  // Navigate up
  const goUp = useCallback(() => {
    setCurrentPath(prev => getParentPath(prev));
  }, []);

  // Read file
  const readFile = useCallback(
    async (filePath: string): Promise<string> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      return await requestSftp<string>('sftp:read', {
        sessionId: activeSessionId,
        filePath
      });
    },
    [activeSessionId, requestSftp]
  );

  // Write file
  const writeFile = useCallback(
    async (filePath: string, content: string): Promise<void> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      await requestSftp('sftp:write', {
        sessionId: activeSessionId,
        filePath,
        content
      });
      loadDirectory(currentPath);
    },
    [activeSessionId, requestSftp, loadDirectory, currentPath]
  );

  // Delete file or dir
  const deleteItem = useCallback(
    async (targetPath: string, isDirectory: boolean): Promise<void> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      await requestSftp('sftp:delete', {
        sessionId: activeSessionId,
        targetPath,
        isDirectory
      });
      loadDirectory(currentPath);
    },
    [activeSessionId, requestSftp, loadDirectory, currentPath]
  );

  // Rename
  const renameItem = useCallback(
    async (oldPath: string, newPath: string): Promise<void> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      await requestSftp('sftp:rename', {
        sessionId: activeSessionId,
        oldPath,
        newPath
      });
      loadDirectory(currentPath);
    },
    [activeSessionId, requestSftp, loadDirectory, currentPath]
  );

  // Chmod
  const chmodItem = useCallback(
    async (targetPath: string, mode: string): Promise<void> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      await requestSftp('sftp:chmod', {
        sessionId: activeSessionId,
        targetPath,
        mode
      });
      loadDirectory(currentPath);
    },
    [activeSessionId, requestSftp, loadDirectory, currentPath]
  );

  // Mkdir
  const makeDirectory = useCallback(
    async (dirPath: string): Promise<void> => {
      if (!activeSessionId) throw new Error('无活跃会话');
      await requestSftp('sftp:mkdir', {
        sessionId: activeSessionId,
        dirPath
      });
      loadDirectory(currentPath);
    },
    [activeSessionId, requestSftp, loadDirectory, currentPath]
  );

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
