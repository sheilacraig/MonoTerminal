import React, { useState, useEffect } from 'react';
import { X, Save, FileCode, Check } from 'lucide-react';

interface FileEditorModalProps {
  filePath: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  filePath,
  initialContent,
  onSave,
  onClose
}) => {
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const isDirty = content !== initialContent;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(content);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  // Listen for Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        if (!isDirty || confirm('有未保存的修改，确定退出吗？')) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [content, isDirty]);

  const lines = content.split('\n');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-lg shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-10 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileCode size={16} className="text-orca-accent" />
            <span className="font-mono text-xs text-white truncate max-w-md">
              {filePath}
            </span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-orca-warning" title="有未保存修改" />
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className={`flex items-center space-x-1 px-3 py-1 text-xs rounded transition-all ${
                isSaved
                  ? 'bg-orca-success text-white'
                  : isDirty
                  ? 'bg-orca-accent hover:bg-blue-600 text-white font-medium'
                  : 'bg-orca-card text-orca-muted cursor-not-allowed'
              }`}
              title="保存文件 (Ctrl+S)"
            >
              {isSaved ? <Check size={13} /> : <Save size={13} />}
              <span>{isSaving ? '保存中...' : isSaved ? '已保存' : '保存 (Ctrl+S)'}</span>
            </button>

            <button
              onClick={() => {
                if (!isDirty || confirm('有未保存的修改，确定关闭吗？')) {
                  onClose();
                }
              }}
              className="p-1 hover:bg-orca-border text-orca-muted hover:text-white rounded"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Editor Body */}
        <div className="flex-1 flex overflow-hidden bg-[#0a0d12]">
          {/* Line Numbers */}
          <div className="w-12 bg-orca-surface/40 text-orca-muted font-mono text-xs text-right pr-3 pt-3 select-none border-r border-orca-border/50">
            {lines.map((_, i) => (
              <div key={i} className="leading-5 h-5 text-[11px] opacity-60">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Textarea code editor */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 bg-transparent text-orca-text font-mono text-xs p-3 leading-5 outline-none resize-none focus:ring-0 overflow-auto whitespace-pre"
            spellCheck={false}
            autoFocus
          />
        </div>

        {/* Footer info */}
        <div className="h-6 bg-orca-card px-4 border-t border-orca-border text-[11px] text-orca-muted flex items-center justify-between font-mono">
          <span>行数: {lines.length} | 字符数: {content.length}</span>
          <span>按 [Ctrl + S] 保存并写回远端服务器</span>
        </div>
      </div>
    </div>
  );
};
