import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageManager, HostAsset, StorageLockedError } from '../server/storage';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('LocalStorageManager & AES-256-GCM Encryption', () => {
  let tempDir: string;
  let storage: LocalStorageManager;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'monoterminal-test-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(tempDir, { recursive: true });
    storage = new LocalStorageManager(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should encrypt and decrypt sensitive strings correctly', () => {
    const sensitivePassword = 'SuperSecret_Password_2026!@#$%^';
    const encrypted = storage.encrypt(sensitivePassword);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(sensitivePassword);

    // Check format: iv:tag:ciphertext
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(24); // 12-byte IV in hex = 24 chars
    expect(parts[1].length).toBe(32); // 16-byte Tag in hex = 32 chars

    const decrypted = storage.decrypt(encrypted);
    expect(decrypted).toBe(sensitivePassword);
  });

  it('should reject tampered ciphertext safely without throwing uncaught exceptions', () => {
    const encrypted = storage.encrypt('ConfidentialData');
    const parts = encrypted.split(':');

    // Tamper with the ciphertext
    const tampered = `${parts[0]}:${parts[1]}:deadbeef${parts[2].slice(8)}`;
    const decrypted = storage.decrypt(tampered);
    expect(decrypted).toBe('');
  });

  it('should persist and retrieve host assets', () => {
    const testHost: HostAsset = {
      id: 'prod-01',
      name: 'Prod-Web01',
      group: '生产',
      host: '10.0.0.1',
      port: 2222,
      username: 'admin',
      authType: 'password',
      passwordEncrypted: storage.encrypt('admin123'),
      initialDir: '/var/www',
      createdAt: Date.now()
    };

    const hosts = storage.getHosts();
    hosts.push(testHost);
    storage.saveHosts(hosts);

    // Read back
    const reloaded = storage.getHosts();
    const found = reloaded.find(h => h.id === 'prod-01');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Prod-Web01');
    expect(found?.port).toBe(2222);
    expect(storage.decrypt(found?.passwordEncrypted || '')).toBe('admin123');
  });

  it('should persist and retrieve app settings', () => {
    const settings = storage.getSettings();
    expect(settings.shortcuts.toggleMode).toBe('Ctrl+\\');
    expect(settings.guardrail.enabled).toBe(true);

    settings.shortcuts.toggleMode = 'F2';
    storage.saveSettings(settings);

    const reloaded = storage.getSettings();
    expect(reloaded.shortcuts.toggleMode).toBe('F2');
  });

  it('should enable a master password, re-encrypt secrets and require unlock after restart', () => {
    // Prepare secrets under the legacy (device-bound) key
    const hosts = storage.getHosts();
    const secretHost: HostAsset = {
      id: 'h-mp-1',
      name: 'MP-Test',
      group: '测试',
      host: '10.0.0.9',
      port: 22,
      username: 'u',
      authType: 'password',
      passwordEncrypted: storage.encrypt('top-secret'),
      createdAt: Date.now()
    };
    hosts.push(secretHost);
    storage.saveHosts(hosts);

    const settings = storage.getSettings();
    settings.ai.providers[0].apiKeyEncrypted = storage.encrypt('sk-legacy-key');
    storage.saveSettings(settings);

    // Enable master password protection
    storage.setMasterPassword(null, 'hunter2!strong');
    expect(storage.getSecurityStatus()).toEqual({ masterPasswordEnabled: true, locked: false });

    // Secrets remain readable in the same process (re-encrypted transparently)
    const h = storage.getHosts().find(x => x.id === 'h-mp-1');
    expect(storage.decrypt(h?.passwordEncrypted || '')).toBe('top-secret');

    // Simulate a server restart → starts locked
    const restarted = new LocalStorageManager(tempDir);
    expect(restarted.getSecurityStatus()).toEqual({ masterPasswordEnabled: true, locked: true });
    const h2 = restarted.getHosts().find(x => x.id === 'h-mp-1');
    expect(restarted.decrypt(h2?.passwordEncrypted || '')).toBe(''); // locked → no decryption
    expect(() => restarted.encrypt('anything')).toThrow(StorageLockedError);

    // Wrong password is rejected, stays locked
    expect(restarted.unlock('wrong-password')).toBe(false);
    expect(restarted.getSecurityStatus().locked).toBe(true);

    // Correct password unlocks; all secrets survive the re-key
    expect(restarted.unlock('hunter2!strong')).toBe(true);
    const h3 = restarted.getHosts().find(x => x.id === 'h-mp-1');
    expect(restarted.decrypt(h3?.passwordEncrypted || '')).toBe('top-secret');
    const s3 = restarted.getSettings();
    expect(restarted.decrypt(s3.ai.providers[0].apiKeyEncrypted || '')).toBe('sk-legacy-key');
  });

  it('should change and remove the master password', () => {
    storage.setMasterPassword(null, 'first-pw-123');

    // Wrong current password must be rejected on change
    expect(() => storage.setMasterPassword('wrong-pw', 'second-pw')).toThrow();

    // Correct change
    storage.setMasterPassword('first-pw-123', 'second-pw-456');
    const restarted = new LocalStorageManager(tempDir);
    expect(restarted.unlock('first-pw-123')).toBe(false);
    expect(restarted.unlock('second-pw-456')).toBe(true);

    // Remove protection → back to legacy device-bound key, unlocked at startup
    restarted.setMasterPassword('second-pw-456', '');
    expect(restarted.getSecurityStatus()).toEqual({ masterPasswordEnabled: false, locked: false });

    const legacy = new LocalStorageManager(tempDir);
    expect(legacy.getSecurityStatus()).toEqual({ masterPasswordEnabled: false, locked: false });
    expect(legacy.isLocked()).toBe(false);
  });

  it('legacy mode reports unlocked status and never requires a password', () => {
    expect(storage.getSecurityStatus()).toEqual({ masterPasswordEnabled: false, locked: false });
    expect(storage.unlock('anything')).toBe(true); // nothing to unlock
    storage.lock(); // no-op in legacy mode
    expect(storage.isLocked()).toBe(false);
  });

  // Regression: previously, once the store was unlocked in memory, calling
  // setMasterPassword with a null / empty currentPassword would silently
  // rotate or wipe the master password. Any local process able to reach
  // /api/security/master-password could exploit this during an active session.
  it('should refuse to change or remove the master password without currentPassword even when unlocked', () => {
    storage.setMasterPassword(null, 'first-pw-123');
    expect(storage.getSecurityStatus()).toEqual({ masterPasswordEnabled: true, locked: false });

    // Attacker path 1: null currentPassword while store is unlocked
    expect(() => storage.setMasterPassword(null, 'attacker-pw')).toThrow(/当前主密码/);
    // Attacker path 2: empty string currentPassword
    expect(() => storage.setMasterPassword('', 'attacker-pw')).toThrow(/当前主密码/);
    // Attacker path 3: attempt to wipe protection entirely
    expect(() => storage.setMasterPassword(null, '')).toThrow(/当前主密码/);
    expect(() => storage.setMasterPassword('', '')).toThrow(/当前主密码/);

    // The original password must still work after the rejected attempts
    const restarted = new LocalStorageManager(tempDir);
    expect(restarted.unlock('first-pw-123')).toBe(true);
  });

  it('should detect corruption and invalid schema in hosts.json and refuse to save', () => {
    const hostsPath = path.join(tempDir, 'hosts.json');

    // Case 1: Malformed JSON syntax
    fs.writeFileSync(hostsPath, '{"broken": [json', 'utf8');
    const result1 = storage.getHosts();
    expect(result1).toEqual([]);
    expect(storage.isHostsCorrupted()).toBe(true);
    expect(() => storage.saveHosts([])).toThrow(/hosts\.json 文件损坏/);

    // Verify original content was not overwritten
    expect(fs.readFileSync(hostsPath, 'utf8')).toBe('{"broken": [json');

    // Case 2: Valid JSON but wrong shape (not an array)
    fs.writeFileSync(hostsPath, JSON.stringify({ not: 'an array', validJson: true }), 'utf8');
    const result2 = storage.getHosts();
    expect(result2).toEqual([]);
    expect(storage.isHostsCorrupted()).toBe(true);
    expect(() => storage.saveHosts([])).toThrow(/hosts\.json 文件损坏/);
  });

  it('should detect corruption and invalid schema in settings.json and refuse to save', () => {
    const settingsPath = path.join(tempDir, 'settings.json');

    // Case 1: Malformed JSON syntax
    fs.writeFileSync(settingsPath, 'not json at all', 'utf8');
    const result1 = storage.getSettings();
    expect(result1).toBeDefined();
    expect(storage.isSettingsCorrupted()).toBe(true);
    expect(() => storage.saveSettings(result1)).toThrow(/settings\.json 文件损坏/);

    // Case 2: Valid JSON but wrong shape (missing required sections)
    fs.writeFileSync(settingsPath, JSON.stringify({ invalidShape: true }), 'utf8');
    const result2 = storage.getSettings();
    expect(result2).toBeDefined();
    expect(storage.isSettingsCorrupted()).toBe(true);
    expect(() => storage.saveSettings(result2)).toThrow(/settings\.json 文件损坏/);
  });

  it('should create .bak backup before overwriting and leave no tmp files', () => {
    const hosts = storage.getHosts();
    const initialCount = hosts.length;

    hosts.push({
      id: 'h-atom-1',
      name: 'Atom1',
      group: '测试',
      host: '10.0.0.2',
      port: 22,
      username: 'u',
      authType: 'mock',
      createdAt: Date.now()
    });
    storage.saveHosts(hosts);

    // Second save: hosts.json.bak must be generated with previous version
    hosts.push({
      id: 'h-atom-2',
      name: 'Atom2',
      group: '测试',
      host: '10.0.0.3',
      port: 22,
      username: 'u',
      authType: 'mock',
      createdAt: Date.now()
    });
    storage.saveHosts(hosts);

    const bakPath = path.join(tempDir, 'hosts.json.bak');
    expect(fs.existsSync(bakPath)).toBe(true);
    const bakContent: HostAsset[] = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
    expect(bakContent.length).toBe(initialCount + 1);

    // Check no tmp files left
    const files = fs.readdirSync(tempDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    expect(tmpFiles.length).toBe(0);
  });
});
