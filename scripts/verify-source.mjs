/**
 * 源码链路验证脚本（开发/CI 可用，对应打包链路的 verify-packaged.mjs）：
 *
 *   npm run build:all
 *   node scripts/verify-source.mjs
 *
 * 用构建产物 dist-server/index.cjs 起一个临时服务，逐项验证：
 *   1. 服务能正常启动，并回报真实端口
 *   2. 前端静态页面可加载（dist/index.html）
 *   3. /api/auth/bootstrap 能发放访问令牌
 *   4. 带令牌访问业务接口 200；不带令牌 401；伪造 Origin/Host 403
 *   5. WebSocket /ws 握手可用
 *   6. 前端产物里带上了本次新增能力的特征串（剪贴板作用域、提权预检）
 *
 * 任何一项 FAIL 都会以非 0 退出码结束，方便接进 CI。
 *
 * 注意：端口是**动态**选取的。历史教训是用固定端口时，若该端口已被别的实例
 * （例如用户自己跑着的旧版本）占用，服务会顺延到下一个端口，而脚本仍在打旧端口
 * → 冒烟测到的是**旧服务**，结果完全不可信。这里显式校验 READY 端口一致。
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const results = [];
function check(name, pass, extra = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${extra ? ` | ${extra}` : ''}`);
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

const distServer = path.resolve(process.cwd(), 'dist-server', 'index.cjs');
const distDir = path.resolve(process.cwd(), 'dist');

const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;

// --- 启动服务 ---------------------------------------------------------------
const child = spawn(process.execPath, [distServer], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', (d) => (output += d.toString()));
child.stderr.on('data', (d) => (output += d.toString()));
let exited = false;
child.on('exit', (code) => {
  exited = true;
  output += `\n[exit code=${code}]`;
});

const reportedPort = await new Promise((resolve) => {
  const deadline = setTimeout(() => resolve(0), 20000);
  const timer = setInterval(() => {
    const m = output.match(/MONOTERMINAL_READY port=(\d+)/);
    if (m || exited) {
      clearTimeout(deadline);
      clearInterval(timer);
      resolve(m ? Number(m[1]) : 0);
    }
  }, 150);
});

if (reportedPort !== PORT) {
  check('服务启动并回报真实端口', false, `期望 ${PORT}，实际 ${reportedPort || '未就绪'}`);
  console.error('\n--- 服务输出 ---\n' + output.slice(-3000));
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
check('服务启动并回报真实端口', true, `port=${PORT}`);

try {
  // 1. 静态页
  const rootRes = await fetch(`${BASE}/`);
  const rootText = await rootRes.text();
  check(
    'GET / 返回前端页面',
    rootRes.status === 200 && /<div id="root"[^>]*>/.test(rootText),
    `status=${rootRes.status} len=${rootText.length}`
  );

  // 2. 取令牌
  const bootRes = await fetch(`${BASE}/api/auth/bootstrap`);
  const boot = await bootRes.json().catch(() => ({}));
  const token = boot.token || boot.data?.token;
  check(
    'GET /api/auth/bootstrap 发放访问令牌',
    bootRes.status === 200 && typeof token === 'string' && token.length >= 16,
    `status=${bootRes.status}`
  );

  if (typeof token !== 'string' || !token) {
    throw new Error('未取得访问令牌，后续鉴权项无法验证');
  }
  const H = { Authorization: `Bearer ${token}` };

  // 3. 带令牌访问业务接口
  for (const route of ['/api/hosts', '/api/settings']) {
    const r = await fetch(`${BASE}${route}`, { headers: H });
    check(`GET ${route}（带令牌）正常`, r.status === 200, `status=${r.status}`);
  }

  // 4. 无令牌必须被拒
  const noTok = await fetch(`${BASE}/api/hosts`);
  check('GET /api/hosts（无令牌）被拒绝', [401, 403].includes(noTok.status), `status=${noTok.status}`);

  // 5. 伪造 Origin / Host 必须被拒（CSRF / DNS rebinding 防线）
  const evil = await fetch(`${BASE}/api/hosts`, {
    headers: { ...H, Origin: 'http://evil.example.com', Host: 'evil.example.com' }
  });
  check('伪造 Origin/Host 被拒绝', [401, 403].includes(evil.status), `status=${evil.status}`);

  // 6. WebSocket 握手
  const wsResult = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${encodeURIComponent(token)}`);
    const t = setTimeout(() => resolve('timeout'), 8000);
    ws.onopen = () => {
      clearTimeout(t);
      ws.close();
      resolve('open');
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve('error');
    };
  });
  check('WS /ws 握手成功', wsResult === 'open', wsResult);

  // 7. 前端产物特征串（确认本次能力真的进了构建产物，而不是只改了源码）
  const assetsDir = path.join(distDir, 'assets');
  const jsBundle = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('');
  const wanted = [
    ['data-copy-scope', '选中即复制 / 右键粘贴的作用域标记'],
    ['data-agent-input', 'AI 输入框定位标记'],
    ['sudo -v', 'sudo 提权预检命令'],
    ['无法读取剪贴板权限', '右键粘贴被拦时的提示文案']
  ];
  for (const [needle, label] of wanted) {
    check(`前端产物包含：${label}`, jsBundle.includes(needle), jsBundle.includes(needle) ? needle : `未找到 ${needle}`);
  }
} catch (err) {
  check('验证流程执行完成', false, err instanceof Error ? err.message : String(err));
} finally {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const failed = results.filter((r) => !r.pass).length;
console.log(
  `\n${failed === 0 ? '✅ 源码链路验证通过' : `❌ 有 ${failed} 项未通过，请检查构建产物`}（${
    results.length - failed
  }/${results.length}）`
);
process.exit(failed ? 1 : 0);
