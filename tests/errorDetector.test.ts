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

  it('should classify kernel/OOM failures as critical', () => {
    const criticalOutputs = [
      'Out of memory: Killed process 1234 (java) total-vm:4096kB',
      'Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)',
      'BUG: unable to handle kernel NULL pointer dereference at 0000000000000010',
      'java.lang.OutOfMemoryError: Cannot allocate memory',
      'nginx: [emerg] still could not bind()',
      'FATAL: database system is shut down'
    ];

    for (const out of criticalOutputs) {
      const res = detectTerminalError(out);
      expect(res.hasError, `Should flag: ${out}`).toBe(true);
      expect(res.severity, `Should be critical: ${out}`).toBe('critical');
    }
  });

  it('should detect disk, TLS, DNS and network errors as error tier', () => {
    const errorOutputs = [
      'cp: write error: No space left on device',
      'touch: cannot touch /etc/x: Read-only file system',
      'blk_update_request: I/O error, dev sda, sector 2048',
      'curl: (60) SSL certificate problem: unable to get local issuer certificate',
      'openssl: Error: certificate verify failed',
      'ping: www.example.com: Temporary failure in name resolution',
      'ssh: connect to host 10.0.0.5 port 22: No route to host',
      'Failed to start nginx.service: Unit nginx.service not found.',
      'container exited with code 137',
      'Error response from daemon: No such image: foo:latest',
      'make: *** [Makefile:12: build] Error 2',
      'ModuleNotFoundError: No module named yaml'
    ];

    for (const out of errorOutputs) {
      const res = detectTerminalError(out);
      expect(res.hasError, `Should flag: ${out}`).toBe(true);
      expect(res.severity, `Should be error tier: ${out}`).toBe('error');
    }
  });

  it('should classify warnings as warning tier (hasError still true for compat)', () => {
    const warningOutputs = [
      'npm WARN deprecated inflight@1.0.4: This module is not supported',
      'DEPRECATION WARNING: Using `import` is deprecated',
      'mysqld: Error: Connection lost mid-query'
    ];

    for (const out of warningOutputs) {
      const res = detectTerminalError(out);
      expect(res.hasError, `Should flag: ${out}`).toBe(true);
      expect(res.severity, `Should be warning tier: ${out}`).toBe('warning');
    }
  });

  it('should prefer the highest severity tier when a chunk mixes levels', () => {
    const mixed =
      'npm WARN deprecated something\nsystemd[1]: Out of memory: Killed process 999 (node)\nbash: foo: command not found';
    const res = detectTerminalError(mixed);
    expect(res.hasError).toBe(true);
    expect(res.severity).toBe('critical');
    expect(res.snippet).toContain('Out of memory');
  });

  it('should strip ANSI escape codes before matching', () => {
    const colored = '\x1b[31mnginx: [emerg] bind() to 0.0.0.0:80 failed\x1b[0m';
    const res = detectTerminalError(colored);
    expect(res.hasError).toBe(true);
    expect(res.severity).toBe('critical');
    expect(res.snippet).not.toContain('\x1b');
  });
});
