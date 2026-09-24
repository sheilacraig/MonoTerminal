/**
 * 探针 1：guardrail 规则质量实证
 * 跑一批代表性命令，验证拦截/放行是否符合预期，重点验证多行粘贴漏判。
 */
import fs from 'fs';
import { checkCommandSafety } from '../shared/guardrail';

interface Case {
  cmd: string;
  expect: boolean; // 预期 isDangerous
  note: string;
}

const cases: Case[] = [
  { cmd: 'rm -rf /', expect: true, note: '经典根删除' },
  { cmd: 'rm -r -f /', expect: true, note: '分写 flags' },
  { cmd: 'rm -fr /', expect: true, note: '倒序 cluster' },
  { cmd: 'rm --recursive --force /', expect: true, note: '长选项' },
  { cmd: 'sudo rm -rf /', expect: true, note: 'sudo 前缀' },
  { cmd: 'sudo -u root rm -r -f /', expect: true, note: 'sudo -u root' },
  { cmd: 'rm -rf --no-preserve-root .', expect: true, note: 'no-preserve-root' },
  { cmd: 'rm -rf ~', expect: true, note: '家目录' },
  { cmd: 'rm -rf $HOME', expect: true, note: '$HOME' },
  { cmd: 'rm -rf /usr', expect: true, note: '系统目录' },
  { cmd: 'rm -rf /etc', expect: true, note: '系统目录' },
  { cmd: 'rm -rf /etc/nginx', expect: false, note: '设计放行：非整目录' },
  { cmd: 'rm -rf /tmp/*', expect: false, note: '设计放行：tmp' },
  { cmd: 'echo hi\nrm -rf /', expect: true, note: '多行：第二行危险（验证是否漏判）' },
  { cmd: 'ls -la\nmkfs.ext4 /dev/sda1', expect: true, note: '多行：第二行 mkfs' },
  { cmd: 'ls; rm -rf /', expect: true, note: '分号分隔' },
  { cmd: 'ls && rm -rf /', expect: true, note: '&& 分隔' },
  { cmd: 'mkfs.ext4 /dev/sda1', expect: true, note: 'mkfs' },
  { cmd: 'mkfs', expect: true, note: '裸 mkfs' },
  { cmd: 'dd if=/dev/zero of=/dev/sda', expect: true, note: 'dd 覆写磁盘' },
  { cmd: 'echo x > /dev/sda', expect: true, note: '重定向到磁盘' },
  { cmd: 'ls > /dev/null 2>&1', expect: false, note: '正常用法（查误报）' },
  { cmd: 'echo a > result.txt', expect: false, note: '正常重定向（查误报）' },
  { cmd: 'chmod -R 777 /', expect: true, note: 'chmod 根' },
  { cmd: 'chmod -R 777 /etc', expect: true, note: 'chmod /etc（验证规则是否只匹配 / 和 /*）' },
  { cmd: 'chown -R www-data /', expect: true, note: 'chown 根' },
  { cmd: 'echo "mkfs.ext4 is scary"', expect: false, note: '引号内文本（查误报）' },
  { cmd: 'grep mkfs manual.txt', expect: false, note: '参数中含关键词（查误报）' },
  { cmd: ':(){:|:&};:', expect: true, note: 'fork 炸弹' },
  { cmd: 'iptables -F', expect: true, note: '清空防火墙' },
  { cmd: 'ufw disable', expect: true, note: '关 UFW' },
  { cmd: 'fdisk /dev/sda', expect: true, note: '改分区表' },
  { cmd: 'echo root > /etc/passwd', expect: true, note: '覆盖认证文件' },
  { cmd: 'Remove-Item -Recurse -Force C:\\Windows', expect: true, note: 'PS 删根' },
  { cmd: 'del /s /q C:\\*', expect: true, note: 'CMD 删根' },
  { cmd: 'format C:', expect: true, note: '格式化' },
  { cmd: 'Restart-Computer -Force', expect: true, note: '强重启' },
  { cmd: 'docker ps', expect: false, note: '正常命令' },
  { cmd: 'nginx -t', expect: false, note: '正常命令' },
  { cmd: 'echo "a > b"', expect: false, note: '引号内重定向（查误报）' },
  // ---- 复评新增：修复后的反向边界 ----
  { cmd: 'sudo mkfs.ext4 /dev/sda1', expect: true, note: '结构化 mkfs 须仍认 sudo 前缀' },
  { cmd: 'ls\nsudo rm -rf /', expect: true, note: '多行第二行 sudo rm' },
  { cmd: 'chmod -R 777 /etc', expect: true, note: '上轮漏报：chmod 系统目录' },
  { cmd: 'sudo chmod -R 777 /var', expect: true, note: 'sudo chmod 系统目录' },
  { cmd: 'chmod -R 755 /etc', expect: false, note: '非危险 mode 应放行' },
  { cmd: 'chmod -R a+rwx /', expect: true, note: '符号 mode a+rwx' },
  { cmd: 'chmod 777 /', expect: true, note: '无 -R 时修改根目录权限同样拦截 (N4 修复)' },
  { cmd: 'chown -R www-data /usr', expect: true, note: 'chown 系统目录' },
  { cmd: 'sudo chown -R user /opt', expect: true, note: 'sudo chown 系统目录' },
  { cmd: 'chown www-data /var/www/index.html', expect: false, note: '非递归普通文件应放行' },
  { cmd: 'chown -R user /var/www', expect: false, note: '非关键目录递归应放行' },
  { cmd: 'mkfs.txt notes.md', expect: false, note: '非命令位置的关键词（查误报）' },
  { cmd: 'echo run mkfs.ext4 later', expect: false, note: '参数中关键词（查误报）' },
  { cmd: 'cat /var/log/mkfs.log', expect: false, note: '路径中关键词（查误报）' },
  { cmd: 'grep dd if=x of=/dev/sda docs', expect: false, note: 'grep 参数含 dd 模式（查误报）' }
];

