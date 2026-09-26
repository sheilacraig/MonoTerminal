import React, { useState, useEffect } from 'react';
import { useSession } from '../../context/SessionContext';
import { HostAsset } from '../../types';
import { normalizeHostGroup } from '../../utils/quickConnect';
import { Server, Trash2, X, Play, ShieldCheck } from 'lucide-react';

const DEFAULT_GROUPS = ['生产环境', '测试环境', '本机终端'];

export const HostManagerModal: React.FC = () => {
  const {
    isHostModalOpen,
    setIsHostModalOpen,
    editingHost,
    hosts,
    createSession,
    saveHost,
    deleteHost
  } = useSession();

  const [form, setForm] = useState<Partial<HostAsset>>({
    name: '',
    group: '生产环境',
    host: '',
    port: 22,
    username: 'root',
    authType: 'password',
    plainPassword: '',
    initialDir: '/root'
  });

  useEffect(() => {
    if (!isHostModalOpen) return;
    if (editingHost) {
      setForm({
        ...editingHost,
        group: normalizeHostGroup({
          group: editingHost.group || '生产环境',
          authType: editingHost.authType || 'password'
        }),
        plainPassword: ''
      });
    } else {
      setForm({
        name: '',
        group: '生产环境',
        host: '',
        port: 22,
        username: 'root',
        authType: 'password',
        plainPassword: '',
        initialDir: '/root'
      });
    }
  }, [isHostModalOpen, editingHost]);

  if (!isHostModalOpen) return null;

  const existingGroups = Array.from(
    new Set([
      ...DEFAULT_GROUPS,
      ...hosts.map(h => normalizeHostGroup(h)).filter(Boolean)
    ])
  );

  const persistHost = async (): Promise<HostAsset | null> => {
    // Review-3 R4: build the request from explicitly picked fields instead of
    // spreading `...form` — the form state carries GET-derived flags
    // (`hasPassword` / `hasPassphrase`) that must never be persisted back.
    const payload: Partial<HostAsset> = {
      id: form.id,
      // Preserve the original creation time on edit; server stamps new records.
      createdAt: form.createdAt,
      name: (form.name || '').trim(),
      group: form.group?.trim() || (form.authType === 'local' ? '本机终端' : '生产环境'),
      host: (form.host || '').trim(),
      port: form.port || 22,
      username: (form.username || '').trim(),
      authType: form.authType,
      privateKeyPath: form.privateKeyPath || undefined,
      initialDir: form.initialDir || (form.authType === 'local' ? '~' : ''),
      plainPassword: form.plainPassword || undefined
    };

    if (form.authType === 'local') {
      if (!payload.name) {
        alert('请填写本机终端的会话名称');
        return null;
      }
      return await saveHost({
        ...payload,
        host: 'localhost',
        port: 0,
        username: 'local',
        initialDir: form.initialDir || '~'
      });
    }

    if (!payload.name || !payload.host || !payload.username) {
      alert('请填写完整的会话名称、主机 IP 与登录用户名');
      return null;
    }

    return await saveHost(payload);
  };

  const handleSubmitSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const saved = await persistHost();
    if (saved) {
      setIsHostModalOpen(false);
    }
  };

  const handleSaveAndConnect = async () => {
    const saved = await persistHost();
    if (saved) {
      createSession(saved);
      setIsHostModalOpen(false);
    }
  };

  const handleDeleteCurrent = async () => {
    if (!form.id || form.id === 'local-shell') return;
    if (!confirm(`确定删除会话 "${form.name}" 吗？`)) return;
    await deleteHost(form.id);
    setIsHostModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-12 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Server size={17} className="text-orca-accent" />
            <div>
              <h3 className="text-xs font-bold text-white">
                {form.id ? '编辑会话属性' : '新建会话'}
              </h3>
              <p className="text-[10px] text-orca-muted flex items-center space-x-1">
                <ShieldCheck size={11} className="text-orca-success inline" />
                <span>凭证通过本地 AES-256-GCM 硬件特征密钥加密存储</span>
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

        {/* Form Body */}
        <form onSubmit={handleSubmitSave} className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-orca-muted block mb-1">会话名称 / 别名</label>
              <input
                type="text"
                value={form.name || ''}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="prod-web-01"
                className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="text-orca-muted block mb-1">所属分组</label>
              <input
                type="text"
                list="host-group-options"
                value={form.group || ''}
                onChange={e => setForm({ ...form, group: e.target.value })}
                placeholder="生产环境 / 测试环境"
                className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
              />
              <datalist id="host-group-options">
                {existingGroups.map(g => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Quick Group Selector Pills */}
          <div className="flex items-center flex-wrap gap-1">
            <span className="text-[10px] text-orca-muted mr-1">快捷分组:</span>
            {existingGroups.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setForm({ ...form, group: g })}
                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                  form.group === g
                    ? 'bg-orca-accent/20 border-orca-accent text-orca-accent font-medium'
                    : 'bg-orca-bg border-orca-border text-orca-muted hover:text-white'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          <div>
            <label className="text-orca-muted block mb-1">连接与认证类型</label>
            <select
              value={form.authType || 'password'}
              onChange={e => {
                const nextType = e.target.value as HostAsset['authType'];
                const nextGroup =
                  nextType === 'local'
                    ? '本机终端'
                    : form.group === '本机终端'
                      ? '生产环境'
                      : form.group;
                setForm({
                  ...form,
                  authType: nextType,
                  group: nextGroup
                });
              }}
              className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent"
            >
              <option value="password">SSH 密码认证 (Password)</option>
              <option value="privateKey">SSH 私钥认证 (Private Key)</option>
              <option value="local">本机终端 (Local Shell)</option>
            </select>
          </div>

          {form.authType !== 'local' && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="text-orca-muted block mb-1">主机 IP / 域名</label>
                  <input
                    type="text"
                    value={form.host || ''}
                    onChange={e => setForm({ ...form, host: e.target.value })}
                    placeholder="10.0.1.24"
                    className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    required={form.authType !== 'mock'}
                  />
                </div>
                <div>
                  <label className="text-orca-muted block mb-1">SSH 端口</label>
                  <input
                    type="number"
                    value={form.port || 22}
                    onChange={e =>
                      setForm({ ...form, port: parseInt(e.target.value, 10) || 22 })
                    }
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
                  required={form.authType !== 'mock'}
                />
              </div>
            </>
          )}

          {form.authType === 'password' && (
            <div>
              <label className="text-orca-muted block mb-1">
                登录密码 (本地 AES-256 加密保存)
              </label>
              <input
                type="password"
                value={form.plainPassword || ''}
                onChange={e => setForm({ ...form, plainPassword: e.target.value })}
                placeholder={
                  form.hasPassword ? '已保存加密密码（若不修改请留空）' : '输入 SSH 登录密码'
                }
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
            <label className="text-orca-muted block mb-1">
              {form.authType === 'local'
                ? '启动目录（默认 ~ 用户主目录）'
                : '连接后默认初始目录'}
            </label>
            <input
              type="text"
              value={form.initialDir || ''}
              onChange={e => setForm({ ...form, initialDir: e.target.value })}
              placeholder={
                form.authType === 'local'
                  ? '~ 或 C:/Users/username'
                  : '/root 或 /etc/nginx'
              }
              className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
            />
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-orca-border">
            <div>
              {form.id && form.id !== 'local-shell' && (
                <button
                  type="button"
                  onClick={handleDeleteCurrent}
                  className="flex items-center space-x-1 px-2.5 py-1.5 text-orca-danger hover:bg-orca-danger/10 rounded transition-colors"
                  title="删除该会话资产"
                >
                  <Trash2 size={13} />
                  <span>删除</span>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setIsHostModalOpen(false)}
                className="px-3 py-1.5 bg-orca-card hover:bg-orca-hover text-orca-muted hover:text-white rounded transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-orca-card hover:bg-orca-hover border border-orca-border text-white rounded font-medium transition-colors"
              >
                保存属性
              </button>
              <button
                type="button"
                onClick={handleSaveAndConnect}
                className="flex items-center space-x-1 px-3.5 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded font-medium shadow transition-colors"
              >
                <Play size={11} className="fill-current" />
                <span>保存并连接</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
