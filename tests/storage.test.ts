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
});
