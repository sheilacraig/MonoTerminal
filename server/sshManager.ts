import { Client, ClientChannel, SFTPWrapper, ConnectConfig } from 'ssh2';
import EventEmitter from 'events';
import { HostAsset } from './storage';
import { FileItem } from './mockServer';

export interface SshSessionInstance {
  id: string;
  host: HostAsset;
  client: Client;
  channel?: ClientChannel;
  sftp?: SFTPWrapper;
  events: EventEmitter;
  isAlive: boolean;
}

export class SshManager {
  private sessions: Map<string, SshSessionInstance> = new Map();

  public async createSession(
    sessionId: string,
    host: HostAsset,
    decryptedPassword?: string,
    decryptedPassphrase?: string,
    privateKeyContent?: string
  ): Promise<SshSessionInstance> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.closeSession(sessionId);
    }

    const client = new Client();
    const events = new EventEmitter();

    const instance: SshSessionInstance = {
      id: sessionId,
      host,
      client,
      events,
      isAlive: false
    };

    this.sessions.set(sessionId, instance);

    return new Promise((resolve, reject) => {
      let isResolved = false;

      client.on('ready', () => {
        instance.isAlive = true;

        const startShell = new Promise<ClientChannel>((resShell, rejShell) => {
          client.shell({ term: 'xterm-256color', cols: 120, rows: 35 }, (err, stream) => {
            if (err) return rejShell(err);
            instance.channel = stream;

            stream.on('data', (data: Buffer) => {
              events.emit('data', data.toString('utf-8'));
            });

            stream.on('close', () => {
              events.emit('close');
              this.closeSession(sessionId);
            });

            stream.stderr.on('data', (data: Buffer) => {
              events.emit('data', data.toString('utf-8'));
            });

            resShell(stream);
          });
        });

        const startSftp = new Promise<void>(resSftp => {
          client.sftp((sftpErr, sftp) => {
            if (!sftpErr && sftp) {
              instance.sftp = sftp;
            }
            resSftp();
          });
        });

        Promise.all([startShell, startSftp])
          .then(() => {
            if (!isResolved) {
              isResolved = true;
              resolve(instance);
            }
          })
          .catch(err => {
            if (!isResolved) {
              isResolved = true;
              reject(err);
            }
          });
      });

      client.on('error', err => {
        if (events.listenerCount('error') > 0) {
          events.emit('error', err);
        }
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      });

      client.on('close', () => {
        instance.isAlive = false;
        events.emit('close');
        this.closeSession(sessionId);
      });

      // Connect config with TCP keepalive
      const connectConfig: ConnectConfig = {
        host: host.host,
        port: host.port || 22,
        username: host.username,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        readyTimeout: 20000
      };

      if (host.authType === 'password') {
        connectConfig.password = decryptedPassword;
      } else if (host.authType === 'privateKey') {
        connectConfig.privateKey = privateKeyContent;
        if (decryptedPassphrase) {
          connectConfig.passphrase = decryptedPassphrase;
        }
      }

      client.connect(connectConfig);
    });
  }

  public getSession(sessionId: string): SshSessionInstance | undefined {
    return this.sessions.get(sessionId);
  }

  public writeToShell(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && session.channel) {
      session.channel.write(data);
      return true;
    }
    return false;
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.channel) {
      session.channel.setWindow(rows, cols, 0, 0);
    }
  }

  public closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        if (session.channel) session.channel.close();
        if (session.sftp) session.sftp.end();
        session.client.end();
      } catch {
        // Ignore close errors
      }
      this.sessions.delete(sessionId);
    }
  }

  public async sftpList(sessionId: string, dirPath: string): Promise<FileItem[]> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) {
      throw new Error('SFTP 未就绪或会话不存在');
    }

    return new Promise((resolve, reject) => {
      session.sftp!.readdir(dirPath, (err, list) => {
        if (err) return reject(err);
        const results = list.map(item => {
          const isDir = (item.attrs.mode & 0o40000) === 0o40000;
          return {
            name: item.filename,
            path: dirPath.endsWith('/')
              ? `${dirPath}${item.filename}`
              : `${dirPath}/${item.filename}`,
            isDirectory: isDir,
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000,
            permissions: '0' + (item.attrs.mode & 0o777).toString(8),
            owner: `${item.attrs.uid}:${item.attrs.gid}`
          };
        });
        resolve(results);
      });
    });
  }

  public async sftpReadFile(sessionId: string, filePath: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    const stats = await new Promise<{ size: number }>((resolve, reject) => {
      session.sftp!.stat(filePath, (err, stats) => (err ? reject(err) : resolve(stats)));
    });

    const MAX_READ_SIZE = 10 * 1024 * 1024; // 10MB
    if (stats.size > MAX_READ_SIZE) {
      throw new Error(
        `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，在线编辑最大支持 10MB，请使用下载查看`
      );
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const readStream = session.sftp!.createReadStream(filePath);
      readStream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      readStream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      readStream.on('error', (err: Error) => reject(err));
    });
  }

  public async sftpWriteFile(sessionId: string, filePath: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    const sftp = session.sftp;
    const lastSlash = filePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
    const base = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    const tmpPath = `${dir ? dir + '/' : ''}.${base}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

    // 1. Write content to temporary file
    await new Promise<void>((resolve, reject) => {
      const writeStream = sftp.createWriteStream(tmpPath);
      writeStream.on('close', () => resolve());
      writeStream.on('error', (err: Error) => {
        sftp.unlink(tmpPath, () => {});
        reject(err);
      });
      writeStream.end(content, 'utf-8');
    });

    // 2. Safely replace target file
    // Strategy A: OpenSSH POSIX atomic rename (ext_openssh_rename).
    // Supported on OpenSSH SFTP servers, atomic overwrite without unlink window.
    const tryOpenSshRename = (): Promise<boolean> => {
      return new Promise(resolve => {
        if (typeof sftp.ext_openssh_rename === 'function') {
          try {
            sftp.ext_openssh_rename(tmpPath, filePath, (err?: Error | null) => {
              resolve(!err);
            });
          } catch {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });
    };

    const openSshSuccess = await tryOpenSshRename();
    if (openSshSuccess) {
      return;
    }

    // Strategy B: Fallback with backup to prevent data loss window.
    // Never unlink target before rename; backup first, rename tmp, then clean up backup.
    const backupPath = `${dir ? dir + '/' : ''}.${base}.bak.${Date.now()}`;
    const targetExisted = await new Promise<boolean>(resolve => {
      sftp.stat(filePath, err => resolve(!err));
    });

    if (targetExisted) {
      await new Promise<void>((resolve, reject) => {
        sftp.rename(filePath, backupPath, err => {
          if (err) reject(new Error(`无法为现有文件创建备份: ${err.message}`));
          else resolve();
        });
      });
    }

    await new Promise<void>((resolve, reject) => {
      sftp.rename(tmpPath, filePath, err => {
        if (err) {
          // Rename failed! Preserve tmpPath as recovered file so user content is never lost
          const recoveredPath = `${dir ? dir + '/' : ''}.${base}.recovered.${Date.now()}`;
          sftp.rename(tmpPath, recoveredPath, () => {});

          // If we had backed up the original file, restore it
          if (targetExisted) {
            sftp.rename(backupPath, filePath, () => {});
          }

          reject(new Error(`SFTP 更名目标文件失败，已恢复原文件并保留新内容至 ${recoveredPath}: ${err.message}`));
        } else {
          // Success! Clean up backup if it was created
          if (targetExisted) {
            sftp.unlink(backupPath, () => {});
          }
          resolve();
        }
      });
    });
  }

  private async rmdirRecursive(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const list = await new Promise<{ filename: string; attrs: { mode: number } }[]>(
      (resolve, reject) => {
        sftp.readdir(dirPath, (err, entries) => (err ? reject(err) : resolve(entries)));
      }
    );

    for (const item of list) {
      if (item.filename === '.' || item.filename === '..') continue;
      const fullPath = dirPath.endsWith('/')
        ? `${dirPath}${item.filename}`
        : `${dirPath}/${item.filename}`;
      const isDir = (item.attrs.mode & 0o40000) === 0o40000;
      if (isDir) {
        await this.rmdirRecursive(sftp, fullPath);
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.unlink(fullPath, err => (err ? reject(err) : resolve()));
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(dirPath, err => (err ? reject(err) : resolve()));
    });
  }

  public async sftpDelete(
    sessionId: string,
    targetPath: string,
    isDirectory: boolean
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    if (isDirectory) {
      await this.rmdirRecursive(session.sftp, targetPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.unlink(targetPath, err => (err ? reject(err) : resolve()));
      });
    }
  }

  public async sftpChmod(sessionId: string, targetPath: string, mode: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    const numMode = parseInt(mode, 8);
    return new Promise((resolve, reject) => {
      session.sftp!.chmod(targetPath, numMode, err => (err ? reject(err) : resolve()));
    });
  }

  public async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    return new Promise((resolve, reject) => {
      session.sftp!.rename(oldPath, newPath, err => (err ? reject(err) : resolve()));
    });
  }

  public async sftpMkdir(sessionId: string, dirPath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    return new Promise((resolve, reject) => {
      session.sftp!.mkdir(dirPath, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export const sshManager = new SshManager();
