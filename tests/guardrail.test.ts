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
});
