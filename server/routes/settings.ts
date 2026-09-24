import { Router } from 'express';
import { localStorageManager, AppSettings, StorageLockedError } from '../storage';
import { errorMessage } from '../../shared/errors';

export const settingsRouter = Router();

type ProviderEntry = AppSettings['ai']['providers'][number];

/** Provider record as received from the client, with an optional plaintext API key. */
interface ProviderPayload extends ProviderEntry {
  plainApiKey?: string;
}

/**
 * Request payload for POST /api/settings.
 * Note: allowEmptyProviders is a transient control flag; it is never persisted to disk.
 * If a future UI allows explicitly clearing all AI providers, it must send allowEmptyProviders: true.
 */
export interface UpdateSettingsPayload extends Partial<AppSettings> {
  /** If true, permits saving an empty providers array without triggering anti-wipe fallback. */
  allowEmptyProviders?: boolean;
}

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  const settings = localStorageManager.getSettings();
  res.json({ success: true, data: settings });
});

// POST /api/settings
settingsRouter.post('/', (req, res) => {
  const { allowEmptyProviders, ...incomingSettings } = req.body as UpdateSettingsPayload;
  const current = localStorageManager.getSettings();

  const settings: AppSettings = {
    ...current,
    ...incomingSettings,
    ai: {
      ...current.ai,
      ...(incomingSettings.ai || {}),
      providers: incomingSettings.ai?.providers ?? current.ai?.providers ?? []
    },
    shortcuts: {
      ...current.shortcuts,
      ...(incomingSettings.shortcuts || {})
    },
    guardrail: {
      ...current.guardrail,
      ...(incomingSettings.guardrail || {})
    },
    terminal: {
      ...current.terminal,
      ...(incomingSettings.terminal || {})
    }
  };

  // Protect against silent wipe of providers
  if (
    current.ai?.providers?.length > 0 &&
    (!incomingSettings.ai?.providers || incomingSettings.ai.providers.length === 0) &&
    !allowEmptyProviders
  ) {
    settings.ai.providers = current.ai.providers;
  }

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

  try {
    localStorageManager.saveSettings(settings);
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(409).json({ success: false, error: errorMessage(err) });
  }
});
