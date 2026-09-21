import { describe, it, expect } from 'vitest';
import { validateWsInboundMessage } from '../shared/wsProtocol';

describe('validateWsInboundMessage', () => {
  it('accepts well-formed messages of every type', () => {
    const valid: unknown[] = [
      { type: 'ping', timestamp: Date.now() },
      { type: 'term:init', sessionId: 'sess-abc_123', hostId: 'mock-local-demo', cols: 120, rows: 35 },
      { type: 'term:input', sessionId: 'sess-1', data: 'ls -la\r' },
      { type: 'term:resize', sessionId: 'sess-1', cols: 80, rows: 24 },
      { type: 'term:close', sessionId: 'sess-1' },
      { type: 'sftp:list', requestId: 'req-1', sessionId: 'sess-1', dirPath: '/etc/nginx' },
      { type: 'sftp:read', requestId: 'req-2', sessionId: 'sess-1', filePath: '/etc/nginx/nginx.conf' },
      { type: 'sftp:write', requestId: 'req-3', sessionId: 'sess-1', filePath: '/tmp/a.txt', content: 'hello' },
      { type: 'sftp:delete', requestId: 'req-4', sessionId: 'sess-1', targetPath: '/tmp/a.txt', isDirectory: false },
      { type: 'sftp:rename', requestId: 'req-5', sessionId: 'sess-1', oldPath: '/a', newPath: '/b' },
      { type: 'sftp:chmod', requestId: 'req-6', sessionId: 'sess-1', targetPath: '/a', mode: '0644' },
      { type: 'sftp:mkdir', requestId: 'req-7', sessionId: 'sess-1', dirPath: '/newdir' },
      {
        type: 'ai:chat',
        requestId: 'ai-1',
        messages: [
          { role: 'user', content: '为什么 nginx 起不来？' },
          { role: 'assistant', content: '先看日志' }
        ],
        opsContext: {
          terminalSnippet: 'nginx: [emerg] bind() failed',
          currentDir: '/etc/nginx',
          currentUser: 'root',
          osInfo: 'Ubuntu 22.04',
          commandHistory: ['systemctl status nginx']
        }
      }
    ];

    for (const m of valid) {
      const res = validateWsInboundMessage(m);
      const label = typeof m === 'object' && m !== null ? (m as { type?: string }).type : String(m);
      expect(res.ok, `should accept ${label}: ${JSON.stringify(res)}`).toBe(true);
    }
  });

  it('rejects malformed or hostile messages', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      'just-a-string',
      42,
      [],
      {}, // no type
      { type: 123 }, // non-string type
      { type: 'unknown:msg' }, // unknown type
      { type: 'ping' }, // missing timestamp
      { type: 'ping', timestamp: 'now' }, // wrong timestamp type
      { type: 'ping', timestamp: Number.NaN },
      { type: 'term:init', sessionId: 'a', hostId: 'b', cols: 0, rows: 10 }, // cols out of range
      { type: 'term:init', sessionId: 'a', hostId: 'b', cols: 1.5, rows: 10 }, // non-integer
      { type: 'term:init', sessionId: '../../etc', hostId: 'b', cols: 80, rows: 24 }, // path traversal chars in id
      { type: 'term:init', sessionId: 'x'.repeat(129), hostId: 'b', cols: 80, rows: 24 }, // id too long
      { type: 'term:init', hostId: 'b', cols: 80, rows: 24 }, // missing sessionId
      { type: 'term:input', sessionId: 's', data: 12345 }, // data not a string
      { type: 'term:input', sessionId: 's' }, // missing data
      { type: 'sftp:delete', requestId: 'r', sessionId: 's', targetPath: '/x' }, // missing isDirectory
      { type: 'sftp:delete', requestId: 'r', sessionId: 's', targetPath: '/x', isDirectory: 'yes' },
      { type: 'sftp:chmod', requestId: 'r', sessionId: 's', targetPath: '/x', mode: '9999' }, // invalid octal
      { type: 'sftp:chmod', requestId: 'r', sessionId: 's', targetPath: '/x', mode: 644 }, // non-string mode
      { type: 'ai:chat', requestId: 'r', messages: 'not-an-array' },
      { type: 'ai:chat', requestId: 'r' }, // missing messages
      { type: 'ai:chat', requestId: 'r', messages: [{ role: 'hacker', content: 'x' }] }, // bad role
      { type: 'ai:chat', requestId: 'r', messages: [{ role: 'user' }] }, // missing content
      { type: 'ai:chat', requestId: 'r', messages: [{ role: 'user', content: 'x' }, 'junk'] }
    ];

    for (const m of invalid) {
      const res = validateWsInboundMessage(m);
      expect(res.ok, `should reject: ${JSON.stringify(m)}`).toBe(false);
    }
  });

  it('strips unknown extra fields from rebuilt messages', () => {
    const res = validateWsInboundMessage({
      type: 'term:input',
      sessionId: 'sess-1',
      data: 'ls',
      evilExtra: 'DROP TABLE secrets',
      admin: true
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.msg).toEqual({ type: 'term:input', sessionId: 'sess-1', data: 'ls' });
      expect(Object.keys(res.msg)).toEqual(['type', 'sessionId', 'data']);
    }
  });

  it('sanitizes opsContext fields instead of rejecting the whole message', () => {
    const res = validateWsInboundMessage({
      type: 'ai:chat',
      requestId: 'ai-1',
      messages: [{ role: 'user', content: 'q' }],
      opsContext: {
        terminalSnippet: 'some output',
        bogusField: 'x',
        commandHistory: ['ls', 42, null, 'pwd']
      }
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.msg.type === 'ai:chat') {
      expect(res.msg.opsContext?.terminalSnippet).toBe('some output');
      expect((res.msg.opsContext as Record<string, unknown> | undefined)?.bogusField).toBeUndefined();
      // Non-string history entries are dropped, valid ones kept in order
      expect(res.msg.opsContext?.commandHistory).toEqual(['ls', 'pwd']);
    }
  });

  it('tolerates a completely invalid opsContext by dropping it', () => {
    const res = validateWsInboundMessage({
      type: 'ai:chat',
      requestId: 'ai-1',
      messages: [{ role: 'system', content: 's' }],
      opsContext: 'not-an-object'
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.msg.type === 'ai:chat') {
      expect(res.msg.opsContext).toBeUndefined();
    }
  });

  it('enforces size limits on payload strings', () => {
    const res = validateWsInboundMessage({
      type: 'term:input',
      sessionId: 'sess-1',
      data: 'x'.repeat(65_537) // > 64KB cap
    });
    expect(res.ok).toBe(false);
  });
});
