/**
 * 打包前清理 electron-builder 的暂存目录（release/win-unpacked 等）。
 *
 * 为什么需要它：electron-builder 会先解压 Electron 到 release/win-unpacked，
 * 再往里面写入 app.asar。如果上一次打包被中断（或调试时双击运行过
 * win-unpacked 里的 exe、被杀软/同步盘占用），残留文件会被锁定，下一次打包会
 * 直接失败（典型报错：EBUSY: resource busy or locked, unlink '...default_app.asar'）。
 * 因此每次打包前先清掉暂存目录，只保留已经生成好的 .exe 安装包。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const releaseDir = path.resolve(process.cwd(), 'release');
const stagingDirs = fs.existsSync(releaseDir)
  ? fs
      .readdirSync(releaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /unpacked$/i.test(entry.name))
      .map((entry) => path.join(releaseDir, entry.name))
  : [];

if (stagingDirs.length === 0) {
  console.log('[clean] 暂存目录已是干净的，无需清理');
  process.exit(0);
}

/** 列出可能占着暂存目录的进程（多为上次调试时启动、没退干净的桌面端）。 */
function listRunningAppProcesses() {
  if (process.platform !== 'win32') return [];
  const found = [];
  for (const image of ['MonoTerminal.exe', 'electron.exe']) {
    try {
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 5000
      });
      if (out.includes(image)) found.push(image);
    } catch {
      // tasklist 不可用时忽略
    }
  }
  return found;
}

let failed = 0;
for (const dir of stagingDirs) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    console.log(`[clean] 已清理 ${path.relative(process.cwd(), dir)}`);
  } catch (err) {
    failed++;
    console.error(`[clean] 清理失败：${dir}`);
    console.error(`        原因：${err.code || ''} ${String(err.message).split('\n')[0]}`);
    const running = listRunningAppProcesses();
    if (running.length > 0) {
      console.error(`        ⚠️  检测到仍在运行的进程：${running.join('、')} —— 请先关闭它们再打包。`);
    }
    console.error(
      '        处理办法：1) 关闭正在运行/调试的 MonoTerminal（含任务管理器里的残留进程）；' +
        '2) 在杀毒软件（360/火绒/联想管家）中把本目录加入信任；' +
        '3) 关闭（或暂停）网盘类同步工具后重试；' +
        '4) 仍不行就重启电脑再打包。'
    );
  }
}

process.exit(failed ? 1 : 0);
