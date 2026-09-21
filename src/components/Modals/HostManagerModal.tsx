import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { HostAsset } from '../../types';
import { Server, Plus, Trash2, Edit, X, Play, ShieldCheck, Search } from 'lucide-react';

export const HostManagerModal: React.FC = () => {
  const { isHostModalOpen, setIsHostModalOpen, hosts, createSession, saveHost, deleteHost } =
    useSession();

  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('全部');
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<Partial<HostAsset>>({
    name: '',
    group: '默认',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    plainPassword: '',
    initialDir: '/root'
  });

  if (!isHostModalOpen) return null;

  // Extract unique groups
  const groups = ['全部', ...Array.from(new Set(hosts.map(h => h.group).filter(Boolean)))];

  const filteredHosts = hosts.filter(h => {
    const matchSearch =
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.host.toLowerCase().includes(search.toLowerCase()) ||
      h.username.toLowerCase().includes(search.toLowerCase());
    const matchGroup = selectedGroup === '全部' || h.group === selectedGroup;
    return matchSearch && matchGroup;
  });

  const handleOpenAdd = () => {
    setForm({
      name: '',
      group: '默认',
      host: '',
      port: 22,
      username: 'root',
      authType: 'password',
      plainPassword: '',
      initialDir: '/root'
    });
    setIsEditing(true);
  };

  const handleOpenEdit = (host: HostAsset) => {
    setForm({ ...host, plainPassword: '' });
    setIsEditing(true);
  };

  const handleSubmitSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.host || !form.username) {
      alert('请填写完整的名称、主机 IP 与登录用户名');
      return;
    }
    await saveHost(form);
    setIsEditing(false);
  };

  const handleConnect = (host: HostAsset) => {
    createSession(host);
    setIsHostModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-12 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Server size={18} className="text-orca-accent" />
            <div>
              <h3 className="text-xs font-bold text-white">主机资产管理 (0 登录 / 本地优先)</h3>
              <p className="text-[10px] text-orca-muted flex items-center space-x-1">
                <ShieldCheck size={11} className="text-orca-success inline" />
                <span>所有密码凭证均通过本地机器特征派生密钥进行 AES-256-GCM 硬件级本地加密</span>
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsHostModalOpen(false)}
            className="p-1 hover:bg-orca-border text-orca-muted hover:text-white rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-3 bg-orca-bg/50 border-b border-orca-border flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 flex-1">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-2.5 text-orca-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索主机别名、IP 或用户..."
                className="w-full bg-orca-surface border border-orca-border text-white text-xs pl-8 pr-3 py-1.5 rounded-lg outline-none focus:border-orca-accent"
              />
            </div>

            <div className="flex items-center space-x-1 overflow-x-auto">
              {groups.map(g => (
                <button
                  key={g}
                  onClick={() => setSelectedGroup(g)}
                  className={`px-2 py-1 rounded text-[11px] transition-colors ${
                    selectedGroup === g
                      ? 'bg-orca-accent text-white font-medium'
                      : 'bg-orca-surface hover:bg-orca-card text-orca-muted hover:text-orca-text'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleOpenAdd}
            className="flex items-center space-x-1 px-3 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded-lg text-xs font-medium shadow transition-colors shrink-0"
          >
            <Plus size={14} />
            <span>添加主机</span>
          </button>
        </div>

        {/* Host Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredHosts.map(host => (
            <div
              key={host.id}
              onDoubleClick={() => handleConnect(host)}
              className="bg-orca-card/60 hover:bg-orca-card border border-orca-border hover:border-orca-accent/50 rounded-xl p-3 flex flex-col justify-between transition-all group shadow-sm hover:shadow"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center space-x-1.5 font-bold text-white text-xs truncate">
                    <span>{host.name}</span>
                    {host.authType === 'mock' && (
                      <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1 py-0.2 rounded">
                        仿真沙盒
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] bg-orca-surface text-orca-muted border border-orca-border px-1.5 py-0.5 rounded">
                    {host.group || '默认'}
                  </span>
                </div>

                <div className="font-mono text-xs text-orca-muted space-y-0.5">
                  <div className="text-orca-text">
                    {host.username}@{host.host}:{host.port}
                  </div>
                  <div className="text-[11px] text-orca-muted truncate">
                    初始路径: {host.initialDir || '/root'}
                  </div>
                </div>
              </div>

              {/* Card Actions */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-orca-border/50 text-xs">
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleOpenEdit(host)}
                    className="p-1 hover:text-orca-accent text-orca-muted rounded"
                    title="编辑主机配置"
                  >
                    <Edit size={13} />
                  </button>
                  {host.id !== 'mock-local-demo' && (
                    <button
                      onClick={() => {
                        if (confirm(`确定删除主机 ${host.name} 吗？`)) {
                          deleteHost(host.id);
                        }
                      }}
                      className="p-1 hover:text-orca-danger text-orca-muted rounded"
                      title="删除主机"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleConnect(host)}
                  className="flex items-center space-x-1 px-3 py-1 bg-orca-accent hover:bg-blue-600 text-white rounded text-xs font-medium shadow-sm transition-colors"
                >
                  <Play size={11} className="fill-current" />
                  <span>连接</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add / Edit Form Modal */}
        {isEditing && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-orca-surface border border-orca-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="h-10 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between text-xs font-bold text-white">
                <span>{form.id ? '编辑主机配置' : '新建主机资产'}</span>
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-orca-muted hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>

              <form onSubmit={handleSubmitSave} className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-orca-muted block mb-1">别名</label>
                    <input
                      type="text"
                      value={form.name || ''}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      placeholder="阿里云-生产01"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-orca-muted block mb-1">分组/标签</label>
                    <input
                      type="text"
                      value={form.group || ''}
                      onChange={e => setForm({ ...form, group: e.target.value })}
                      placeholder="生产 / 测试 / 数据库"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-orca-muted block mb-1">主机 IP / 域名</label>
                    <input
                      type="text"
                      value={form.host || ''}
                      onChange={e => setForm({ ...form, host: e.target.value })}
                      placeholder="192.168.1.10"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-orca-muted block mb-1">端口</label>
                    <input
                      type="number"
                      value={form.port || 22}
                      onChange={e => setForm({ ...form, port: parseInt(e.target.value, 10) || 22 })}
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-orca-muted block mb-1">登录用户名</label>
                  <input
                    type="text"
                    value={form.username || ''}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                    placeholder="root"
                    className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="text-orca-muted block mb-1">认证方式</label>
                  <select
                    value={form.authType || 'password'}
                    onChange={e =>
                      setForm({ ...form, authType: e.target.value as HostAsset['authType'] })
                    }
                    className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
                  >
                    <option value="password">密码认证 (Password)</option>
                    <option value="privateKey">私钥认证 (Private Key)</option>
                    <option value="mock">仿真沙盒 (Mock Sandbox)</option>
                  </select>
                </div>

                {form.authType === 'password' && (
                  <div>
                    <label className="text-orca-muted block mb-1">
                      登录密码 (本地 AES 加密保存)
                    </label>
                    <input
                      type="password"
                      value={form.plainPassword || ''}
                      onChange={e => setForm({ ...form, plainPassword: e.target.value })}
                      placeholder="若不修改则留空"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>
                )}

                {form.authType === 'privateKey' && (
                  <div>
                    <label className="text-orca-muted block mb-1">私钥文件绝对路径</label>
                    <input
                      type="text"
                      value={form.privateKeyPath || ''}
                      onChange={e => setForm({ ...form, privateKeyPath: e.target.value })}
                      placeholder="C:\Users\username\.ssh\id_rsa"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="text-orca-muted block mb-1">连接后默认初始目录</label>
                  <input
                    type="text"
                    value={form.initialDir || ''}
                    onChange={e => setForm({ ...form, initialDir: e.target.value })}
                    placeholder="/etc/nginx 或 /var/log"
                    className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 bg-orca-card hover:bg-orca-hover text-orca-muted rounded"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded font-medium shadow"
                  >
                    保存配置
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
