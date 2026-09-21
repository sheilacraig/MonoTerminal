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

        // Start shell
        client.shell({ term: 'xterm-256color', cols: 120, rows: 35 }, (err, stream) => {
          if (err) {
            if (!isResolved) {
              isResolved = true;
              reject(err);
            }
            return;
          }

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

          // Also initialize SFTP subsystem
          client.sftp((sftpErr, sftp) => {
            if (!sftpErr && sftp) {
              instance.sftp = sftp;
            }
          });

          if (!isResolved) {
            isResolved = true;
            resolve(instance);
          }
        });
      });

      client.on('error', (err) => {
        events.emit('error', err);
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      });

      client.on('close', () => {
        instance.isAlive = false;
        events.emit('close');
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
            path: dirPath.endsWith('/') ? `${dirPath}${item.filename}` : `${dirPath}/${item.filename}`,
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

    return new Promise((resolve, reject) => {
      const writeStream = session.sftp!.createWriteStream(filePath);
      writeStream.on('close', () => resolve());
      writeStream.on('error', (err: Error) => reject(err));
      writeStream.end(content, 'utf-8');
    });
  }

  public async sftpDelete(sessionId: string, targetPath: string, isDirectory: boolean): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.sftp) throw new Error('SFTP 未就绪');

    return new Promise((resolve, reject) => {
      if (isDirectory) {
        session.sftp!.rmdir(targetPath, err => (err ? reject(err) : resolve()));
      } else {
        session.sftp!.unlink(targetPath, err => (err ? reject(err) : resolve()));
      }
    });
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
      session.sftp!.mkdir(dirPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export const sshManager = new SshManager();