const lines: string[] = [];
let mismatches = 0;
lines.push('=== guardrail 规则质量探针 ===');
for (const c of cases) {
  const r = checkCommandSafety(c.cmd);
  const ok = r.isDangerous === c.expect;
  if (!ok) mismatches++;
  lines.push(
    `${ok ? 'OK ' : 'MISMATCH'} expect=${c.expect ? 'DANGER' : 'SAFE  '} got=${r.isDangerous ? 'DANGER' : 'SAFE  '} rule=${r.matchedRule || '-'} cmd=${JSON.stringify(c.cmd)} | ${c.note}`
  );
}
lines.push(`--- total=${cases.length} mismatch=${mismatches} ---`);

// 额外实证：多行粘贴的完整行为链（复评：修复后应能拦）
lines.push('');
lines.push('=== 多行文本逐行拆解（粘贴场景，复评） ===');
const multiline = 'echo hi\nrm -rf /';
lines.push(`input = ${JSON.stringify(multiline)}`);
lines.push(`splitShellSegments 按换行分段? ${JSON.stringify(multiline.split(/[\r\n]+|&&|\|\||[;|]/))}`);
lines.push(`checkCommandSafety = ${JSON.stringify(checkCommandSafety(multiline))}`);

// 复评新增：onData 层 bracketed-paste 提取逻辑等价验证
lines.push('');
lines.push('=== bracketed paste 提取逻辑（复刻 TerminalView onData 分支） ===');
const pasted = '\x1b[200~rm -rf /\x1b[201~';
const extracted = pasted.startsWith('\x1b[200~') && pasted.endsWith('\x1b[201~')
  ? pasted.slice(6, -6)
  : null;
lines.push(`粘贴帧 ${JSON.stringify(pasted)} → 提取内容 ${JSON.stringify(extracted)} → 判定 ${JSON.stringify(checkCommandSafety(extracted || ''))}`);
const safePaste = '\x1b[200~nginx -t\x1b[201~';
const safeExtracted = safePaste.slice(6, -6);
lines.push(`粘贴帧 ${JSON.stringify(safePaste)} → 判定 ${JSON.stringify(checkCommandSafety(safeExtracted))}`);
// 非粘贴的按键流（<5 字符）不应触发检查分支
lines.push(`按键流 'mkfs' (len=4, <5) 是否进入检查分支: ${'mkfs'.length >= 5}`);

fs.writeFileSync(new URL('./out-guardrail.txt', import.meta.url), lines.join('\n'), 'utf8');
console.log('done, mismatch=' + mismatches);
