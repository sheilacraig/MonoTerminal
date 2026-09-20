import React from 'react';
import { FileItem } from '../../types';
import { Folder, File, FileCode, FileText } from 'lucide-react';

interface FileTreeItemProps {
  file: FileItem;
  onDoubleClick: (file: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, file: FileItem) => void;
}

export const FileTreeItem: React.FC<FileTreeItemProps> = ({
  file,
  onDoubleClick,
  onContextMenu
}) => {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = () => {
    if (file.isDirectory) {
      return <Folder size={14} className="text-yellow-400 shrink-0" />;
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['conf', 'cfg', 'yaml', 'yml', 'json', 'toml', 'env'].includes(ext || '')) {
      return <FileCode size={14} className="text-orca-accent shrink-0" />;
    }
    if (['log', 'txt', 'md'].includes(ext || '')) {
      return <FileText size={14} className="text-orca-muted shrink-0" />;
    }
    return <File size={14} className="text-orca-text shrink-0" />;
  };

  return (
    <div
      onDoubleClick={() => onDoubleClick(file)}
      onContextMenu={(e) => onContextMenu(e, file)}
      className="flex items-center justify-between px-2 py-1 rounded hover:bg-orca-hover cursor-pointer group transition-colors select-none"
    >
      <div className="flex items-center space-x-2 truncate flex-1 mr-2">
        {getFileIcon()}
        <span className={`truncate text-[11px] ${file.isDirectory ? 'font-medium text-white' : 'text-orca-text'}`}>
          {file.name}
        </span>
      </div>

      <span className="text-[10px] text-orca-muted opacity-60 group-hover:opacity-100 shrink-0">
        {file.isDirectory ? '-' : formatSize(file.size)}
      </span>
    </div>
  );
};
