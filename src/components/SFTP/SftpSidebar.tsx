import React, { useState, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { useSftp } from '../../hooks/useSftp';
import { FileEntry as FileItem } from '../../types';
import { errorMessage } from '../../../shared/errors';
import { joinPath, getParentPath, isRootPath } from '../../utils/pathUtils';
import { FileTreeItem } from './FileTreeItem';
import { SftpContextMenu } from './SftpContextMenu';
import { FileEditorModal } from './FileEditorModal';
import { ChmodModal } from './ChmodModal';
import {
  Folder,
  RefreshCw,
  Upload,
  FolderPlus,
  FilePlus,
  ArrowUp,
  SidebarClose,
  SidebarOpen
} from 'lucide-react';

export const SftpSidebar: React.FC = () => {
  const { isSidebarCollapsed, setIsSidebarCollapsed } = useSession();
  const {
    currentPath,
    setCurrentPath,
    files,
    loading,
    refresh,
    goUp,
    readFile,
    writeFile,
    deleteItem,
    renameItem,
    chmodItem,
    makeDirectory
  } = useSftp();

  const [width, setWidth] = useState(260);
  const [isResizing, setIsResizing] = useState(false);

  // Modals
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [chmodTarget, setChmodTarget] = useState<FileItem | null>(null);

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);

  // Drag resizer
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(200, Math.min(480, e.clientX));
      setWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Close context menu on window click
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleOpenFileEditor = async (file: FileItem) => {
    try {
      const content = await readFile(file.path);
      setEditingFile({ path: file.path, content });
    } catch (err) {
      alert(`读取文件失败: ${errorMessage(err)}`);
    }
  };

  const handleSaveFileContent = async (newContent: string) => {
    if (!editingFile) return;
    await writeFile(editingFile.path, newContent);
    setEditingFile(prev => (prev ? { ...prev, content: newContent } : null));
  };

  const handleItemDoubleClick = (file: FileItem) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
    } else {
      handleOpenFileEditor(file);
    }
  };

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`确定要彻底删除 ${file.name} 吗？`)) return;
    try {
      await deleteItem(file.path, file.isDirectory);
    } catch (err) {
      alert(`删除失败: ${errorMessage(err)}`);
    }
  };

  const handleRename = async (file: FileItem) => {
    const newName = prompt('输入新的文件名:', file.name);
    if (!newName || newName === file.name) return;
    const parent = getParentPath(file.path);
    const newPath = joinPath(parent, newName);
    try {
      await renameItem(file.path, newPath);
    } catch (err) {
      alert(`重命名失败: ${errorMessage(err)}`);
    }
  };

  const handleNewFile = async () => {
    const name = prompt('输入新文件名 (例如 default.conf):');
    if (!name) return;
    const filePath = joinPath(currentPath, name);
    try {
      await writeFile(filePath, '# New file created with MonoTerminal\n');
    } catch (err) {
      alert(`新建文件失败: ${errorMessage(err)}`);
    }
  };

  const handleNewFolder = async () => {
    const name = prompt('输入新目录名:');
    if (!name) return;
    const dirPath = joinPath(currentPath, name);
    try {
      await makeDirectory(dirPath);
    } catch (err) {
      alert(`新建目录失败: ${errorMessage(err)}`);
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const content = reader.result as string;
          const targetPath = joinPath(currentPath, file.name);
          await writeFile(targetPath, content);
        } catch (err) {
          alert(`上传失败: ${errorMessage(err)}`);
        }
      };
      reader.onerror = () => {
        alert('读取上传文件失败');
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Collapsed Sidebar View (36px strip)
  if (isSidebarCollapsed) {
    return (
      <aside className="w-9 bg-orca-surface border-r border-orca-border flex flex-col items-center py-2 select-none z-20 shrink-0">
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="p-1.5 text-orca-muted hover:text-white hover:bg-orca-card rounded transition-colors"
          title="展开 SFTP 文件树 (Ctrl+B)"
        >
          <SidebarOpen size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="bg-orca-surface border-r border-orca-border flex flex-col h-full select-none z-20 relative shrink-0"
    >
      {/* Top Header */}
      <div className="h-8 bg-orca-surface border-b border-orca-border flex items-center justify-between px-2 text-xs">
        <div className="flex items-center space-x-1.5 font-medium text-white">
          <Folder size={14} className="text-orca-accent" />
          <span className="text-[11px] uppercase tracking-wider text-orca-muted font-semibold">
            SFTP 远程文件
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={refresh}
            className="p-1 text-orca-muted hover:text-white rounded"
            title="刷新文件列表"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setIsSidebarCollapsed(true)}
            className="p-1 text-orca-muted hover:text-white rounded"
            title="折叠侧边栏 (Ctrl+B)"
          >
            <SidebarClose size={14} />
          </button>
        </div>
      </div>

      {/* Path Breadcrumbs / Input Bar */}
      <div className="p-1.5 bg-orca-bg/50 border-b border-orca-border flex items-center space-x-1 text-xs">
        <button
          onClick={goUp}
          disabled={isRootPath(currentPath)}
          className="p-1 text-orca-muted hover:text-white disabled:opacity-30 rounded hover:bg-orca-card"
          title="回退上一级"
        >
          <ArrowUp size={12} />
        </button>

        <input
          type="text"
          value={currentPath}
          onChange={e => setCurrentPath(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') refresh();
          }}
          className="flex-1 bg-orca-surface border border-orca-border text-orca-text font-mono text-[11px] px-1.5 py-0.5 rounded outline-none focus:border-orca-accent truncate"
          title="按 Enter 跳转路径"
        />
      </div>

      {/* Directory File Tree View */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-1 space-y-0.5 font-mono text-xs">
        {files.length === 0 && !loading && (
          <div className="text-center py-8 text-orca-muted text-[11px]">空目录或暂无读取权限</div>
        )}

        {files.map(file => (
          <FileTreeItem
            key={file.path}
            file={file}
            onDoubleClick={handleItemDoubleClick}
            onContextMenu={(e, f) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, file: f });
            }}
          />
        ))}
      </div>

      {/* Bottom Action Bar */}
      <div className="h-8 bg-orca-card border-t border-orca-border flex items-center justify-around px-2 text-orca-muted">
        <button
          onClick={handleUpload}
          className="p-1 hover:text-orca-accent rounded"
          title="上传文件到当前目录"
        >
          <Upload size={13} />
        </button>
        <button
          onClick={handleNewFile}
          className="p-1 hover:text-orca-accent rounded"
          title="新建空白文件"
        >
          <FilePlus size={13} />
        </button>
        <button
          onClick={handleNewFolder}
          className="p-1 hover:text-orca-accent rounded"
          title="新建文件夹"
        >
          <FolderPlus size={13} />
        </button>
        <button onClick={refresh} className="p-1 hover:text-orca-accent rounded" title="刷新目录">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Right Drag Handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-orca-accent/50 transition-colors z-30"
      />

      {/* Context Menu */}
      {contextMenu && (
        <SftpContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          onEdit={handleOpenFileEditor}
          onCopyPath={f => navigator.clipboard.writeText(f.path)}
          onChmod={f => setChmodTarget(f)}
          onRename={handleRename}
          onDelete={handleDelete}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Editor Modal */}
      {editingFile && (
        <FileEditorModal
          filePath={editingFile.path}
          initialContent={editingFile.content}
          onSave={handleSaveFileContent}
          onClose={() => setEditingFile(null)}
        />
      )}

      {/* Chmod Modal */}
      {chmodTarget && (
        <ChmodModal
          filePath={chmodTarget.path}
          currentMode={chmodTarget.permissions}
          onConfirm={async mode => {
            await chmodItem(chmodTarget.path, mode);
          }}
          onClose={() => setChmodTarget(null)}
        />
      )}
    </aside>
  );
};
