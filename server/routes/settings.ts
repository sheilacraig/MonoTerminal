import { Router } from 'express';
import { localStorageManager } from '../storage';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  const settings = localStorageManager.getSettings();
  res.json({ success: true, data: settings });
});

// POST /api/settings
settingsRouter.post('/', (req, res) => {
  const settings = req.body;
  // Encrypt plaintext API keys
  if (settings.ai?.providers) {
    for (const p of settings.ai.providers) {
      if (p.plainApiKey) {
        p.apiKeyEncrypted = localStorageManager.encrypt(p.plainApiKey);
        delete p.plainApiKey;
      }
    }
  }
  localStorageManager.saveSettings(settings);
  res.json({ success: true, data: settings });
});
