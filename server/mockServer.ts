import EventEmitter from 'events';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime: number;
  permissions: string; // e.g. "0644"
  owner: string;
}

export class MockFileSystem {
  private files: Map<string, { content: string; isDir: boolean; size: number; mtime: number; mode: string }> = new Map();

  constructor() {
    this.initDefaultFiles();
  }

  private initDefaultFiles() {
    const addDir = (dirPath: string) => {
      this.files.set(dirPath.replace(/\/+$/, ''), {
        content: '',
        isDir: true,
        size: 4096,
        mtime: Date.now() - 3600000,
        mode: '0755'
      });
    };

    const addFile = (filePath: string, content: string, mode = '0644') => {
      this.files.set(filePath, {
        content,
        isDir: false,
        size: Buffer.byteLength(content, 'utf8'),
        mtime: Date.now() - 1800000,
        mode
      });
    };

    // Root dirs
    addDir('/etc');
    addDir('/etc/nginx');
    addDir('/etc/nginx/conf.d');
    addDir('/etc/nginx/ssl');
    addDir('/var');
    addDir('/var/log');
    addDir('/var/log/nginx');
    addDir('/home');
    addDir('/home/deploy');
    addDir('/home/deploy/app');
    addDir('/root');

    // Nginx configs
    addFile('/etc/nginx/nginx.conf', `user www-data;
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 1024;
}

http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging Settings
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Virtual Host Configs
    include /etc/nginx/conf.d/*.conf;
}
`);

    addFile('/etc/nginx/conf.d/default.conf', `server {
    listen 80 default_server;
    listen [::]:80 default_server;

    root /var/www/html;
    index index.html index.htm;

    server_name _;

    location / {
        try_files $uri $uri/ =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
`);

    addFile('/etc/nginx/mime.types', `types {
    text/html                             html htm shtml;
    text/css                              css;
    text/xml                              xml;
    image/gif                             gif;
    image/jpeg                            jpeg jpg;
    application/javascript                js;
    application/json                      json;
}
`);

    // Logs
    addFile('/var/log/nginx/error.log', `2026/09/20 18:42:10 [emerg] 1042#1042: bind() to 0.0.0.0:80 failed (98: Address already in use)
2026/09/20 18:42:11 [emerg] 1042#1042: bind() to 0.0.0.0:80 failed (98: Address already in use)
2026/09/20 18:42:12 [emerg] 1042#1042: still could not bind()
2026/09/20 18:42:12 [alert] 1042#1042: could not start nginx master process
`);

    addFile('/var/log/syslog', `Sep 20 18:40:01 prod-web01 CRON[892]: (root) CMD (/usr/local/bin/monitor.sh)
Sep 20 18:42:10 prod-web01 systemd[1]: Starting A high performance web server and a reverse proxy server...
Sep 20 18:42:12 prod-web01 nginx[1042]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
Sep 20 18:42:12 prod-web01 systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE
Sep 20 18:42:12 prod-web01 systemd[1]: nginx.service: Failed with result 'exit-code'.
Sep 20 18:42:12 prod-web01 systemd[1]: Failed to start A high performance web server and a reverse proxy server.
`);

    // Deploy app
    addFile('/home/deploy/app/docker-compose.yml', `version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    restart: always
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
`);

    addFile('/home/deploy/app/.env', `NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
REDIS_URL=redis://127.0.0.1:6379
`);

    addFile('/root/.bashrc', `# ~/.bashrc: executed by bash(1) for non-login shells.
export HISTCONTROL=ignoreboth
export HISTSIZE=1000
export HISTFILESIZE=2000
export PS1='\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'
`);
  }

