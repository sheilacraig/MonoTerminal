import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface HostAsset {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent' | 'mock';
  passwordEncrypted?: string;
  privateKeyPath?: string;
  passphraseEncrypted?: string;
  initialDir?: string;
  createdAt: number;
  lastConnectedAt?: number;
}

export interface AppSettings {
  ai: {
    activeProvider: string;
    providers: {
      id: string;
      name: string;
      type: 'deepseek' | 'ollama' | 'openai' | 'qwen' | 'moonshot' | 'custom' | 'mock';
      baseUrl: string;
      apiKeyEncrypted?: string;
      model: string;
      temperature: number;
    }[];
  };
  shortcuts: {
    toggleMode: string; // e.g. 'Ctrl+\'
    toggleSidebar: string; // e.g. 'Ctrl+B'
    newTab: string; // e.g. 'Ctrl+T'
    closeTab: string; // e.g. 'Ctrl+W'
  };
  guardrail: {
    enabled: boolean;
    requireConfirmPhrase: boolean; // type "confirm" or Alt+Y
  };
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorBlink: boolean;
    scrollback: number;
  };
}

const DEFAULT_DATA_DIR = process.env.MONOTERMINAL_DATA_DIR || process.env.MONOTERM_DATA_DIR || process.env.ORCALOCAL_DATA_DIR || path.join(
  process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Preferences') : path.join(os.homedir(), '.local', 'share')),
  'monoterminal'
);

export class LocalStorageManager {
  private dataDir: string;
  private masterKey: Buffer;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || DEFAULT_DATA_DIR;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.masterKey = this.initMasterKey();
    this.initDefaultConfigs();
  }

  private initMasterKey(): Buffer {
    const saltFile = path.join(this.dataDir, '.master_salt');
    let salt: Buffer;
    if (fs.existsSync(saltFile)) {
      salt = fs.readFileSync(saltFile);
    } else {
      salt = crypto.randomBytes(32);
      fs.writeFileSync(saltFile, salt, { mode: 0o600 });
    }

    const machineId = `${os.hostname()}:${os.userInfo().username}:${os.platform()}:${os.arch()}`;
    return crypto.pbkdf2Sync(machineId, salt, 100000, 32, 'sha256');
  }

  public encrypt(plainText: string): string {
    if (!plainText) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  public decrypt(cipherPackage: string): string {
    if (!cipherPackage) return '';
    try {
      const parts = cipherPackage.split(':');
      if (parts.length !== 3) return '';
      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return '';
    }
  }

  private initDefaultConfigs() {
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    if (!fs.existsSync(hostsPath)) {
      const defaultHosts: HostAsset[] = [
        {
          id: 'mock-local-demo',
          name: 'Demo-Linux (内置仿真沙盒)',
          group: '开发/演示',
          host: '127.0.0.1',
          port: 22,
          username: 'root',
          authType: 'mock',
          initialDir: '/etc/nginx',
          createdAt: Date.now(),
        }
      ];
      fs.writeFileSync(hostsPath, JSON.stringify(defaultHosts, null, 2), 'utf8');
    }

    const settingsPath = path.join(this.dataDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
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
            },
            {
              id: 'openai-api',
              name: 'OpenAI 兼容端点',
              type: 'custom',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o',
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
          scrollback: 5000
        }
      };
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf8');
    }
  }

  public getHosts(): HostAsset[] {
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    try {
      if (fs.existsSync(hostsPath)) {
        return JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to read hosts.json', e);
    }
    return [];
  }

  public saveHosts(hosts: HostAsset[]): void {
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    fs.writeFileSync(hostsPath, JSON.stringify(hosts, null, 2), 'utf8');
  }

  public getSettings(): AppSettings {
    const settingsPath = path.join(this.dataDir, 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to read settings.json', e);
    }
    return this.getDefaultSettings();
  }

  public saveSettings(settings: AppSettings): void {
    const settingsPath = path.join(this.dataDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  public getDefaultSettings(): AppSettings {
    return {
      ai: {
        activeProvider: 'mock-ai',
        providers: []
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
        scrollback: 5000
      }
    };
  }
}

export const localStorageManager = new LocalStorageManager();
