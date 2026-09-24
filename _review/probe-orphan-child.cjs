/**
 * 探针 3a（子进程）：spawn 一个本地 PTY shell，把 pid 落盘后保持存活，
 * 等待父进程把自己 kill 掉。
 */
const fs = require('fs');
const { spawn } = require('node-pty');

const shell =
  process.platform === 'win32'
    ? { cmd: 'powershell.exe', args: [] }
    : { cmd: process.env.SHELL || '/bin/bash', args: [] };

const pty = spawn(shell.cmd, shell.args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color' }
});

fs.writeFileSync(
  __dirname + '/orphan-pty.json',
  JSON.stringify({ ptyPid: pty.pid, shell: shell.cmd, spawnedAt: Date.now() })
);

// 保持进程存活；PTY 数据直接丢弃
pty.onData(() => {});
// 父进程 kill 本进程后自然退出
setInterval(() => {}, 10000);
