/**
 * 探针 4（复评版）：配置文件损坏后的行为链
 * 预期（修复后）：
 *  - 读侧标记 corrupted
 *  - saveXxx 拒绝保存并抛错（不再静默覆盖）
 *  - 正常保存走 tmp+rename 原子写并生成 .bak
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalStorageManager } from '../server/storage';

const lines: string[] = [];
lines.push('=== 配置损坏 → 拒绝保存 探针（复评） ===');

// --- 场景 1：hosts.json 损坏 ---
const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-probe1-'));
fs.writeFileSync(path.join(dir1, 'hosts.json'), '{ broken json !!!', 'utf8');
fs.writeFileSync(path.join(dir1, 'settings.json'), '{}', 'utf8');
const s1 = new LocalStorageManager(dir1);
const hosts1 = s1.getHosts();
lines.push(`场景1: hosts.json 损坏 → getHosts() 返回 ${hosts1.length} 条, isHostsCorrupted=${s1.isHostsCorrupted()}`);
let saveRejected = false;
try {
  s1.saveHosts([
    {
      id: 'new-host',
      name: '新主机',
      group: '默认',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
      createdAt: Date.now()
    }
  ]);
} catch (e) {
  saveRejected = true;
  lines.push(`场景1: saveHosts 抛错拒绝保存 ✓ (${(e as Error).message.slice(0, 50)}...)`);
}
if (!saveRejected) lines.push('场景1: saveHosts 未拒绝（问题仍存在）');
lines.push(`场景1: 损坏文件原内容是否保留: ${fs.readFileSync(path.join(dir1, 'hosts.json'), 'utf8').startsWith('{ broken') ? '是 ✓' : '否 ✗'}`);

// --- 场景 2：settings.json 损坏 ---
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-probe2-'));
fs.writeFileSync(path.join(dir2, 'hosts.json'), '[]', 'utf8');
fs.writeFileSync(path.join(dir2, 'settings.json'), 'not json at all', 'utf8');
const s2 = new LocalStorageManager(dir2);
const st2 = s2.getSettings();
lines.push(`场景2: settings.json 损坏 → isSettingsCorrupted=${s2.isSettingsCorrupted()}, providers=${st2.ai.providers.length}`);
let settingsRejected = false;
try {
  st2.terminal.fontSize = 16;
  s2.saveSettings(st2);
} catch {
  settingsRejected = true;
}
lines.push(`场景2: saveSettings ${settingsRejected ? '抛错拒绝保存 ✓' : '未拒绝（问题仍存在）'}`);
lines.push(`场景2: 损坏文件原内容是否保留: ${fs.readFileSync(path.join(dir2, 'settings.json'), 'utf8') === 'not json at all' ? '是 ✓' : '否 ✗'}`);

// --- 场景 3：正常保存的原子性与备份 ---
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-probe3-'));
const s3 = new LocalStorageManager(dir3);
const hostsA = s3.getHosts();
s3.saveHosts([...hostsA, {
  id: 'h1', name: 'H1', group: 'g', host: '1.1.1.1', port: 22,
  username: 'u', authType: 'password', createdAt: Date.now()
}]);
s3.saveHosts([...s3.getHosts(), {
  id: 'h2', name: 'H2', group: 'g', host: '2.2.2.2', port: 22,
  username: 'u', authType: 'password', createdAt: Date.now()
}]);
const bak = fs.readFileSync(path.join(dir3, 'hosts.json.bak'), 'utf8');
const final = JSON.parse(fs.readFileSync(path.join(dir3, 'hosts.json'), 'utf8'));
lines.push(`场景3: 第二次保存后 hosts.json=${final.length} 条, hosts.json.bak=${JSON.parse(bak).length} 条（bak 应为上一版）`);
const tmpLeftover = fs.readdirSync(dir3).filter(f => f.includes('.tmp'));
lines.push(`场景3: tmp 残留文件: ${tmpLeftover.length === 0 ? '无 ✓' : tmpLeftover.join(',')}`);

// --- 场景 4：合法 JSON 但形状错误（新边界：hosts.json 是对象而非数组） ---
const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-probe4-'));
fs.writeFileSync(path.join(dir4, 'hosts.json'), '{"not":"an array"}', 'utf8');
fs.writeFileSync(path.join(dir4, 'settings.json'), '{}', 'utf8');
const s4 = new LocalStorageManager(dir4);
const hosts4 = s4.getHosts();
lines.push(`场景4: hosts.json 为合法 JSON 对象 → getHosts()=${hosts4.length} 条, isHostsCorrupted=${s4.isHostsCorrupted()}（形状错误未标记 corrupted 则保存不被拒）`);

// 清理
for (const d of [dir1, dir2, dir3, dir4]) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

fs.writeFileSync(new URL('./out-storage.txt', import.meta.url), lines.join('\n'), 'utf8');
console.log('done');