  public list(dirPath: string): FileItem[] {
    const targetDir = dirPath.replace(/\/+$/, '') || '/';
    const results: FileItem[] = [];

    for (const [fPath, meta] of this.files.entries()) {
      if (fPath === targetDir) continue;

      // Check if fPath is an immediate child of targetDir
      const parentDir = fPath.substring(0, fPath.lastIndexOf('/')) || '/';
      if (parentDir === targetDir) {
        const name = fPath.substring(fPath.lastIndexOf('/') + 1);
        results.push({
          name,
          path: fPath,
          isDirectory: meta.isDir,
          size: meta.size,
          modifyTime: meta.mtime,
          permissions: meta.mode,
          owner: 'root:root'
        });
      }
    }

    // Sort folders first, then alphabetically
    return results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  public readFile(filePath: string): string {
    const item = this.files.get(filePath);
    if (!item) throw new Error(`文件不存在: ${filePath}`);
    if (item.isDir) throw new Error(`不能读取目录: ${filePath}`);
    return item.content;
  }

  public writeFile(filePath: string, content: string): void {
    const existing = this.files.get(filePath);
    this.files.set(filePath, {
      content,
      isDir: false,
      size: Buffer.byteLength(content, 'utf8'),
      mtime: Date.now(),
      mode: existing ? existing.mode : '0644'
    });
  }

  public mkdir(dirPath: string): void {
    const cleanPath = dirPath.replace(/\/+$/, '');
    this.files.set(cleanPath, {
      content: '',
      isDir: true,
      size: 4096,
      mtime: Date.now(),
      mode: '0755'
    });
  }

  public delete(targetPath: string): void {
    const cleanPath = targetPath.replace(/\/+$/, '');
    // Delete file or dir recursively
    for (const key of Array.from(this.files.keys())) {
      if (key === cleanPath || key.startsWith(cleanPath + '/')) {
        this.files.delete(key);
      }
    }
  }

  public rename(oldPath: string, newPath: string): void {
    const cleanOld = oldPath.replace(/\/+$/, '');
    const cleanNew = newPath.replace(/\/+$/, '');
    const item = this.files.get(cleanOld);
    if (!item) throw new Error(`目标文件不存在: ${oldPath}`);

    this.files.delete(cleanOld);
    this.files.set(cleanNew, item);

    // If dir, rename children
    if (item.isDir) {
      for (const [key, val] of Array.from(this.files.entries())) {
        if (key.startsWith(cleanOld + '/')) {
          const suffix = key.slice(cleanOld.length);
          this.files.delete(key);
          this.files.set(cleanNew + suffix, val);
        }
      }
    }
  }

  public chmod(targetPath: string, mode: string): void {
    const item = this.files.get(targetPath.replace(/\/+$/, ''));
    if (!item) throw new Error(`文件不存在: ${targetPath}`);
    item.mode = mode;
  }
}

export class MockTerminalSession extends EventEmitter {
  public id: string;
  private fs: MockFileSystem;
  private currentDir: string = '/etc/nginx';
  private inputBuffer: string = '';
  private isRawMode: boolean = true;

  constructor(id: string, fs: MockFileSystem) {
    super();
    this.id = id;
    this.fs = fs;
  }

  public init() {
    const banner = [
      '\r\n\x1b[1;36m==============================================================\x1b[0m',
      '\x1b[1;32m  🚀 MonoTerminal 仿真终端已就绪 (Ubuntu 22.04 LTS x86_64)\x1b[0m',
      '\x1b[33m  提示: 按 [Ctrl + \\] 即可唤出 AI 运维 Agent 穿梭流！\x1b[0m',
      '\x1b[33m  试试输入 [systemctl status nginx] 触发报错感知排查！\x1b[0m',
      '\x1b[1;36m==============================================================\x1b[0m\r\n'
    ].join('\r\n');

    this.emit('data', banner);
    this.sendPrompt();
  }

  private sendPrompt() {
    const prompt = `\r\n\x1b[1;32mroot@prod-web01\x1b[0m:\x1b[1;34m${this.currentDir}\x1b[0m# `;
    this.emit('data', prompt);
  }

