import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { AIProvider } from '../../types';
import { generateId } from '../../../shared/id';
import { apiFetch } from '../../utils/api';
import { Settings, X, Bot, Keyboard, Shield, Terminal, Check, Plus, Lock } from 'lucide-react';

interface SecurityStatus {
  masterPasswordEnabled: boolean;
  locked: boolean;
}

const SEC_INPUT_CLS =
  'w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono';

export const SettingsModal: React.FC = () => {
  const { isSettingsModalOpen, setIsSettingsModalOpen } = useSession();
  const { settings, updateSettings } = useSettings();

  const [activeTab, setActiveTab] = useState<
    'ai' | 'shortcuts' | 'guardrail' | 'terminal' | 'security'
  >('ai');
  const [activeProviderId, setActiveProviderId] = useState(settings.ai.activeProvider);
  const [providers, setProviders] = useState<AIProvider[]>(settings.ai.providers);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(
    providers.find(p => p.id === activeProviderId) || providers[0]
  );
  const [plainKey, setPlainKey] = useState('');
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [guardrail, setGuardrail] = useState(settings.guardrail);
  const [terminalConfig, setTerminalConfig] = useState(settings.terminal);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // ---- Data security (master password) state ----
  const [secStatus, setSecStatus] = useState<SecurityStatus | null>(null);
  const [secUnlockPw, setSecUnlockPw] = useState('');
  const [secCurrentPw, setSecCurrentPw] = useState('');
  const [secNewPw, setSecNewPw] = useState('');
  const [secConfirmPw, setSecConfirmPw] = useState('');
  const [secMessage, setSecMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshSecStatus = useCallback(() => {
    apiFetch('/api/security/status')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setSecStatus(j?.data ?? null))
      .catch(() => setSecStatus(null)); // static demo: backend unavailable
  }, []);

  useEffect(() => {
    if (isSettingsModalOpen) {
      refreshSecStatus();
      setSecMessage(null);
    }
  }, [isSettingsModalOpen, refreshSecStatus]);

  const secPost = async (url: string, body: Record<string, unknown>) => {
    try {
      const res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        if (json.data) setSecStatus(json.data as SecurityStatus);
        return { ok: true as const, error: undefined as string | undefined };
      }
      return {
        ok: false as const,
        error: (json?.error as string) || `请求失败 (HTTP ${res.status})`
      };
    } catch {
      return { ok: false as const, error: '无法连接后端服务' };
    }
  };

  const handleUnlock = async () => {
    const r = await secPost('/api/security/unlock', { password: secUnlockPw });
    if (r.ok) setSecUnlockPw('');
    setSecMessage(
      r.ok
        ? { kind: 'ok', text: '已解锁，凭据解密与真实主机连接已恢复' }
        : { kind: 'err', text: r.error! }
    );
  };

  const handleSetMasterPassword = async () => {
    if (secNewPw.length < 6) {
      setSecMessage({ kind: 'err', text: '新主密码至少需要 6 个字符' });
      return;
    }
    if (secNewPw !== secConfirmPw) {
      setSecMessage({ kind: 'err', text: '两次输入的新主密码不一致' });
      return;
    }
    const r = await secPost('/api/security/master-password', {
      currentPassword: secCurrentPw || null,
      newPassword: secNewPw
    });
    if (r.ok) {
      setSecCurrentPw('');
      setSecNewPw('');
      setSecConfirmPw('');
    }
    setSecMessage(
      r.ok
        ? { kind: 'ok', text: '主密码已生效，所有已存凭据已用新密钥重新加密' }
        : { kind: 'err', text: r.error! }
    );
  };

  const handleRemoveMasterPassword = async () => {
    if (!secCurrentPw) {
      setSecMessage({ kind: 'err', text: '移除保护前请输入当前主密码' });
      return;
    }
    const r = await secPost('/api/security/master-password', {
      currentPassword: secCurrentPw,
      newPassword: ''
    });
    if (r.ok) setSecCurrentPw('');
    setSecMessage(
      r.ok
        ? { kind: 'ok', text: '主密码已移除，已回退为设备绑定密钥（安全性较低）' }
        : { kind: 'err', text: r.error! }
    );
  };

  const handleLockNow = async () => {
    const r = await secPost('/api/security/lock', {});
    setSecMessage(r.ok ? { kind: 'ok', text: '存储已锁定' } : { kind: 'err', text: r.error! });
  };

  if (!isSettingsModalOpen) return null;

  const handleProviderSelect = (p: AIProvider) => {
    setSelectedProvider(p);
    setActiveProviderId(p.id);
    setPlainKey('');
  };

  const handleSaveAll = async () => {
    const updatedProviders = providers.map(p => {
      if (p.id === selectedProvider.id) {
        return {
          ...selectedProvider,
          plainApiKey: plainKey || undefined
        };
      }
      return p;
    });

    await updateSettings({
      ai: {
        activeProvider: activeProviderId,
        providers: updatedProviders
      },
      shortcuts,
      guardrail,
      terminal: terminalConfig
    });

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setIsSettingsModalOpen(false);
    }, 800);
  };

  const handleAddCustomProvider = () => {
    const newP: AIProvider = {
      id: generateId('custom-'),
      name: '自定义 OpenAI 兼容接口',
      type: 'custom',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      temperature: 0.7
    };
    setProviders([...providers, newP]);
    setSelectedProvider(newP);
    setActiveProviderId(newP.id);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-orca-surface border border-orca-border rounded-xl shadow-2xl w-full max-w-2xl h-[520px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="h-11 bg-orca-card px-4 border-b border-orca-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-white">
            <Settings size={16} className="text-orca-accent" />
            <span>系统全局设置</span>
          </div>

          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="p-1 hover:bg-orca-border text-orca-muted hover:text-white rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Layout: Left Tabs + Right Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation */}
          <div className="w-40 bg-orca-card/40 border-r border-orca-border p-2 space-y-1 text-xs select-none">
            <button
              onClick={() => setActiveTab('ai')}
              className={`w-full text-left px-3 py-2 rounded flex items-center space-x-2 transition-colors ${
                activeTab === 'ai'
                  ? 'bg-orca-accent text-white font-medium shadow-sm'
                  : 'text-orca-muted hover:bg-orca-card hover:text-white'
              }`}
            >
              <Bot size={14} />
              <span>AI 引擎 (BYOK)</span>
            </button>

            <button
              onClick={() => setActiveTab('guardrail')}
              className={`w-full text-left px-3 py-2 rounded flex items-center space-x-2 transition-colors ${
                activeTab === 'guardrail'
                  ? 'bg-orca-accent text-white font-medium shadow-sm'
                  : 'text-orca-muted hover:bg-orca-card hover:text-white'
              }`}
            >
              <Shield size={14} />
              <span>安全门禁</span>
            </button>

            <button
              onClick={() => setActiveTab('security')}
              className={`w-full text-left px-3 py-2 rounded flex items-center space-x-2 transition-colors ${
                activeTab === 'security'
                  ? 'bg-orca-accent text-white font-medium shadow-sm'
                  : 'text-orca-muted hover:bg-orca-card hover:text-white'
              }`}
            >
              <Lock size={14} />
              <span>数据加密</span>
            </button>

            <button
              onClick={() => setActiveTab('shortcuts')}
              className={`w-full text-left px-3 py-2 rounded flex items-center space-x-2 transition-colors ${
                activeTab === 'shortcuts'
                  ? 'bg-orca-accent text-white font-medium shadow-sm'
                  : 'text-orca-muted hover:bg-orca-card hover:text-white'
              }`}
            >
              <Keyboard size={14} />
              <span>按键与快捷键</span>
            </button>

            <button
              onClick={() => setActiveTab('terminal')}
              className={`w-full text-left px-3 py-2 rounded flex items-center space-x-2 transition-colors ${
                activeTab === 'terminal'
                  ? 'bg-orca-accent text-white font-medium shadow-sm'
                  : 'text-orca-muted hover:bg-orca-card hover:text-white'
              }`}
            >
              <Terminal size={14} />
              <span>终端外观</span>
            </button>
          </div>

          {/* Right Content Panel */}
          <div className="flex-1 p-5 overflow-y-auto text-xs">
            {activeTab === 'ai' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-white">大模型接入与本地 BYOK 规范</h4>
                  <button
                    onClick={handleAddCustomProvider}
                    className="flex items-center space-x-1 text-[11px] text-orca-accent hover:underline"
                  >
                    <Plus size={12} />
                    <span>添加端点</span>
                  </button>
                </div>

                {/* Provider Selector Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {providers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderSelect(p)}
                      className={`px-2.5 py-1 rounded text-xs border transition-all ${
                        selectedProvider.id === p.id
                          ? 'border-orca-accent bg-orca-accent/20 text-white font-medium'
                          : 'border-orca-border bg-orca-card text-orca-muted hover:text-white'
                      }`}
                    >
                      {p.name}
                      {activeProviderId === p.id && ' ✓'}
                    </button>
                  ))}
                </div>

                {/* Active Provider Config Form */}
                <div className="space-y-3 bg-orca-card/40 p-3.5 rounded-lg border border-orca-border">
                  <div>
                    <label className="text-orca-muted block mb-1">
                      接口 Base URL (OpenAI 兼容)
                    </label>
                    <input
                      type="text"
                      value={selectedProvider.baseUrl}
                      onChange={e =>
                        setSelectedProvider({ ...selectedProvider, baseUrl: e.target.value })
                      }
                      placeholder="https://api.deepseek.com 或 http://localhost:11434/v1"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-orca-muted block mb-1">
                      模型名称 (Model Identifier)
                    </label>
                    <input
                      type="text"
                      value={selectedProvider.model}
                      onChange={e =>
                        setSelectedProvider({ ...selectedProvider, model: e.target.value })
                      }
                      placeholder="deepseek-chat / deepseek-r1:8b / gpt-4o"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>

                  {selectedProvider.type !== 'mock' && (
                    <div>
                      <label className="text-orca-muted block mb-1">
                        API Key (本地 AES-256 加密保存)
                      </label>
                      <input
                        type="password"
                        value={plainKey}
                        onChange={e => setPlainKey(e.target.value)}
                        placeholder="sk-xxxxxxxxxxxxxxxx"
                        className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-orca-muted mb-1">
                      <span>Temperature: {selectedProvider.temperature}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={selectedProvider.temperature}
                      onChange={e =>
                        setSelectedProvider({
                          ...selectedProvider,
                          temperature: parseFloat(e.target.value)
                        })
                      }
                      className="w-full accent-orca-accent cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'guardrail' && (
              <div className="space-y-4">
                <h4 className="font-semibold text-white">安全门禁与危险命令拦截 (Guardrail)</h4>
                <div className="space-y-3">
                  <label className="flex items-center justify-between p-3 rounded-lg bg-orca-card/40 border border-orca-border cursor-pointer">
                    <div>
                      <div className="font-medium text-white">启用高危命令黑名单拦截</div>
                      <div className="text-[11px] text-orca-muted">
                        实时匹配 rm -rf /、mkfs、dd of=/dev/sd*、chmod -R 777 / 等毁灭性命令
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={guardrail.enabled}
                      onChange={e => setGuardrail({ ...guardrail, enabled: e.target.checked })}
                      className="w-4 h-4 accent-orca-accent"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-lg bg-orca-card/40 border border-orca-border cursor-pointer">
                    <div>
                      <div className="font-medium text-white">强制二次确认门禁</div>
                      <div className="text-[11px] text-orca-muted">
                        拦截后必须手动输入 "confirm" 或敲击 Alt + Y 方可执行
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={guardrail.requireConfirmPhrase}
                      onChange={e =>
                        setGuardrail({ ...guardrail, requireConfirmPhrase: e.target.checked })
                      }
                      className="w-4 h-4 accent-orca-accent"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'security' && (
              <div className="space-y-4">
                <h4 className="font-semibold text-white">数据加密与主密码</h4>

                {secStatus === null && (
                  <div className="p-3 rounded-lg bg-orca-card/40 border border-orca-border text-orca-muted leading-relaxed">
                    当前环境未连接后端服务（静态演示模式），主密码功能不可用。
                  </div>
                )}

                {secStatus?.locked && (
                  <div className="space-y-2.5 p-3.5 rounded-lg bg-orca-danger/10 border border-orca-danger/50">
                    <div className="font-medium text-orca-danger flex items-center space-x-1.5">
                      <Lock size={13} />
                      <span>存储已锁定 — 真实主机连接与 API Key 解密已暂停</span>
                    </div>
                    <input
                      type="password"
                      value={secUnlockPw}
                      onChange={e => setSecUnlockPw(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                      placeholder="输入主密码解锁"
                      className={SEC_INPUT_CLS}
                      autoFocus
                    />
                    <button
                      onClick={handleUnlock}
                      className="px-3 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded text-xs font-medium"
                    >
                      解锁
                    </button>
                  </div>
                )}

                {secStatus && !secStatus.locked && !secStatus.masterPasswordEnabled && (
                  <div className="p-3 rounded-lg bg-orca-warning/10 border border-orca-warning/50 text-[11px] text-orca-warning leading-relaxed">
                    ⚠️ 当前使用「设备绑定密钥」加密（未设置主密码）。密钥由本机公开信息派生，
                    能读取数据目录的本机进程理论上可解密已存凭据。强烈建议启用主密码保护。
                  </div>
                )}

                {secStatus && !secStatus.locked && (
                  <div className="space-y-3 bg-orca-card/40 p-3.5 rounded-lg border border-orca-border">
                    {secStatus.masterPasswordEnabled && (
                      <div>
                        <label className="text-orca-muted block mb-1">
                          当前主密码（修改 / 移除时需要）
                        </label>
                        <input
                          type="password"
                          value={secCurrentPw}
                          onChange={e => setSecCurrentPw(e.target.value)}
                          placeholder="••••••••"
                          className={SEC_INPUT_CLS}
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-orca-muted block mb-1">新主密码（至少 6 位）</label>
                      <input
                        type="password"
                        value={secNewPw}
                        onChange={e => setSecNewPw(e.target.value)}
                        placeholder="••••••••"
                        className={SEC_INPUT_CLS}
                      />
                    </div>

                    <div>
                      <label className="text-orca-muted block mb-1">确认新主密码</label>
                      <input
                        type="password"
                        value={secConfirmPw}
                        onChange={e => setSecConfirmPw(e.target.value)}
                        placeholder="••••••••"
                        className={SEC_INPUT_CLS}
                      />
                    </div>

                    <div className="flex items-center space-x-2 pt-1 flex-wrap gap-y-2">
                      <button
                        onClick={handleSetMasterPassword}
                        className="px-3 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded text-xs font-medium"
                      >
                        {secStatus.masterPasswordEnabled ? '修改主密码' : '启用主密码保护'}
                      </button>
                      {secStatus.masterPasswordEnabled && (
                        <>
                          <button
                            onClick={handleRemoveMasterPassword}
                            className="px-3 py-1.5 bg-orca-danger/80 hover:bg-orca-danger text-white rounded text-xs"
                          >
                            移除保护
                          </button>
                          <button
                            onClick={handleLockNow}
                            className="px-3 py-1.5 bg-orca-surface hover:bg-orca-hover text-orca-muted rounded text-xs border border-orca-border"
                          >
                            立即锁定
                          </button>
                        </>
                      )}
                    </div>

                    <p className="text-[10px] text-orca-muted leading-relaxed">
                      启用后：加密密钥经 PBKDF2-SHA512（200,000 轮）从「主密码 + 设备指纹 +
                      随机盐」派生， 所有已保存的密码 / 私钥口令 / API Key
                      会立即用新密钥重新加密；服务重启后需输入主密码解锁。 请牢记主密码 ——
                      丢失后将无法恢复已加密的凭据。
                    </p>
                  </div>
                )}

                {secMessage && (
                  <div
                    className={`p-2.5 rounded text-[11px] border leading-relaxed ${
                      secMessage.kind === 'ok'
                        ? 'bg-orca-success/10 border-orca-success/40 text-orca-success'
                        : 'bg-orca-danger/10 border-orca-danger/40 text-orca-danger'
                    }`}
                  >
                    {secMessage.text}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                <h4 className="font-semibold text-white">全局快捷键配置</h4>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-orca-muted">终端 ↔ Agent 穿梭流切换</span>
                    <input
                      type="text"
                      value={shortcuts.toggleMode}
                      onChange={e => setShortcuts({ ...shortcuts, toggleMode: e.target.value })}
                      className="w-32 bg-orca-bg border border-orca-border text-center text-white font-mono py-1 rounded"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-orca-muted">SFTP 侧边栏折叠/展开</span>
                    <input
                      type="text"
                      value={shortcuts.toggleSidebar}
                      onChange={e => setShortcuts({ ...shortcuts, toggleSidebar: e.target.value })}
                      className="w-32 bg-orca-bg border border-orca-border text-center text-white font-mono py-1 rounded"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-orca-muted">新建会话 Tab</span>
                    <input
                      type="text"
                      value={shortcuts.newTab}
                      onChange={e => setShortcuts({ ...shortcuts, newTab: e.target.value })}
                      className="w-32 bg-orca-bg border border-orca-border text-center text-white font-mono py-1 rounded"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-orca-muted">关闭当前会话</span>
                    <input
                      type="text"
                      value={shortcuts.closeTab}
                      onChange={e => setShortcuts({ ...shortcuts, closeTab: e.target.value })}
                      className="w-32 bg-orca-bg border border-orca-border text-center text-white font-mono py-1 rounded"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'terminal' && (
              <div className="space-y-4">
                <h4 className="font-semibold text-white">终端字体与渲染</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-orca-muted block mb-1">
                      终端字号 ({terminalConfig.fontSize}px)
                    </label>
                    <input
                      type="range"
                      min="12"
                      max="20"
                      value={terminalConfig.fontSize}
                      onChange={e =>
                        setTerminalConfig({
                          ...terminalConfig,
                          fontSize: parseInt(e.target.value, 10)
                        })
                      }
                      className="w-full accent-orca-accent cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-orca-muted block mb-1">字体族 (Font Family)</label>
                    <input
                      type="text"
                      value={terminalConfig.fontFamily}
                      onChange={e =>
                        setTerminalConfig({ ...terminalConfig, fontFamily: e.target.value })
                      }
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-12 bg-orca-card px-4 border-t border-orca-border flex items-center justify-end space-x-2">
          <button
            onClick={() => setIsSettingsModalOpen(false)}
            className="px-3 py-1.5 bg-orca-surface hover:bg-orca-hover text-orca-muted rounded text-xs"
          >
            取消
          </button>
          <button
            onClick={handleSaveAll}
            className="px-4 py-1.5 bg-orca-accent hover:bg-blue-600 text-white rounded text-xs font-medium shadow flex items-center space-x-1"
          >
            {savedSuccess ? <Check size={14} /> : null}
            <span>{savedSuccess ? '已保存！' : '保存设置'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
