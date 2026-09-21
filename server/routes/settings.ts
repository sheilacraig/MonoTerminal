import { Router } from 'express';
import { localStorageManager, AppSettings, StorageLockedError } from '../storage';
import { errorMessage } from '../../shared/errors';

export const settingsRouter = Router();

type ProviderEntry = AppSettings['ai']['providers'][number];

/** Provider record as received from the client, with an optional plaintext API key. */
interface ProviderPayload extends ProviderEntry {
  plainApiKey?: string;
}

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  const settings = localStorageManager.getSettings();
  res.json({ success: true, data: settings });
});

// POST /api/settings
settingsRouter.post('/', (req, res) => {
  const settings = req.body as AppSettings;

  // Encrypt plaintext API keys — the transient field is stripped before persistence
  try {
    const providers = (settings.ai?.providers ?? []) as ProviderPayload[];
    for (const p of providers) {
      if (p.plainApiKey) {
        p.apiKeyEncrypted = localStorageManager.encrypt(p.plainApiKey);
        delete p.plainApiKey;
      }
    }
  } catch (err) {
    if (err instanceof StorageLockedError) {
      res.status(423).json({ success: false, error: errorMessage(err) });
      return;
    }
    throw err;
  }

  localStorageManager.saveSettings(settings);
  res.json({ success: true, data: settings });
});
