import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AppSettings, AIProvider } from '../types';
import { apiFetch } from '../utils/api';

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  updateAIProvider: (provider: AIProvider) => Promise<void>;
  activeAIProvider: AIProvider | undefined;
  isLoading: boolean;
}

const defaultSettings: AppSettings = {
  ai: {
    activeProvider: 'mock-ai',
    providers: [
      {
        id: 'mock-ai',
        name: '内置运维专家 (离线演示)',
        type: 'mock',
        baseUrl: 'http://localhost/mock',
        model: 'monoterminal-ops-mock',
        temperature: 0.7
      },
      {
        id: 'deepseek-api',
        name: 'DeepSeek 官方 API',
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        temperature: 0.7
      },
      {
        id: 'ollama-local',
        name: 'Ollama 本地直连',
        type: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        model: 'deepseek-r1:8b',
        temperature: 0.7
      }
    ]
  },
  shortcuts: {
    toggleMode: 'Ctrl+\\',
    toggleSidebar: 'Ctrl+B',
    newTab: 'Ctrl+T',
    closeTab: 'Ctrl+W'
  },
  guardrail: {
    enabled: true,
    requireConfirmPhrase: true
  },
  terminal: {
    fontSize: 14,
    fontFamily: '"JetBrains Mono", Consolas, monospace',
    cursorBlink: true,
    scrollback: 5000,
    copyOnSelect: true,
    rightClickPaste: true
  }
};

const SettingsContext = createContext<SettingsContextType | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setSettings(json.data);
          setHasLoaded(true);
        }
      }
    } catch (e) {
      console.warn('Using default settings (server might be starting up)', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    if (!hasLoaded) {
      console.warn('配置尚未自服务端加载完成，阻止写入以防覆盖原有设置');
      return;
    }
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    } catch (err) {
      console.error('Failed to save settings to server', err);
    }
  };

  const updateAIProvider = async (provider: AIProvider) => {
    const providers = [...settings.ai.providers];
    const index = providers.findIndex(p => p.id === provider.id);
    if (index >= 0) {
      providers[index] = provider;
    } else {
      providers.push(provider);
    }
    const updated = {
      ...settings,
      ai: {
        ...settings.ai,
        providers
      }
    };
    await updateSettings(updated);
  };

  const activeAIProvider =
    settings.ai.providers.find(p => p.id === settings.ai.activeProvider) ||
    settings.ai.providers[0];

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        updateAIProvider,
        activeAIProvider,
        isLoading
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within SettingsProvider');
  return context;
};
