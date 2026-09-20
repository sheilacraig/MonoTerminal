import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalStorageManager, HostAsset } from '../server/storage';
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
});
