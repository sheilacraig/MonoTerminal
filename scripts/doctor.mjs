/**
 * 运行环境自检（npm run doctor）。
 *
 * 目标：把「用户在自己机器上跑不起来」变成一份能直接看懂的检查清单，
 * 而不是一串堆栈。检查项覆盖：Node 版本、依赖是否安装、原生终端组件能否
 * 加载并真正开出一个 PTY、前端/后端产物是否已构建、端口是否可用、数据目录
 * 是否可写。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const results = [];

function record(name, ok, detail, fatal = true) {
  results.push({ name, ok, detail, fatal });
  const icon = ok ? '✅' : fatal ? '❌' : '⚠️';
  console.log(`${icon} ${name}${detail ? `\n     ${detail}` : ''}`);
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function checkPty() {
  let pty;
  try {
    pty = await import('node-pty');
  } catch (err) {
    return { ok: false, detail: `node-pty 无法加载：${err.message}` };
  }
  // 让 shell 自己执行完就退出（而不是我们主动 kill）：
  // node-pty 在 kill 时会 fork 一个 console 列表探测子进程，在无控制台的宿主里
  // 会打印 "AttachConsole failed"，看着像报错，实际无害——这里直接规避掉。
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : '/bin/sh';
  const args = isWindows ? ['/c', 'echo DOCTOR_OK'] : ['-c', 'echo DOCTOR_OK'];
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        term?.kill();
      } catch {
        /* ignore */
      }
      finish({ ok: output.includes('DOCTOR_OK'), detail: output.trim().slice(0, 120) || '未收到 PTY 输出' });
    }, 6000);
    let term;
    try {
      term = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: os.homedir() });
      term.onData((data) => {
        output += data;
        if (output.includes('DOCTOR_OK')) {
          finish({ ok: true, detail: '已成功创建本地伪终端并收到回显' });
        }
      });
    } catch (err) {
      finish({ ok: false, detail: `PTY 创建失败：${err.message}` });
    }
  });
}

async function main() {
  const requiredNode = 20;
  const major = Number(process.versions.node.split('.')[0]);
  record(
    `Node.js 版本（当前 v${process.versions.node}，需要 >= ${requiredNode}）`,
    major >= requiredNode,
    major >= requiredNode ? '' : `请升级 Node.js：https://nodejs.org/zh-cn/download`
  );

  console.log(`ℹ️  运行平台：${process.platform} ${process.arch}；项目目录：${root}`);

  const missingDeps = [];
  for (const dep of ['express', 'ws', 'ssh2', 'react', 'vite']) {
    if (!fs.existsSync(path.join(root, 'node_modules', dep))) missingDeps.push(dep);
  }
  record(
    '依赖是否已安装（node_modules）',
    missingDeps.length === 0,
    missingDeps.length ? `缺少：${missingDeps.join(', ')}。请先执行 npm install` : ''
  );

  const pty = await checkPty();
  record(
    '本地终端组件 node-pty',
    pty.ok,
    pty.ok ? pty.detail : `${pty.detail}\n     修复：npm rebuild node-pty（仍失败则改用 SSH 主机）`
  );

  const hasDist = fs.existsSync(path.join(root, 'dist', 'index.html'));
  record(
    '前端产物 dist/index.html',
    hasDist,
    hasDist ? '' : '未构建：执行 npm run build（或直接用 npm run serve 一条命令搞定）',
    false
  );

  const hasServerBundle = fs.existsSync(path.join(root, 'dist-server', 'index.cjs'));
  record(
    '后端产物 dist-server/index.cjs',
    hasServerBundle,
    hasServerBundle ? '' : '未构建：执行 npm run build:server',
    false
  );

  const preferredPort = Number(process.env.PORT || 3001);
  const portFree = await checkPortFree(preferredPort);
  record(
    `端口 ${preferredPort} 是否可用`,
    portFree,
    portFree ? '' : `该端口被占用。后端会自动改用后续空闲端口；如需固定端口：PORT=4000 npm start`,
    false
  );

  const dataDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), '.local', 'share'),
    'monoterminal'
  );
  let dataDirOk = true;
  let dataDirDetail = dataDir;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, '.doctor_probe');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (err) {
    dataDirOk = false;
    dataDirDetail = `${dataDir} 不可写：${err.message}`;
  }
  record('本地数据目录可写', dataDirOk, dataDirDetail);

  const fatalFailures = results.filter((r) => !r.ok && r.fatal);
  console.log(
    `\n${fatalFailures.length === 0 ? '✅ 自检通过：环境可以正常启动 MonoTerminal' : `❌ 发现 ${fatalFailures.length} 个阻断问题，请按上面的提示处理后重跑 npm run doctor`}`
  );
  process.exit(fatalFailures.length ? 1 : 0);
}

main().catch((err) => {
  console.error('自检脚本异常：', err);
  process.exit(2);
});