  public write(data: string) {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const code = char.charCodeAt(0);

      // Carriage return / Enter
      if (char === '\r' || char === '\n') {
        this.emit('data', '\r\n');
        this.executeCommand(this.inputBuffer.trim());
        this.inputBuffer = '';
        this.sendPrompt();
      }
      // Backspace (127 or \b)
      else if (code === 127 || char === '\b') {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.emit('data', '\b \b');
        }
      }
      // Ctrl+C (3)
      else if (code === 3) {
        this.inputBuffer = '';
        this.emit('data', '^C');
        this.sendPrompt();
      }
      // Ctrl+L (12) - clear
      else if (code === 12) {
        this.emit('data', '\x1b[2J\x1b[H');
        this.sendPrompt();
      }
      // Normal character
      else if (code >= 32) {
        this.inputBuffer += char;
        this.emit('data', char);
      }
    }
  }

  private executeCommand(cmd: string) {
    if (!cmd) return;

    const parts = cmd.split(/\s+/);
    const mainCmd = parts[0];
    const args = parts.slice(1);

    if (mainCmd === 'pwd') {
      this.emit('data', `${this.currentDir}\r\n`);
    } else if (mainCmd === 'whoami') {
      this.emit('data', 'root\r\n');
    } else if (mainCmd === 'id') {
      this.emit('data', 'uid=0(root) gid=0(root) groups=0(root)\r\n');
    } else if (mainCmd === 'uname' || cmd === 'uname -a') {
      this.emit('data', 'Linux prod-web01 5.15.0-107-generic #117-Ubuntu SMP Mon Apr 29 16:49:55 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\r\n');
    } else if (mainCmd === 'clear') {
      this.emit('data', '\x1b[2J\x1b[H');
    } else if (mainCmd === 'cd') {
      const target = args[0] || '/root';
      if (target === '..') {
        const lastSlash = this.currentDir.lastIndexOf('/');
        this.currentDir = lastSlash > 0 ? this.currentDir.substring(0, lastSlash) : '/';
      } else if (target === '/') {
        this.currentDir = '/';
      } else if (target.startsWith('/')) {
        this.currentDir = target.replace(/\/+$/, '') || '/';
      } else {
        this.currentDir = (this.currentDir === '/' ? `/${target}` : `${this.currentDir}/${target}`).replace(/\/+$/, '');
      }
    } else if (mainCmd === 'ls' || mainCmd === 'll') {
      const items = this.fs.list(this.currentDir);
      for (const item of items) {
        const color = item.isDirectory ? '\x1b[1;34m' : '\x1b[0m';
        const dateStr = new Date(item.modifyTime).toISOString().slice(0, 16).replace('T', ' ');
        const sizeStr = item.size.toString().padStart(6, ' ');
        const mode = item.isDirectory ? 'd' + item.permissions : '-' + item.permissions;
        this.emit('data', `${mode} 1 root root ${sizeStr} ${dateStr} ${color}${item.name}\x1b[0m\r\n`);
      }
    } else if (mainCmd === 'cat') {
      const filename = args[0];
      if (!filename) {
        this.emit('data', 'cat: missing file operand\r\n');
        return;
      }
      const fullPath = filename.startsWith('/') ? filename : (this.currentDir === '/' ? `/${filename}` : `${this.currentDir}/${filename}`);
      try {
        const content = this.fs.readFile(fullPath);
        this.emit('data', content.replace(/\n/g, '\r\n') + '\r\n');
      } catch (err: any) {
        this.emit('data', `cat: ${filename}: ${err.message}\r\n`);
      }
    } else if (cmd.includes('systemctl status nginx') || cmd.includes('systemctl restart nginx') || cmd.includes('nginx')) {
      if (cmd.includes('nginx -t')) {
        this.emit('data', 'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\r\nnginx: configuration file /etc/nginx/nginx.conf test is successful\r\n');
      } else {
        // Trigger realistic error
        this.emit('data', `\x1b[31m● nginx.service - A high performance web server and a reverse proxy server\x1b[0m
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled; vendor preset: enabled)
     Active: \x1b[1;31mfailed\x1b[0m (Result: exit-code) since Sun 2026-09-20 18:42:12 CST; 5min ago
    Process: 1042 ExecStartPre=/usr/sbin/nginx -t -q -g daemon on; master_process on; (code=exited, status=0/SUCCESS)
    Process: 1045 ExecStart=/usr/sbin/nginx -g daemon on; master_process on; \x1b[1;31m(code=exited, status=1/FAILURE)\x1b[0m
   Main PID: 1045 (code=exited, status=1/FAILURE)

Sep 20 18:42:10 prod-web01 nginx[1045]: \x1b[1;31mnginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\x1b[0m
Sep 20 18:42:11 prod-web01 nginx[1045]: \x1b[1;31mnginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\x1b[0m
Sep 20 18:42:12 prod-web01 systemd[1]: nginx.service: Failed with result 'exit-code'.
\r\n`);
      }
    } else if (cmd.includes('netstat') || cmd.includes('ss')) {
      this.emit('data', `State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port   Process
LISTEN   0        128              0.0.0.0:22             0.0.0.0:*       users:(("sshd",pid=620,fd=3))
LISTEN   0        511              0.0.0.0:80             0.0.0.0:*       users:(("apache2",pid=842,fd=4))
LISTEN   0        128            127.0.0.1:3000           0.0.0.0:*       users:(("node",pid=1120,fd=19))
LISTEN   0        511              0.0.0.0:6379           0.0.0.0:*       users:(("redis-server",pid=710,fd=6))
\r\n`);
    } else if (cmd.includes('docker ps')) {
      this.emit('data', `CONTAINER ID   IMAGE          COMMAND                  CREATED         STATUS         PORTS                  NAMES
e3f892a11b0c   redis:7        "docker-entrypoint.s…"   2 hours ago     Up 2 hours     0.0.0.0:6379->6379/tcp redis-prod
8b3a01944da2   postgres:15    "docker-entrypoint.s…"   5 hours ago     Up 5 hours     5432/tcp               db-cluster
\r\n`);
    } else if (cmd.includes('df -h')) {
      this.emit('data', `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G   14G   24G  38% /
/dev/sda15      105M  6.1M   99M   6% /boot/efi
tmpfs           3.9G     0  3.9G   0% /run/user/0
\r\n`);
    } else if (cmd.includes('kill')) {
      this.emit('data', `[process terminated] successfully released port 80.\r\n`);
    } else {
      this.emit('data', `[exec] ${cmd}\r\n`);
    }
  }

  public resize(cols: number, rows: number) {
    // Terminal resize event
  }

  public getCurrentDir() {
    return this.currentDir;
  }
}
