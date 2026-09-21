import { Router } from 'express';
import { localStorageManager } from '../storage';
import { errorMessage } from '../../shared/errors';

export const securityRouter = Router();

// GET /api/security/status — does the store use a master password / is it locked?
securityRouter.get('/status', (req, res) => {
  res.json({ success: true, data: localStorageManager.getSecurityStatus() });
});

// POST /api/security/unlock { password }
securityRouter.post('/unlock', (req, res) => {
  const { password } = req.body as { password?: unknown };
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ success: false, error: '缺少 password 字段' });
    return;
  }
  const ok = localStorageManager.unlock(password);
  if (ok) {
    res.json({ success: true, data: localStorageManager.getSecurityStatus() });
  } else {
    res.status(401).json({ success: false, error: '主密码不正确' });
  }
});

// POST /api/security/lock — drop the key from memory (only meaningful when enabled)
securityRouter.post('/lock', (req, res) => {
  localStorageManager.lock();
  res.json({ success: true, data: localStorageManager.getSecurityStatus() });
});

/**
 * POST /api/security/master-password
 * Body: { currentPassword?: string, newPassword: string }
 * - newPassword non-empty: set or change the master password (re-encrypts all secrets)
 * - newPassword === '':    remove the master password (falls back to legacy key)
 */
securityRouter.post('/master-password', (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string | null;
    newPassword?: unknown;
  };

  if (typeof newPassword !== 'string') {
    res.status(400).json({ success: false, error: '缺少 newPassword 字段（传空字符串表示移除主密码）' });
    return;
  }
  if (newPassword && newPassword.length < 6) {
    res.status(400).json({ success: false, error: '主密码长度至少为 6 个字符' });
    return;
  }

  try {
    localStorageManager.setMasterPassword(
      typeof currentPassword === 'string' ? currentPassword : null,
      newPassword
    );
    res.json({ success: true, data: localStorageManager.getSecurityStatus() });
  } catch (err) {
    res.status(400).json({ success: false, error: errorMessage(err) });
  }
});
