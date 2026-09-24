/**
 * 探针 3（父进程）：模拟 Electron 退出时的清理方式（只 kill 直接子进程），
 * 验证 node-pty spawn 的 shell 是否成为孤儿进程残留。
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, 'out-orphan.txt');
const lines = [];
function log(s) {
  lines.push(s);
  console.log(s);
}

function pidAlive(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      timeout: 10000
    });
    return out.includes(String(pid));
  } catch {
    return false;
  }
}

async function main() {
  log('=== 进程树残留探针（模拟 Electron will-quit 只 kill 直接子进程） ===');

  const child = fork(path.join(__dirname, 'probe-orphan-child.cjs'), [], {
    stdio: 'ignore'
  });
  log(`fork 的后端服务模拟进程 pid=${child.pid}`);

  // 等子进程写出 pty pid
  const jsonPath = path.join(__dirname, 'orphan-pty.json');
  let info = null;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(jsonPath)) {
      try {
        info = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!info) {
    log('未能获取 pty pid，探针失败');
    fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
    process.exit(1);
  }
  log(`node-pty spawn 的 shell: ${info.shell} pid=${info.ptyPid}`);

  await new Promise(r => setTimeout(r, 1000));
  log(`kill 前检查: shell 存活=${pidAlive(info.ptyPid)}, 服务存活=${pidAlive(child.pid)}`);

  // 模拟 electron/main.cjs will-quit: serverProcess.kill()
  child.kill();
  await new Promise(r => setTimeout(r, 500));
  log(`kill 后: 服务存活=${pidAlive(child.pid)}, shell 存活=${pidAlive(info.ptyPid)}`);

  await new Promise(r => setTimeout(r, 2500));
  const aliveAfter3s = pidAlive(info.ptyPid);
  log(`3 秒后复查: shell 存活=${aliveAfter3s}`);
  log(
    aliveAfter3s
      ? '>>> 结论：服务进程被 kill 后，本机 shell 仍存活 —— 孤儿进程残留实证成立'
      : '>>> 结论：shell 随服务进程一起退出，无残留'
  );

  // 清理：尽力杀掉残留 shell
  if (aliveAfter3s && process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(info.ptyPid), '/T', '/F'], { timeout: 10000 });
      log(`已清理残留 shell pid=${info.ptyPid}`);
    } catch (e) {
      log(`清理失败: ${e.message}`);
    }
  } else if (aliveAfter3s) {
    try {
      process.kill(info.ptyPid, 'SIGKILL');
      log('已清理残留 shell');
    } catch {}
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
}

main().catch(e => {
  lines.push('FATAL: ' + (e && e.stack ? e.stack : String(e)));
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  process.exit(1);
});
