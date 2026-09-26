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
  authType: 'password' | 'privateKey' | 'agent' | 'mock' | 'local';
  passwordEncrypted?: string;
  hasPassword?: boolean;
  privateKeyPath?: string;
  passphraseEncrypted?: string;
  hasPassphrase?: boolean;
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
    /** Selecting text with the mouse copies it to the clipboard immediately. */
    copyOnSelect?: boolean;
    /** Right-click pastes clipboard content (terminal) / at the caret (AI input). */
    rightClickPaste?: boolean;
  };
}

export interface SecurityStatus {
  /** A user master password protects the key derivation. */
  masterPasswordEnabled: boolean;
  /** Store is waiting for unlock (only possible when masterPasswordEnabled). */
  locked: boolean;
}

/** Thrown when an operation needs the key but the store is locked. */
export class StorageLockedError extends Error {
  constructor() {
    super('本地加密存储已被主密码锁定，请先在 设置 → 安全 中解锁');
    this.name = 'StorageLockedError';
  }
}

const DEFAULT_DATA_DIR =
  process.env.MONOTERMINAL_DATA_DIR ||
  process.env.MONOTERM_DATA_DIR ||
  process.env.ORCALOCAL_DATA_DIR ||
  path.join(
    process.env.APPDATA ||
      (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Preferences')
        : path.join(os.homedir(), '.local', 'share')),
    'monoterminal'
  );

// Written to .master_verify encrypted with the password-derived key.
// A successful round-trip proves the entered master password is correct.
const VERIFY_MAGIC = 'MONOTERMINAL_MASTER_KEY_VERIFY_V1';
const LEGACY_ITERATIONS = 100_000;
const STRONG_ITERATIONS = 200_000;

export class LocalStorageManager {
  private dataDir: string;
  /** null while the store is locked (master password set but not entered). */
  private masterKey: Buffer | null;
  private masterPasswordEnabled: boolean;
  private hostsCorrupted: boolean = false;
  private settingsCorrupted: boolean = false;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || DEFAULT_DATA_DIR;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.masterPasswordEnabled = fs.existsSync(this.verifyFilePath());
    if (this.masterPasswordEnabled) {
      // Password-protected: stay locked until unlock() verifies the password
      this.masterKey = null;
    } else {
      // Legacy mode: device-bound key, identical derivation to before so that
      // data encrypted by earlier versions stays readable
      this.masterKey = this.deriveLegacyKey();
    }

