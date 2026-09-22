import React, { useState } from 'react';
import { X, Shield } from 'lucide-react';

import { errorMessage } from '../../../shared/errors';

interface ChmodModalProps {
  filePath: string;
  currentMode: string;
  onConfirm: (mode: string) => Promise<void>;
  onClose: () => void;
}

export const ChmodModal: React.FC<ChmodModalProps> = ({
  filePath,
  currentMode,
  onConfirm,
  onClose
}) => {
  const [mode, setMode] = useState(
    /^[0-7]{3,4}$/.test(currentMode) ? currentMode : '0644'
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-7]{3,4}$/.test(mode)) {
      alert('请输入有效的八进制权限值 (例如 0755 或 0644)');
      return;
    }
    setIsLoading(true);
    try {
      await onConfirm(mode);
      onClose();
    } catch (err) {
      alert(`修改权限失败: ${errorMessage(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="h-9 bg-orca-card px-3 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-semibold text-white">
            <Shield size={14} className="text-orca-accent" />
            <span>修改文件权限 (chmod)</span>
          </div>
          <button onClick={onClose} className="text-orca-muted hover:text-white">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="text-[11px] text-orca-muted block mb-1">目标路径</label>
            <div className="font-mono text-xs text-white bg-orca-card px-2 py-1.5 rounded border border-orca-border truncate">
              {filePath}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-orca-muted block mb-1">权限代码 (八进制)</label>
            <input
              type="text"
              value={mode}
              onChange={e => setMode(e.target.value)}
              placeholder="0644 / 0755"
              className="w-full bg-orca-bg border border-orca-border text-white font-mono text-xs px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
              autoFocus
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-xs bg-orca-card text-orca-muted hover:text-white rounded"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-3 py-1 text-xs bg-orca-accent hover:bg-blue-600 text-white rounded font-medium"
            >
              {isLoading ? '修改中...' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
