import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { useSftp } from '../../hooks/useSftp';
import { FileEntry as FileItem, HostAsset } from '../../types';
import { errorMessage } from '../../../shared/errors';
import { joinPath, getParentPath, isRootPath } from '../../utils/pathUtils';
import {
  formatSshCommand,
  normalizeHostGroup
} from '../../utils/quickConnect';
import { FileTreeItem } from './FileTreeItem';
import { SftpContextMenu } from './SftpContextMenu';
import { FileEditorModal } from './FileEditorModal';
import { ChmodModal } from './ChmodModal';
import {
  Folder,
  Server,
  Search,
  Plus,
  Settings,
  SlidersHorizontal,
  RefreshCw,
  Upload,
  FolderPlus,
  FilePlus,
  ArrowUp,
  SidebarClose,
  SidebarOpen,
  ChevronRight
} from 'lucide-react';

const PRESET_GROUPS = ['生产环境', '测试环境', '本机终端'];

export const SftpSidebar: React.FC = () => {
  const {
    sessions,
    activeSession,
    setActiveSessionId,
    hosts,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    sidebarTab,
    setSidebarTab,
    createSession,
    connectInCurrentTab,
    openHostModal,
    setIsSettingsModalOpen,
    saveHost,
    deleteHost
  } = useSession();

  const { activeAIProvider } = useSettings();
  const isAiUnconfigured = Boolean(
    activeAIProvider &&
      activeAIProvider.type !== 'ollama' &&
      activeAIProvider.type !== 'mock' &&
      !activeAIProvider.apiKeyEncrypted &&
      !activeAIProvider.plainApiKey
  );

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

  const [width, setWidth] = useState(268);
  const [isResizing, setIsResizing] = useState(false);

  // Session Tab state
  const [sessionSearch, setSessionSearch] = useState('');
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [draggingHostId, setDraggingHostId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [hostContextMenu, setHostContextMenu] = useState<{
    x: number;
    y: number;
    host: HostAsset;
  } | null>(null);
  const [showMoveGroupSubmenu, setShowMoveGroupSubmenu] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // File Tab Modals & Context Menu
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [chmodTarget, setChmodTarget] = useState<FileItem | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);

  // Keep selectedHostId synced with activeSession if not explicitly chosen
  useEffect(() => {
    if (!selectedHostId && activeSession?.hostId) {
      setSelectedHostId(activeSession.hostId);
    } else if (selectedHostId && !hosts.some(h => h.id === selectedHostId) && hosts.length > 0) {
      setSelectedHostId(activeSession?.hostId || hosts[0].id);
    }
  }, [activeSession?.hostId, hosts, selectedHostId]);

  // Ctrl + Shift + S -> Focus Session Search Input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.dataset?.shortcutRecorder === 'true') {
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'S' || e.key === 's' || e.code === 'KeyS')
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsSidebarCollapsed(false);
        setSidebarTab('sessions');
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 20);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [setIsSidebarCollapsed, setSidebarTab]);

  // Drag resizer
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(210, Math.min(480, e.clientX));
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

  // Close context menus on window click
  useEffect(() => {
    const handleClick = () => {
      setFileContextMenu(null);
      setHostContextMenu(null);
      setShowMoveGroupSubmenu(false);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Group and filter hosts for the Session tab
  const groupedHosts = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    const filtered = hosts.filter(h => {
      if (!q) return true;
      const groupName = normalizeHostGroup(h).toLowerCase();
      return (
        h.name.toLowerCase().includes(q) ||
        h.host.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q) ||
        groupName.includes(q)
      );
    });

    const map = new Map<string, HostAsset[]>();
    for (const h of filtered) {
      const group = normalizeHostGroup(h);
      const list = map.get(group) || [];
      list.push(h);
      map.set(group, list);
    }

    // Order: remote/custom groups first (生产环境, 测试环境, ...), then 本机终端 at the bottom
    const entries = Array.from(map.entries());
    entries.sort(([gA], [gB]) => {
      if (gA === '本机终端' && gB !== '本机终端') return 1;
      if (gB === '本机终端' && gA !== '本机终端') return -1;
      const idxA = PRESET_GROUPS.indexOf(gA);
      const idxB = PRESET_GROUPS.indexOf(gB);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return gA.localeCompare(gB, 'zh-CN');
    });

    return entries;
  }, [hosts, sessionSearch]);

  const allCandidateGroups = useMemo(() => {
    return Array.from(
      new Set([...PRESET_GROUPS, ...hosts.map(h => normalizeHostGroup(h)).filter(Boolean)])
    );
  }, [hosts]);

  const selectedHost = useMemo(() => {
    return (
      hosts.find(h => h.id === selectedHostId) ||
      hosts.find(h => h.id === activeSession?.hostId) ||
      hosts[0] ||
      null
    );
  }, [hosts, selectedHostId, activeSession?.hostId]);

  const handleToggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  const handleMoveHostToGroup = async (host: HostAsset, targetGroup: string) => {
    const normalizedCurrent = normalizeHostGroup(host);
    if (!targetGroup.trim() || normalizedCurrent === targetGroup.trim()) return;
    await saveHost({
      ...host,
      group: targetGroup.trim()
    });
  };

  const handleDuplicateHost = async (host: HostAsset) => {
    const saved = await saveHost({
      name: `${host.name} (副本)`,
      group: normalizeHostGroup(host),
      host: host.host,
      port: host.port,
      username: host.username,
      authType: host.authType,
      privateKeyPath: host.privateKeyPath,
      initialDir: host.initialDir,
      copyCredentialsFromId: host.id
    });
    if (saved) {
      setSelectedHostId(saved.id);
    }
  };

  const handleOpenHostFiles = (host: HostAsset) => {
    // Switch to an open session for this host, or connect in current tab
    const existingSession = sessions.find(s => s.hostId === host.id);
    if (existingSession) {
      setActiveSessionId(existingSession.id);
    } else {
      connectInCurrentTab(host);
    }
    setSidebarTab('files');
  };

  // File Tab handlers
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

  const handleDeleteFile = async (file: FileItem) => {
    if (!confirm(`确定要彻底删除 ${file.name} 吗？`)) return;
    try {
      await deleteItem(file.path, file.isDirectory);
    } catch (err) {
      alert(`删除失败: ${errorMessage(err)}`);
    }
  };

  const handleRenameFile = async (file: FileItem) => {
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

  // Render host status dot according to specification:
  // ● 已连接（有活动会话）
  // ○ 未连接
  // ● 连接中 / 重连中
  // ● 本地 Shell / 沙盒
  const renderHostStatusDot = (host: HostAsset) => {
    const hostSessions = sessions.filter(s => s.hostId === host.id);
    const isConnecting = hostSessions.some(
      s => s.status === 'connecting' || s.status === 'busy'
    );
    const isConnected = hostSessions.some(s => s.status === 'connected');
    const isLocalOrSandbox = host.authType === 'local' || host.authType === 'mock';

    if (isConnecting) {
      return (
        <span
          className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"
          title="连接中 / 重连中"
        />
      );
    }

    if (isLocalOrSandbox) {
      return (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isConnected
              ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]'
              : 'bg-sky-400/80'
          }`}
          title="本地 Shell / 沙盒"
        />
      );
    }

    if (isConnected) {
      return (
        <span
          className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0"
          title="已连接（有活动会话）"
        />
      );
    }

    return (
      <span
        className="w-2 h-2 rounded-full border border-orca-muted bg-transparent shrink-0"
        title="未连接"
      />
    );
  };

  // Collapsed Sidebar View (36px strip)
  if (isSidebarCollapsed) {
    return (
      <aside className="w-9 bg-orca-surface border-r border-orca-border flex flex-col items-center py-2 space-y-2 select-none z-20 shrink-0">
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="p-1.5 text-orca-muted hover:text-white hover:bg-orca-card rounded transition-colors"
          title="展开侧边栏 (Ctrl+Shift+B)"
        >
          <SidebarOpen size={15} />
        </button>

        <div className="w-5 border-t border-orca-border" />

        <button
          onClick={() => {
            setSidebarTab('sessions');
            setIsSidebarCollapsed(false);
          }}
          className={`p-1.5 rounded transition-colors ${
            sidebarTab === 'sessions'
              ? 'text-orca-accent bg-orca-card'
              : 'text-orca-muted hover:text-white hover:bg-orca-card'
          }`}
          title="会话面板 (Alt+1)"
        >
          <Server size={15} />
        </button>

        <button
          onClick={() => {
            setSidebarTab('files');
            setIsSidebarCollapsed(false);
          }}
          className={`p-1.5 rounded transition-colors ${
            sidebarTab === 'files'
              ? 'text-orca-accent bg-orca-card'
              : 'text-orca-muted hover:text-white hover:bg-orca-card'
          }`}
          title="文件面板 (Alt+2)"
        >
          <Folder size={15} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setIsSettingsModalOpen(true)}
          className="relative p-1.5 bg-orca-accent/15 border border-orca-accent/40 text-orca-accent hover:text-white hover:bg-orca-accent/25 rounded-md transition-colors"
          title="全局设置：AI 模型 · 终端 · 安全锁 (Ctrl+,)"
        >
          <Settings size={15} />
          {isAiUnconfigured && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_6px_#f59e0b] absolute -top-0.5 -right-0.5" />
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="bg-orca-surface border-r border-orca-border flex flex-col h-full select-none z-20 relative shrink-0"
    >
      {/* Dual-Tab Dock Header: 会话 (Alt+1) / 文件 (Alt+2) */}
      <div className="h-9 bg-orca-surface border-b border-orca-border flex items-center justify-between px-1.5 text-xs shrink-0">
        <div className="flex items-center h-full space-x-0.5 flex-1">
          <button
            onClick={() => setSidebarTab('sessions')}
            className={`flex items-center justify-center space-x-1.5 px-3 h-full border-b-2 transition-colors text-xs ${
              sidebarTab === 'sessions'
                ? 'border-orca-accent text-white font-semibold bg-orca-bg/40'
                : 'border-transparent text-orca-muted hover:text-orca-text'
            }`}
            title="会话列表 (Alt+1)"
          >
            <Server
              size={13}
              className={sidebarTab === 'sessions' ? 'text-orca-accent' : 'text-orca-muted'}
            />
            <span>会话</span>
          </button>

          <button
            onClick={() => setSidebarTab('files')}
            className={`flex items-center justify-center space-x-1.5 px-3 h-full border-b-2 transition-colors text-xs ${
              sidebarTab === 'files'
                ? 'border-orca-accent text-white font-semibold bg-orca-bg/40'
                : 'border-transparent text-orca-muted hover:text-orca-text'
            }`}
            title="远程/本地文件树 (Alt+2)"
          >
            <Folder
              size={13}
              className={sidebarTab === 'files' ? 'text-orca-accent' : 'text-orca-muted'}
            />
            <span>文件</span>
          </button>
        </div>

        <div className="flex items-center space-x-0.5">
          {sidebarTab === 'files' && (
            <button
              onClick={refresh}
              className="p-1 text-orca-muted hover:text-white rounded hover:bg-orca-card"
              title="刷新文件列表"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={() => setIsSidebarCollapsed(true)}
            className="p-1 text-orca-muted hover:text-white rounded hover:bg-orca-card"
            title="折叠侧边栏 (Ctrl+Shift+B)"
          >
            <SidebarClose size={14} />
          </button>
        </div>
      </div>

      {/* ===================== TAB 1: 会话 (SESSIONS) ===================== */}
      {sidebarTab === 'sessions' ? (
        <>
          {/* Search / Filter Bar */}
          <div className="p-2 bg-orca-bg/40 border-b border-orca-border shrink-0">
            <div className="relative flex items-center">
              <Search size={12} className="absolute left-2 text-orca-muted pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setSessionSearch('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder="搜索 / 过滤"
                className="w-full bg-orca-surface border border-orca-border text-orca-text text-xs pl-7 pr-14 py-1 rounded outline-none focus:border-orca-accent"
                title="搜索主机名称、IP、用户或分组 (Ctrl+Shift+S)"
              />
              {sessionSearch ? (
                <button
                  onClick={() => setSessionSearch('')}
                  className="absolute right-2 text-[10px] text-orca-muted hover:text-white"
                >
                  清除
                </button>
              ) : (
                <span className="absolute right-2 text-[10px] text-orca-muted/70 font-mono pointer-events-none">
                  ⌃⇧S
                </span>
              )}
            </div>
          </div>

          {/* Collapsible Host Groups Tree */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-1.5 space-y-1 text-xs">
            {groupedHosts.length === 0 && (
              <div className="text-center py-8 text-orca-muted text-[11px]">
                未找到匹配的会话
              </div>
            )}

            {groupedHosts.map(([groupName, groupItems]) => {
              const isCollapsed = Boolean(collapsedGroups[groupName]);
              const isDropTarget = dragOverGroup === groupName;

              return (
                <div
                  key={groupName}
                  onDragOver={e => {
                    if (!draggingHostId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverGroup !== groupName) {
                      setDragOverGroup(groupName);
                    }
                  }}
                  onDragLeave={e => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverGroup(prev => (prev === groupName ? null : prev));
                    }
                  }}
                  onDrop={e => {
                    e.preventDefault();
                    setDragOverGroup(null);
                    const hostId = e.dataTransfer.getData('text/plain') || draggingHostId;
                    setDraggingHostId(null);
                    const draggedHost = hosts.find(h => h.id === hostId);
                    if (draggedHost) {
                      void handleMoveHostToGroup(draggedHost, groupName);
                    }
                  }}
                  className={`rounded transition-colors ${
                    isDropTarget ? 'bg-orca-accent/10 ring-1 ring-orca-accent/50' : ''
                  }`}
                >
                  {/* Group Header */}
                  <button
                    type="button"
                    onClick={() => handleToggleGroup(groupName)}
                    className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-semibold text-orca-muted hover:text-white rounded hover:bg-orca-card/50 transition-colors"
                  >
                    <div className="flex items-center space-x-1 truncate">
                      <span className="w-3 text-center font-mono text-[10px]">
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                      <span className="truncate">{groupName}</span>
                      {groupName !== '本机终端' && (
                        <span className="text-[10px] text-orca-muted/80 font-normal">
                          ({groupItems.length})
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Group Host Rows */}
                  {!isCollapsed && (
                    <div className="mt-0.5 space-y-0.5 pl-2">
                      {groupItems.map(host => {
                        const isSelected = selectedHost?.id === host.id;
                        const isActiveHost = activeSession?.hostId === host.id;
                        const isLocalOrSandbox =
                          host.authType === 'local' || host.authType === 'mock';
                        const addressText = isLocalOrSandbox
                          ? ''
                          : host.port && host.port !== 22
                            ? `${host.host}:${host.port}`
                            : host.host;

                        return (
                          <div
                            key={host.id}
                            draggable
                            onDragStart={e => {
                              setDraggingHostId(host.id);
                              e.dataTransfer.setData('text/plain', host.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              setDraggingHostId(null);
                              setDragOverGroup(null);
                            }}
                            onClick={() => setSelectedHostId(host.id)}
                            onDoubleClick={e => {
                              setSelectedHostId(host.id);
                              if (e.ctrlKey || e.metaKey) {
                                createSession(host);
                              } else {
                                connectInCurrentTab(host);
                              }
                            }}
                            onAuxClick={e => {
                              if (e.button === 1) {
                                e.preventDefault();
                                setSelectedHostId(host.id);
                                createSession(host);
                              }
                            }}
                            onContextMenu={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedHostId(host.id);
                              setShowMoveGroupSubmenu(false);
                              setHostContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                host
                              });
                            }}
                            className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-orca-accent/15 text-white border border-orca-accent/40'
                                : isActiveHost
                                  ? 'bg-orca-card/80 text-white border border-transparent'
                                  : 'text-orca-text hover:bg-orca-card/60 border border-transparent'
                            }`}
                            title={`${host.name}${addressText ? ` (${ host.username }@${addressText})` : ''}\n双击: 当前标签连接 | Ctrl+双击 / 中键: 新标签打开 | 拖拽: 跨分组移动`}
                          >
                            <div className="flex items-center space-x-2 min-w-0 flex-1">
                              {renderHostStatusDot(host)}
                              <span className="truncate text-xs font-medium">{host.name}</span>
                            </div>

                            {addressText && (
                              <span className="font-mono text-[10px] text-orca-muted ml-2 shrink-0">
                                {addressText}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Upper Footer Row: Session Actions (＋ 新建会话 | 🎛 属性) */}
          <div className="h-9 bg-orca-card border-t border-orca-border flex items-center justify-between px-2 gap-1.5 text-xs shrink-0">
            <button
              onClick={() => openHostModal(null)}
              className="flex-1 flex items-center justify-center space-x-1 py-1 px-2 bg-orca-surface hover:bg-orca-hover border border-orca-border text-white rounded transition-colors"
              title="新建会话 (Ctrl+Shift+N)"
            >
              <Plus size={13} className="text-orca-accent" />
              <span className="text-[11px] font-medium">新建会话</span>
            </button>

            <button
              onClick={() => openHostModal(selectedHost)}
              disabled={!selectedHost}
              className="flex items-center justify-center space-x-1 py-1 px-3 bg-orca-surface hover:bg-orca-hover border border-orca-border text-orca-text hover:text-white disabled:opacity-40 rounded transition-colors"
              title={selectedHost ? `编辑 "${selectedHost.name}" 属性` : '编辑会话属性'}
            >
              <SlidersHorizontal size={12} className="text-orca-muted" />
              <span className="text-[11px]">属性</span>
            </button>
          </div>
        </>
      ) : (
        /* ===================== TAB 2: 文件 (FILES / SFTP) ===================== */
        <>
          {/* Path Breadcrumbs / Input Bar */}
          <div className="p-1.5 bg-orca-bg/50 border-b border-orca-border flex items-center space-x-1 text-xs shrink-0">
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
              <div className="text-center py-8 text-orca-muted text-[11px]">
                空目录或暂无读取权限
              </div>
            )}

            {files.map(file => (
              <FileTreeItem
                key={file.path}
                file={file}
                onDoubleClick={handleItemDoubleClick}
                onContextMenu={(e, f) => {
                  e.preventDefault();
                  setFileContextMenu({ x: e.clientX, y: e.clientY, file: f });
                }}
              />
            ))}
          </div>

          {/* Bottom File Action Bar */}
          <div className="h-9 bg-orca-card border-t border-orca-border flex items-center justify-around px-2 text-orca-muted shrink-0">
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
            <button
              onClick={refresh}
              className="p-1 hover:text-orca-accent rounded"
              title="刷新目录"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </>
      )}

      {/* Lower Footer Row: Persistent Global Settings Bar (方案一) */}
      <button
        type="button"
        onClick={() => setIsSettingsModalOpen(true)}
        className="w-full px-2.5 py-2 border-t border-orca-border bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 hover:from-blue-500/20 hover:via-indigo-500/20 hover:to-purple-500/20 flex items-center justify-between transition-all group shrink-0 text-left"
        title="打开全局设置：配置 AI 大模型密钥、终端字体与安全锁 (Ctrl+,)"
      >
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-orca-accent/15 border border-orca-accent/40 flex items-center justify-center text-orca-accent group-hover:bg-orca-accent group-hover:text-white transition-colors shrink-0">
            <Settings size={13} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] font-semibold text-white">全局设置</span>
              {isAiUnconfigured && (
                <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[9px] font-medium leading-tight">
                  待配置 AI
                </span>
              )}
            </div>
            <div className="text-[10px] text-orca-muted truncate">
              AI 模型 · 终端 · 安全锁
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {isAiUnconfigured && (
            <span
              className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_#f59e0b]"
              title="尚未配置 AI 模型 API Key，点击前往设置"
            />
          )}
          <kbd className="px-1.5 py-0.5 rounded bg-orca-surface border border-orca-border text-[10px] font-mono text-orca-muted group-hover:text-white transition-colors">
            Ctrl+,
          </kbd>
        </div>
      </button>

      {/* Right Drag Handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-orca-accent/50 transition-colors z-30"
      />

      {/* Host Item Context Menu */}
      {hostContextMenu && (
        <div
          style={{
            top: Math.min(hostContextMenu.y, window.innerHeight - 280),
            left: Math.min(hostContextMenu.x, window.innerWidth - 200)
          }}
          onClick={e => e.stopPropagation()}
          className="fixed z-50 w-44 bg-orca-card border border-orca-border rounded-lg shadow-2xl py-1 text-xs text-orca-text select-none"
        >
          <button
            onClick={() => {
              connectInCurrentTab(hostContextMenu.host);
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            连接（当前标签）
          </button>

          <button
            onClick={() => {
              createSession(hostContextMenu.host);
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            在新标签中打开
          </button>

          <button
            onClick={() => {
              handleOpenHostFiles(hostContextMenu.host);
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            打开文件管理
          </button>

          <div className="my-1 border-t border-orca-border" />

          <button
            onClick={() => {
              openHostModal(hostContextMenu.host);
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            编辑属性…
          </button>

          <button
            onClick={() => {
              void handleDuplicateHost(hostContextMenu.host);
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            复制会话
          </button>

          <button
            onClick={() => {
              void navigator.clipboard.writeText(formatSshCommand(hostContextMenu.host));
              setHostContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
          >
            复制 SSH 命令
          </button>

          {/* Move to Group Submenu */}
          <div
            className="relative"
            onMouseEnter={() => setShowMoveGroupSubmenu(true)}
            onMouseLeave={() => setShowMoveGroupSubmenu(false)}
          >
            <button
              type="button"
              onClick={() => setShowMoveGroupSubmenu(prev => !prev)}
              className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors"
            >
              <span>移动到分组</span>
              <ChevronRight size={12} />
            </button>

            {showMoveGroupSubmenu && (
              <div className="absolute left-full top-0 ml-0.5 w-36 bg-orca-card border border-orca-border rounded-lg shadow-2xl py-1 text-xs">
                {allCandidateGroups.map(groupOption => {
                  const isCurrent = normalizeHostGroup(hostContextMenu.host) === groupOption;
                  return (
                    <button
                      key={groupOption}
                      onClick={() => {
                        void handleMoveHostToGroup(hostContextMenu.host, groupOption);
                        setHostContextMenu(null);
                        setShowMoveGroupSubmenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-orca-accent hover:text-white transition-colors flex items-center justify-between ${
                        isCurrent ? 'text-orca-accent font-semibold' : ''
                      }`}
                    >
                      <span className="truncate">{groupOption}</span>
                      {isCurrent && <span className="text-[10px]">✓</span>}
                    </button>
                  );
                })}
                <div className="my-1 border-t border-orca-border" />
                <button
                  onClick={() => {
                    const target = hostContextMenu.host;
                    setHostContextMenu(null);
                    setShowMoveGroupSubmenu(false);
                    const customGroup = prompt('输入新分组名称:', '');
                    if (customGroup?.trim()) {
                      void handleMoveHostToGroup(target, customGroup.trim());
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-orca-accent hover:bg-orca-accent hover:text-white transition-colors"
                >
                  ＋ 新建分组…
                </button>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-orca-border" />

          <button
            disabled={hostContextMenu.host.id === 'local-shell'}
            onClick={() => {
              const target = hostContextMenu.host;
              setHostContextMenu(null);
              if (target.id === 'local-shell') return;
              if (confirm(`确定删除会话 "${target.name}" 吗？`)) {
                void deleteHost(target.id);
              }
            }}
            className="w-full text-left px-3 py-1.5 text-orca-danger hover:bg-orca-danger hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            删除
          </button>
        </div>
      )}

      {/* File Context Menu */}
      {fileContextMenu && (
        <SftpContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          file={fileContextMenu.file}
          onEdit={handleOpenFileEditor}
          onCopyPath={f => navigator.clipboard.writeText(f.path)}
          onChmod={f => setChmodTarget(f)}
          onRename={handleRenameFile}
          onDelete={handleDeleteFile}
          onClose={() => setFileContextMenu(null)}
        />
      )}

      {/* File Editor Modal */}
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
