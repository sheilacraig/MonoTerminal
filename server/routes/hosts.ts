import { Router } from 'express';
import { localStorageManager } from '../storage';

export const hostsRouter = Router();

// GET /api/hosts
hostsRouter.get('/', (req, res) => {
  const hosts = localStorageManager.getHosts();
  res.json({ success: true, data: hosts });
});

// POST /api/hosts
hostsRouter.post('/', (req, res) => {
  const hostData = req.body;
  if (!hostData.id) {
    hostData.id = 'host-' + Date.now().toString(36);
  }
  if (!hostData.createdAt) {
    hostData.createdAt = Date.now();
  }

  // Encrypt password or passphrase if provided in plaintext
  if (hostData.plainPassword) {
    hostData.passwordEncrypted = localStorageManager.encrypt(hostData.plainPassword);
    delete hostData.plainPassword;
  }
  if (hostData.plainPassphrase) {
    hostData.passphraseEncrypted = localStorageManager.encrypt(hostData.plainPassphrase);
    delete hostData.plainPassphrase;
  }

  const hosts = localStorageManager.getHosts();
  const index = hosts.findIndex(h => h.id === hostData.id);
  if (index >= 0) {
    hosts[index] = { ...hosts[index], ...hostData };
  } else {
    hosts.push(hostData);
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
