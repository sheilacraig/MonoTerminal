import { describe, it, expect } from 'vitest';
import { detectTerminalError } from '../src/utils/errorDetector';

describe('Terminal Error Detector', () => {
  it('should detect typical Linux and application errors', () => {
    const errorOutputs = [
      'nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)',
      'Job for nginx.service failed because the control process exited with error code.',
      'Active: failed (Result: exit-code)',
      'bash: /usr/local/bin/deploy.sh: Permission denied',
      'bash: mycmd: command not found',
      'Traceback (most recent call last):\n  File "app.py", line 4, in <module>\nImportError: No module named requests',
      'FATAL: connection to server at "10.0.0.2" failed: Connection refused',
      'SyntaxError: Unexpected token < in JSON at position 0'
    ];

    for (const out of errorOutputs) {
      const res = detectTerminalError(out);
      expect(res.hasError, `Should identify error in: ${out}`).toBe(true);
      expect(res.snippet).toBeDefined();
    }
  });

  it('should ignore regular non-error outputs', () => {
    const normalOutputs = [
      'root@prod-web01:/etc/nginx# ls -la\ntotal 64',
      'drwxr-xr-x 8 root root 4096 Apr 20 18:20 .',
      'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok',
      'nginx: configuration file /etc/nginx/nginx.conf test is successful',
      'PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.\n64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=14.2 ms'
    ];

    for (const out of normalOutputs) {
      const res = detectTerminalError(out);
      expect(res.hasError, `Should not flag normal output: ${out}`).toBe(false);
    }
  });
});
