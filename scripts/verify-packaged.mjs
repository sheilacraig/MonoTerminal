/**
 * 打包产物验证脚本（打包后执行）：
 *
 *   node scripts/verify-packaged.mjs release/win-unpacked
 *
 * 用打包出来的 MonoTerminal.exe 以 ELECTRON_RUN_AS_NODE 模式拉起内置服务
 * （参数与 electron/main.cjs 完全一致），逐项验证：
 *   1. 关键产物是否存在（exe / app.asar / resources/dist / resources/dist-server / node-pty）
 *   2. 内置服务能否在 Electron 运行时下启动（原生模块加载不报错）
 *   3. 前端静态页面、REST 接口、WebSocket 鉴权是否正常
 *   4. 本地 PTY（终端）能否真正开出一个 shell 并回显
 *
 * 任何一项 FAIL 都会以非 0 退出码结束，方便接进 CI。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const unpackedArg = process.argv[2] || path.join('release', 'win-unpacked');
const unpacked = path.resolve(process.cwd(), unpackedArg);
const isWindows = process.platform === 'win32';
const exePath = path.join(unpacked, isWindows ? 'MonoTerminal.exe' : 'MonoTerminal');
const resourcesPath = path.join(unpacked, 'resources');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.once('listening', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.listen(0, '127.0.0.1');
  });
}

function request(port, method, urlPath, token) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', (err) => resolve({ status: 0, body: err.message }));
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** 用项目自带 ws 客户端完成握手并驱动一次「本地终端」会话。 */
async function ptyProbe(port, token, sessionId, marker) {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    let output = '';
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, detail: `等待超时，已收到：${JSON.stringify(output.slice(0, 150))}` });
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'term:init', sessionId, hostId: 'local-shell', cols: 80, rows: 24 }));
      setTimeout(
        () => ws.send(JSON.stringify({ type: 'term:input', sessionId, data: `echo ${marker}\r` })),
        2000
      );
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'term:error') {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, detail: msg.message });
        return;
      }
      if (msg.type === 'term:data' && typeof msg.data === 'string') {
        output += msg.data;
        if (output.split(marker).length - 1 >= 2) {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve({ ok: true, detail: '本地 PTY 回显正常' });
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: `WebSocket 错误：${err.message}` });
    });
  });
}

async function main() {
  check('解包目录存在', fs.existsSync(unpacked), unpacked);
  if (!fs.existsSync(unpacked)) process.exit(1);
  check('主程序存在', fs.existsSync(exePath), exePath);
  check('app.asar 存在', fs.existsSync(path.join(resourcesPath, 'app.asar')));
  check('前端资源 resources/dist/index.html 存在', fs.existsSync(path.join(resourcesPath, 'dist', 'index.html')));
  check('后端脚本 resources/dist-server/index.cjs 存在', fs.existsSync(path.join(resourcesPath, 'dist-server', 'index.cjs')));
  check('原生终端模块 node-pty 已随包携带', fs.existsSync(path.join(resourcesPath, 'node_modules', 'node-pty')));
  if (!fs.existsSync(exePath) || !fs.existsSync(path.join(resourcesPath, 'dist-server', 'index.cjs'))) {
    console.error('\n关键产物缺失，后续验证无法进行。请在打包前执行 npm run build:all。');
    process.exit(1);
  }

  const port = await freePort();
  const child = spawn(exePath, [path.join(resourcesPath, 'dist-server', 'index.cjs')], {
    cwd: resourcesPath,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      RESOURCES_PATH: resourcesPath,
      NODE_PATH: [
        path.join(resourcesPath, 'node_modules'),
        path.join(resourcesPath, 'app.asar.unpacked', 'node_modules')
      ].join(path.delimiter)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  let exited = false;
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('exit', (code) => {
    exited = true;
    stderr += `\n[exit code=${code}]`;
  });

  let ready = false;
  for (let i = 0; i < 80 && !exited; i++) {
    const res = await request(port, 'GET', '/api/auth/bootstrap');
    if (res.status >= 200 && res.status < 500) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check(
    '内置服务可在 Electron 运行时下启动',
    ready,
    ready ? '' : `stderr: ${stderr.slice(-600)}`
  );
  if (!ready) {
    console.error('\n--- 服务 stderr ---\n' + stderr.slice(-3000));
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  const boot = await request(port, 'GET', '/api/auth/bootstrap');
  let token = '';
  try {
    token = JSON.parse(boot.body).token;
  } catch {
    /* ignore */
  }
  check('bootstrap 能拿到访问令牌', Boolean(token));

  const page = await request(port, 'GET', '/');
  check('前端页面可加载', page.status === 200 && page.body.includes('id="root"'), `status=${page.status}`);

  const unauthorized = await request(port, 'GET', '/api/hosts');
  check('未带令牌访问接口被拒绝(401)', unauthorized.status === 401, `status=${unauthorized.status}`);

  const hosts = await request(port, 'GET', '/api/hosts', token);
  check('带令牌访问 /api/hosts 正常', hosts.status === 200, `status=${hosts.status}`);

  const sessionId = 'verify-1';
  const marker = 'VERIFY_OK';
  const ptyResult = await ptyProbe(port, token, sessionId, marker);
  check('本地终端 (PTY) 链路可用', ptyResult.ok, ptyResult.detail);

  try {
    child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (stderr.trim()) console.log('\n--- 服务 stderr ---\n' + stderr.slice(-1000));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${
    failed === 0
      ? '✅ 打包产物验证通过，可直接分发'
      : `❌ 有 ${failed} 项未通过，请勿分发该产物`
  }（${results.length - failed}/${results.length}）`);
  console.log(`日志目录参考：${path.join(process.env.APPDATA || os.homedir(), 'monoterminal', 'logs')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('验证脚本异常：', err);
  process.exit(2);
});
