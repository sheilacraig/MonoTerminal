import { describe, it, expect } from 'vitest';
import { MockFileSystem, MockTerminalSession } from '../server/mockServer';

describe('MockFileSystem & MockTerminalSession', () => {
  it('should list directories correctly', () => {
    const fs = new MockFileSystem();
    const etcFiles = fs.list('/etc/nginx');

    expect(etcFiles.length).toBeGreaterThan(0);
    const conf = etcFiles.find(f => f.name === 'nginx.conf');
    expect(conf).toBeDefined();
    expect(conf?.isDirectory).toBe(false);
  });

  it('should read and write files in virtual filesystem', () => {
    const fs = new MockFileSystem();
    const original = fs.readFile('/etc/nginx/nginx.conf');
    expect(original).toContain('worker_processes');

    // Write file
    fs.writeFile('/etc/nginx/test.conf', 'server { listen 8080; }');
    const readBack = fs.readFile('/etc/nginx/test.conf');
    expect(readBack).toBe('server { listen 8080; }');

    // Chmod
    fs.chmod('/etc/nginx/test.conf', '0777');
    const list = fs.list('/etc/nginx');
    const item = list.find(f => f.name === 'test.conf');
    expect(item?.permissions).toBe('0777');

    // Delete
    fs.delete('/etc/nginx/test.conf');
    expect(() => fs.readFile('/etc/nginx/test.conf')).toThrow();
  });

  it('should handle terminal session commands and error outputs', () => {
    const fs = new MockFileSystem();
    const term = new MockTerminalSession('test-term-1', fs);

    let output = '';
    term.on('data', chunk => {
      output += chunk;
    });

    term.init();
    expect(output).toContain('MonoTerminal');
    expect(output).toContain('root@prod-web01');

    output = '';
    // Run pwd
    term.write('pwd\r');
    expect(output).toContain('/etc/nginx');

    output = '';
    // Run systemctl status nginx to trigger error
    term.write('systemctl status nginx\r');
    expect(output).toContain('Address already in use');
    expect(output).toContain('failed');
  });
});
