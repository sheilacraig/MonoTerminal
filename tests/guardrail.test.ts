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
      'cat /dev/null > /etc/passwd'
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
});
