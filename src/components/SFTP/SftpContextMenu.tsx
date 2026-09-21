import React from 'react';
import { FileItem } from '../../types';
import { Edit, Copy, Shield, Trash2 } from 'lucide-react';

interface SftpContextMenuProps {
  x: number;
  y: number;
  file: FileItem;
  onEdit: (file: FileItem) => void;
  onCopyPath: (file: FileItem) => void;
  onChmod: (file: FileItem) => void;
  onRename: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  onClose: () => void;
}

export const SftpContextMenu: React.FC<SftpContextMenuProps> = ({
  x,
  y,
  file,
  onEdit,
  onCopyPath,
  onChmod,
  onRename,
  onDelete,
  onClose
}) => {
  return (
    <div
      style={{ top: `${y}px`, left: `${x}px` }}
      className="fixed z-50 bg-orca-surface border border-orca-border rounded shadow-xl py-1 w-40 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
      onClick={e => e.stopPropagation()}
    >
      {!file.isDirectory && (
        <button
          onClick={() => {
            onEdit(file);
            onClose();
          }}
          className="w-full text-left px-3 py-1.5 hover:bg-orca-card flex items-center space-x-2 text-white"
        >
          <Edit size={12} className="text-orca-accent" />
          <span>在线编辑</span>
        </button>
      )}

      <button
        onClick={() => {
          onCopyPath(file);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-orca-card flex items-center space-x-2 text-orca-text"
      >
        <Copy size={12} />
        <span>复制路径</span>
      </button>

      <button
        onClick={() => {
          onChmod(file);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-orca-card flex items-center space-x-2 text-orca-text"
      >
        <Shield size={12} className="text-orca-warning" />
        <span>修改权限 (chmod)</span>
      </button>

      <button
        onClick={() => {
          onRename(file);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-orca-card flex items-center space-x-2 text-orca-text"
      >
        <Edit size={12} />
        <span>重命名</span>
      </button>

      <div className="h-px bg-orca-border my-1" />

      <button
        onClick={() => {
          onDelete(file);
          onClose();
        }}
        className="w-full text-left px-3 py-1.5 hover:bg-orca-danger/20 text-orca-danger flex items-center space-x-2"
      >
        <Trash2 size={12} />
        <span>删除</span>
      </button>
    </div>
  );
};
