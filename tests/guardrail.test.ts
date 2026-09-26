import { describe, it, expect } from 'vitest';
import { checkCommandSafety } from '../server/guardrail';

describe('Guardrail Security Engine', () => {
  it('should intercept critical destructive commands', () => {
    const dangerousCommands = [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf ~',
      'rm -rf $HOME',
      'rm -r /',
      'mkfs.ext4 /dev/sdb1',
      'mkfs /dev/sda',
      'dd if=/dev/zero of=/dev/sda',
      'dd if=/dev/urandom of=/dev/nvme0n1',
      '> /dev/sda',
      'chmod -R 777 /',
      'chmod -R 000 /',
      ':(){ :|:& };:',
      'iptables -F',
      'iptables --flush',
      'ufw reset',
      'cat /dev/null > /etc/passwd',
      'Remove-Item -Recurse -Force C:\\',
      'Remove-Item C:\\ -Recurse -Force',
      'ri -r -fo C:\\',
      'del /s /q C:\\*.*',
      'del /f /s C:\\*',
      'rd /s /q C:\\',
      'rmdir /s C:\\',
      'format C: /fs:ntfs',
      'format D:',
      'Stop-Computer -Force',
      'Restart-Computer -Force'
    ];

    for (const cmd of dangerousCommands) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Command should be flagged as dangerous: ${cmd}`).toBe(true);
      expect(['CRITICAL', 'HIGH']).toContain(result.level);
      expect(result.reason).toBeDefined();
    }
  });

  it('should allow normal, safe ops commands', () => {
    const safeCommands = [
      'ls -la /etc/nginx',
      'cat /var/log/nginx/error.log',
      'nginx -t',
      'systemctl status nginx',
      'systemctl reload nginx',
      'docker ps -a',
      'ss -tulpn',
      'lsof -i :80',
      'df -h',
      'free -m',
      'top -b -n 1',
      'rm -f /tmp/test.log',
      'chmod 0644 /var/www/index.html',
      'mkdir -p /home/deploy/new-folder'
    ];

    for (const cmd of safeCommands) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Command should be marked safe: ${cmd}`).toBe(false);
      expect(result.level).toBe('SAFE');
    }
  });

  // Regression: previous regex only matched contiguous `-rf` / `-fr` clusters
  // directly followed by a root-like path, so all of these slipped through.
  it('should catch rm root-delete bypasses via split flags, escalators and long options', () => {
    const bypassAttempts = [
      'rm -r -f /',
      'rm -f -r /',
      'rm -R -F /',
      'rm -rf --no-preserve-root /',
      'rm --recursive --force /',
      'rm --recursive -f /*',
      'sudo rm -r -f /',
      'sudo rm -rf /',
      'sudo -u root rm -r -f /',
      'rm -rvf ~',
      'rm -rf "$HOME"',
      'rm -rf /etc',
      'rm -rf /etc/*',
      'rm -rf /usr',
      'rm -rf /var',
      'rm -rf /home',
      'ls; rm -r -f /',
      'echo bye && sudo rm -rf /'
    ];

    for (const cmd of bypassAttempts) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Bypass should be flagged: ${cmd}`).toBe(true);
      expect(result.level).toBe('CRITICAL');
    }
  });

  it('should not flag legitimate cleanup that merely touches /tmp or nested paths', () => {
    const legitCleanup = [
      'rm -rf /tmp/*',
      'rm -rf /var/tmp/build-cache',
      'rm -rf /etc/nginx/conf.d/old-site.conf',
      'rm -rf /home/deploy/releases/2024-01',
      'rm -rf ./build',
      'rm -rf ../cache'
    ];

    for (const cmd of legitCleanup) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Should NOT be flagged: ${cmd}`).toBe(false);
    }
  });

  it('should intercept multi-line dangerous inputs (paste scenarios)', () => {
    const multiLineAttacks = [
      'echo hi\nrm -rf /',
      'ls -la\r\nmkfs.ext4 /dev/sda1',
      'ls\nsudo rm -rf /',
      'echo "status ok"\ndd if=/dev/zero of=/dev/sda'
    ];

    for (const cmd of multiLineAttacks) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Multi-line input should be flagged: ${JSON.stringify(cmd)}`).toBe(true);
      expect(result.level).toBe('CRITICAL');
    }
  });

  it('should intercept chmod root attacks with or without -R, and chown root', () => {
    const chmodAttacks = [
      'chmod 777 /',
      'chmod 000 /',
      'chmod -R 777 /',
      'chmod -R 777 /etc',
      'sudo chmod -R 777 /var',
      'chmod -R a+rwx /',
      'chown -R www-data /',
      'chown -R www-data /usr',
      'sudo chown -R user /opt'
    ];

    for (const cmd of chmodAttacks) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Command should be flagged: ${cmd}`).toBe(true);
      expect(['CRITICAL', 'HIGH']).toContain(result.level);
    }
  });

  it('should not false positive on non-destructive commands containing keyword patterns', () => {
    const benignCommands = [
      'mkfs.txt notes.md',
      'echo run mkfs.ext4 later',
      'cat /var/log/mkfs.log',
      'grep dd if=x of=/dev/sda docs',
      'chmod -R 755 /etc',
      'chmod 755 /',
      'chown www-data /var/www/index.html',
      'chown -R user /var/www'
    ];

    for (const cmd of benignCommands) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Command should NOT be flagged as dangerous: ${cmd}`).toBe(false);
    }
  });

  // Review-3 R3: separators inside quotes are string data, not command
  // boundaries — `echo "a;rm -rf /"` executes echo, never rm.
  it('should treat quoted separators as data, not command boundaries', () => {
    const quotedText = [
      'echo "a;rm -rf /"',
      'echo "never run: dd of=/dev/sda || mkfs.ext4 /dev/sdb"',
      "echo 'rm -rf / is dangerous'",
      'echo "rm -rf /" | grep rm',
      'echo "; rm -rf /' // unclosed quote: shell would not execute the rest either
    ];

    for (const cmd of quotedText) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Quoted text should NOT be flagged: ${JSON.stringify(cmd)}`).toBe(false);
    }
  });

  // Reverse boundary of the quote-aware splitter (R3): separators OUTSIDE
  // quotes must still split and catch the dangerous segment.
  it('should still catch dangerous segments when separators are unquoted', () => {
    const unquotedSeparators = [
      'echo "x" ; rm -rf /',
      'echo ok|rm -rf /',
      'echo ok||rm -rf /',
      'echo "a" && sudo rm -rf /',
      'echo "multi"\nrm -rf /'
    ];

    for (const cmd of unquotedSeparators) {
      const result = checkCommandSafety(cmd);
      expect(result.isDangerous, `Unquoted separator must still be flagged: ${JSON.stringify(cmd)}`).toBe(true);
      expect(result.level).toBe('CRITICAL');
    }
  });
});
