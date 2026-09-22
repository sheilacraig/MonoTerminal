import { Router } from 'express';
import { localStorageManager, HostAsset, StorageLockedError } from '../storage';
import { generateId } from '../../shared/id';
import { errorMessage } from '../../shared/errors';

export const hostsRouter = Router();

/**
 * Payload accepted by POST /api/hosts: a (partial) host record plus optional
 * plaintext secrets. Plaintext fields are encrypted immediately and must
 * never be persisted.
 */
interface HostPayload extends Partial<HostAsset> {
  plainPassword?: string;
  plainPassphrase?: string;
}

// GET /api/hosts
hostsRouter.get('/', (req, res) => {
  const hosts = localStorageManager.getHosts();
  const sanitized = hosts.map(h => {
    const { passwordEncrypted, passphraseEncrypted, ...rest } = h;
    return {
      ...rest,
      hasPassword: Boolean(passwordEncrypted),
      hasPassphrase: Boolean(passphraseEncrypted)
    };
  });
  res.json({ success: true, data: sanitized });
});

// POST /api/hosts
hostsRouter.post('/', (req, res) => {
  // Destructure plaintext secrets out so they can never leak into storage
  const { plainPassword, plainPassphrase, ...hostData } = req.body as HostPayload;

  if (!hostData.id) {
    hostData.id = generateId('host-');
  }
  if (!hostData.createdAt) {
    hostData.createdAt = Date.now();
  }

  // Encrypt password or passphrase if provided in plaintext
  try {
    if (plainPassword) {
      hostData.passwordEncrypted = localStorageManager.encrypt(plainPassword);
    }
    if (plainPassphrase) {
      hostData.passphraseEncrypted = localStorageManager.encrypt(plainPassphrase);
    }
  } catch (err) {
    if (err instanceof StorageLockedError) {
      res.status(423).json({ success: false, error: errorMessage(err) });
      return;
    }
    throw err;
  }

  const hosts = localStorageManager.getHosts();
  const index = hosts.findIndex(h => h.id === hostData.id);
  if (index >= 0) {
    hosts[index] = {
      ...hosts[index],
      ...hostData,
      passwordEncrypted: hostData.passwordEncrypted ?? hosts[index].passwordEncrypted,
      passphraseEncrypted: hostData.passphraseEncrypted ?? hosts[index].passphraseEncrypted
    } as HostAsset;
  } else {
    hosts.push(hostData as HostAsset);
  }

  localStorageManager.saveHosts(hosts);
  res.json({ success: true, data: hostData });
});

// DELETE /api/hosts/:id
hostsRouter.delete('/:id', (req, res) => {
  const { id } = req.params;
  let hosts = localStorageManager.getHosts();
  hosts = hosts.filter(h => h.id !== id);
  localStorageManager.saveHosts(hosts);
  res.json({ success: true });
});