    this.initDefaultConfigs();
  }

  // -------------------------------------------------------------------------
  // Key derivation
  // -------------------------------------------------------------------------

  private saltFilePath(): string {
    return path.join(this.dataDir, '.master_salt');
  }

  private verifyFilePath(): string {
    return path.join(this.dataDir, '.master_verify');
  }

  private readSalt(): Buffer {
    const saltFile = this.saltFilePath();
    if (fs.existsSync(saltFile)) {
      // Best-effort hardening: keep the salt owner-only (no-op on Windows)
      try {
        fs.chmodSync(saltFile, 0o600);
      } catch {
        // Platform without POSIX permissions — ignore
      }
      return fs.readFileSync(saltFile);
    }
    const salt = crypto.randomBytes(32);
    fs.writeFileSync(saltFile, salt, { mode: 0o600 });
    return salt;
  }

  private machineId(): string {
    return `${os.hostname()}:${os.userInfo().username}:${os.platform()}:${os.arch()}`;
  }

  /**
   * Legacy derivation. Kept byte-for-byte compatible with pre-master-password
   * versions; the machineId alone is guessable by any local process, which is
   * exactly why setMasterPassword() exists.
   */
  private deriveLegacyKey(): Buffer {
    return crypto.pbkdf2Sync(this.machineId(), this.readSalt(), LEGACY_ITERATIONS, 32, 'sha256');
  }

  /** Strong derivation mixing in the user-supplied master password. */
  private derivePasswordKey(password: string): Buffer {
    return crypto.pbkdf2Sync(
      `mp:${password}:${this.machineId()}`,
      this.readSalt(),
      STRONG_ITERATIONS,
      32,
      'sha512'
    );
  }

  // -------------------------------------------------------------------------
  // Lock state
  // -------------------------------------------------------------------------

  public getDataDir(): string {
    return this.dataDir;
  }

  public getSecurityStatus(): SecurityStatus {
    return {
      masterPasswordEnabled: this.masterPasswordEnabled,
      locked: this.masterKey === null
    };
  }

  public isLocked(): boolean {
    return this.masterKey === null;
  }

  /**
   * Try to unlock with the master password. Returns true when unlocked
   * (or when no master password is set — nothing to unlock).
   */
  public unlock(password: string): boolean {
    if (!this.masterPasswordEnabled) return true;
    const candidate = this.derivePasswordKey(password);
    const decrypted = this.decryptWith(candidate, this.readVerifyToken());
    if (decrypted === VERIFY_MAGIC) {
      this.masterKey = candidate;
      return true;
    }
    return false;
  }

  /** Re-lock the store (drops the key from memory). No-op in legacy mode. */
  public lock(): void {
    if (this.masterPasswordEnabled) {
      this.masterKey = null;
    }
  }

  private readVerifyToken(): string {
    try {
      return fs.readFileSync(this.verifyFilePath(), 'utf8');
    } catch {
      return '';
    }
  }

  /**
   * Set, change or remove the master password. Every stored secret is
   * decrypted with the current key and re-encrypted with the new one.
   * Pass newPassword = '' to remove protection (falls back to legacy key).
   *
   * SECURITY: When master-password protection is already enabled, the caller
   * MUST prove knowledge of the current password by passing `currentPassword`,
   * even if the store is already unlocked in memory. Otherwise any local
   * process able to reach `/api/security/master-password` (malicious browser
   * extension, CSRF, other user on the same machine, ...) could rotate or
   * wipe the master password during an active session without knowing it.
   */
  public setMasterPassword(currentPassword: string | null, newPassword: string): void {
    if (this.masterPasswordEnabled) {
      // Protection is on — verifying the current password is mandatory,
      // regardless of the in-memory unlock state.
      if (!currentPassword) {
        throw new Error('修改或移除主密码需要提供当前主密码');
      }
      const candidate = this.derivePasswordKey(currentPassword);
      if (this.decryptWith(candidate, this.readVerifyToken()) !== VERIFY_MAGIC) {
        throw new Error('当前主密码不正确');
      }
      // If we were locked, the verified candidate becomes the working key.
      if (this.masterKey === null) {
        this.masterKey = candidate;
      }
    } else if (this.masterKey === null) {
      // Legacy mode should always have a device-bound key available. If for
      // some reason we are locked here, refuse rather than silently proceeding.
      throw new Error('存储处于锁定状态：无法设置主密码');
    }
    // Legacy mode with an available key: first-time enablement, no current
    // password to verify against.

    const oldKey = this.masterKey as Buffer;
    const newKey = newPassword ? this.derivePasswordKey(newPassword) : this.deriveLegacyKey();

    // Re-encrypt all secret-bearing fields
    const reEncrypt = (cipherPackage: string): string => {
      const plain = this.decryptWith(oldKey, cipherPackage);
      // Keep the original ciphertext if it cannot be decrypted (corrupt entry)
      return plain ? this.encryptWith(newKey, plain) : cipherPackage;
    };

    const hosts = this.getHosts();
    for (const h of hosts) {
      if (h.passwordEncrypted) h.passwordEncrypted = reEncrypt(h.passwordEncrypted);
      if (h.passphraseEncrypted) h.passphraseEncrypted = reEncrypt(h.passphraseEncrypted);
    }
    this.saveHosts(hosts);

    const settings = this.getSettings();
    for (const p of settings.ai?.providers ?? []) {
      if (p.apiKeyEncrypted) p.apiKeyEncrypted = reEncrypt(p.apiKeyEncrypted);
    }
    this.saveSettings(settings);

    // Persist or remove the verification token, then flip in-memory state
    if (newPassword) {
      fs.writeFileSync(this.verifyFilePath(), this.encryptWith(newKey, VERIFY_MAGIC), {
        mode: 0o600
      });
      this.masterPasswordEnabled = true;
    } else if (fs.existsSync(this.verifyFilePath())) {
      fs.unlinkSync(this.verifyFilePath());
      this.masterPasswordEnabled = false;
    }
    this.masterKey = newKey;
  }

  // -------------------------------------------------------------------------
  // Encrypt / decrypt
  // -------------------------------------------------------------------------

  private encryptWith(key: Buffer, plainText: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  private decryptWith(key: Buffer, cipherPackage: string): string {
    try {
      const parts = cipherPackage.split(':');
      if (parts.length !== 3) return '';
      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return '';
    }
  }

  public encrypt(plainText: string): string {
    if (!plainText) return '';
    if (this.masterKey === null) throw new StorageLockedError();
    return this.encryptWith(this.masterKey, plainText);
  }

  public decrypt(cipherPackage: string): string {
    if (!cipherPackage) return '';
    // While locked nothing can be decrypted; callers surface the lock state
    if (this.masterKey === null) return '';
    return this.decryptWith(this.masterKey, cipherPackage);
  }

  // -------------------------------------------------------------------------
  // Config persistence
  // -------------------------------------------------------------------------

  private initDefaultConfigs() {
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    if (!fs.existsSync(hostsPath)) {
      const defaultHosts: HostAsset[] = [
        {
          id: 'local-shell',
          name: '本机终端 (Local Shell)',
          group: '本机终端',
          host: 'localhost',
          port: 0,
          username: os.userInfo().username || 'local',
          authType: 'local',
          initialDir: os.homedir(),
          createdAt: Date.now()
        }
      ];
      fs.writeFileSync(hostsPath, JSON.stringify(defaultHosts, null, 2), 'utf8');
    } else {
      // Existing installs created before the local-shell feature keep their
      // stored host list; prepend the local terminal asset so the default
      // first tab connects to the real local shell instead of the old mock.
      try {
        let hosts: HostAsset[] = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
        let modified = false;

        // Strip legacy mock-local-demo and ops-sandbox if present
        if (
          Array.isArray(hosts) &&
          hosts.some(h => h.id === 'mock-local-demo' || h.id === 'ops-sandbox')
        ) {
          hosts = hosts.filter(h => h.id !== 'mock-local-demo' && h.id !== 'ops-sandbox');
          modified = true;
        }

        if (Array.isArray(hosts) && !hosts.some(h => h.authType === 'local')) {
          hosts.unshift({
            id: 'local-shell',
            name: '本机终端 (Local Shell)',
            group: '本机终端',
            host: 'localhost',
            port: 0,
            username: os.userInfo().username || 'local',
            authType: 'local',
            initialDir: os.homedir(),
            createdAt: Date.now()
          });
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(hostsPath, JSON.stringify(hosts, null, 2), 'utf8');
        }
      } catch (e) {
        console.error('Failed to migrate hosts.json', e);
      }
    }

    const settingsPath = path.join(this.dataDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings: AppSettings = {
        ai: {
          activeProvider: 'deepseek-api',
          providers: [
            {
              id: 'deepseek-api',
              name: 'DeepSeek 官方 API',
              type: 'deepseek',
              baseUrl: 'https://api.deepseek.com',
              model: 'deepseek-chat',
              temperature: 0.7
            },
            {
              id: 'qwen-api',
              name: 'Qwen 官方 API',
              type: 'qwen',
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              model: 'qwen-plus',
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
    } else {
      try {
        const settings: AppSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings && settings.ai && Array.isArray(settings.ai.providers)) {
          let modified = false;

          if (settings.ai.providers.some(p => p.id === 'mock-ai' || p.type === 'mock')) {
            settings.ai.providers = settings.ai.providers.filter(
              p => p.id !== 'mock-ai' && p.type !== 'mock'
            );
            modified = true;
          }

          if (!settings.ai.providers.some(p => p.id === 'qwen-api' || p.type === 'qwen')) {
            const qwenProvider: AppSettings['ai']['providers'][number] = {
              id: 'qwen-api',
              name: 'Qwen 官方 API',
              type: 'qwen',
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              model: 'qwen-plus',
              temperature: 0.7
            };
            const deepseekIdx = settings.ai.providers.findIndex(p => p.id === 'deepseek-api');
            if (deepseekIdx >= 0) {
              settings.ai.providers.splice(deepseekIdx + 1, 0, qwenProvider);
            } else {
              settings.ai.providers.unshift(qwenProvider);
            }
            modified = true;
          }

          if (
            settings.ai.providers.length > 0 &&
            !settings.ai.providers.some(p => p.id === settings.ai.activeProvider)
          ) {
            settings.ai.activeProvider = settings.ai.providers[0].id;
            modified = true;
          }

          if (modified) {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
          }
        }
      } catch (e) {
        console.error('Failed to migrate settings.json', e);
      }
    }
  }

  public isHostsCorrupted(): boolean {
    return this.hostsCorrupted;
  }

  public isSettingsCorrupted(): boolean {
    return this.settingsCorrupted;
  }

  public getHosts(): HostAsset[] {
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    try {
      if (fs.existsSync(hostsPath)) {
        const parsed = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
        if (!Array.isArray(parsed)) {
          console.error('Failed to read hosts.json (invalid shape, expected array):', typeof parsed);
          this.hostsCorrupted = true;
          return [];
        }
        this.hostsCorrupted = false;
        return parsed;
      }
    } catch (e) {
      console.error('Failed to read hosts.json (file corrupted or invalid JSON)', e);
      this.hostsCorrupted = true;
    }
    return [];
  }

  public saveHosts(hosts: HostAsset[]): void {
    if (this.hostsCorrupted) {
      throw new Error(
        'hosts.json 文件损坏，已阻止保存以防覆盖原有数据。请先从 hosts.json.bak 恢复或修复文件'
      );
    }
    const hostsPath = path.join(this.dataDir, 'hosts.json');
    const bakPath = path.join(this.dataDir, 'hosts.json.bak');
    const tmpPath = path.join(this.dataDir, `.hosts.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);

    if (fs.existsSync(hostsPath)) {
      try {
        fs.copyFileSync(hostsPath, bakPath);
      } catch (err) {
        console.warn('Failed to backup hosts.json before save', err);
      }
    }

    fs.writeFileSync(tmpPath, JSON.stringify(hosts, null, 2), 'utf8');
    fs.renameSync(tmpPath, hostsPath);
    this.hostsCorrupted = false;
  }

  public getSettings(): AppSettings {
    const settingsPath = path.join(this.dataDir, 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !parsed.ai ||
          !parsed.terminal
        ) {
          console.error('Failed to read settings.json (invalid shape, expected AppSettings object)');
          this.settingsCorrupted = true;
          return this.getDefaultSettings();
        }
        this.settingsCorrupted = false;
        return parsed;
      }
    } catch (e) {
      console.error('Failed to read settings.json (file corrupted or invalid JSON)', e);
      this.settingsCorrupted = true;
    }
    return this.getDefaultSettings();
  }

  public saveSettings(settings: AppSettings): void {
    if (this.settingsCorrupted) {
      throw new Error(
        'settings.json 文件损坏，已阻止保存以防覆盖原有数据。请先从 settings.json.bak 恢复或修复文件'
      );
    }
    const settingsPath = path.join(this.dataDir, 'settings.json');
    const bakPath = path.join(this.dataDir, 'settings.json.bak');
    const tmpPath = path.join(this.dataDir, `.settings.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);

    if (fs.existsSync(settingsPath)) {
      try {
        fs.copyFileSync(settingsPath, bakPath);
      } catch (err) {
        console.warn('Failed to backup settings.json before save', err);
      }
    }

    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmpPath, settingsPath);
    this.settingsCorrupted = false;
  }

  public getDefaultSettings(): AppSettings {
    return {
      ai: {
        activeProvider: 'deepseek-api',
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
