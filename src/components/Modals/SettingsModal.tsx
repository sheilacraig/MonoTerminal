import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext';
import { useSettings } from '../../context/SettingsContext';
import { AIProvider } from '../../types';
import {
  Settings,
  X,
  Bot,
  Keyboard,
  Shield,
  Terminal,
  Check,
  Plus,
  Cpu,
  Trash2
} from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const { isSettingsModalOpen, setIsSettingsModalOpen } = useSession();
  const { settings, updateSettings } = useSettings();

  const [activeTab, setActiveTab] = useState<'ai' | 'shortcuts' | 'guardrail' | 'terminal'>('ai');
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
      id: 'custom-' + Date.now().toString(36),
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
                    <label className="text-orca-muted block mb-1">接口 Base URL (OpenAI 兼容)</label>
                    <input
                      type="text"
                      value={selectedProvider.baseUrl}
                      onChange={e => setSelectedProvider({ ...selectedProvider, baseUrl: e.target.value })}
                      placeholder="https://api.deepseek.com 或 http://localhost:11434/v1"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-orca-muted block mb-1">模型名称 (Model Identifier)</label>
                    <input
                      type="text"
                      value={selectedProvider.model}
                      onChange={e => setSelectedProvider({ ...selectedProvider, model: e.target.value })}
                      placeholder="deepseek-chat / deepseek-r1:8b / gpt-4o"
                      className="w-full bg-orca-bg border border-orca-border text-white px-2.5 py-1.5 rounded outline-none focus:border-orca-accent font-mono"
                    />
                  </div>

                  {selectedProvider.type !== 'mock' && (
                    <div>
                      <label className="text-orca-muted block mb-1">API Key (本地 AES-256 加密保存)</label>
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
                      onChange={e => setSelectedProvider({ ...selectedProvider, temperature: parseFloat(e.target.value) })}
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
                      onChange={e => setGuardrail({ ...guardrail, requireConfirmPhrase: e.target.checked })}
                      className="w-4 h-4 accent-orca-accent"
                    />
                  </label>
                </div>
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
                    <label className="text-orca-muted block mb-1">终端字号 ({terminalConfig.fontSize}px)</label>
                    <input
                      type="range"
                      min="12"
                      max="20"
                      value={terminalConfig.fontSize}
                      onChange={e => setTerminalConfig({ ...terminalConfig, fontSize: parseInt(e.target.value, 10) })}
                      className="w-full accent-orca-accent cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-orca-muted block mb-1">字体族 (Font Family)</label>
                    <input
                      type="text"
                      value={terminalConfig.fontFamily}
                      onChange={e => setTerminalConfig({ ...terminalConfig, fontFamily: e.target.value })}
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
