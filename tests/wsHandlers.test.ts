import { describe, it, expect, vi } from 'vitest';
import EventEmitter from 'events';
import type { WsOutboundMessage, WsInboundMessage } from '../shared/wsProtocol';
import type { StreamCallbacks } from '../server/aiService';
import type { WsConnection, WsDependencies, MockSessionEntry } from '../server/ws/types';
import { dispatchWsMessage } from '../server/ws/handlers';
import { handlePing } from '../server/ws/handlers/ping';
import {
  handleTermInit,
  handleTermInput,
  handleTermResize,
  handleTermClose
} from '../server/ws/handlers/terminal';
import { handleSftpList, handleSftpWrite, handleSftpMkdir } from '../server/ws/handlers/sftp';
import { handleAiChat } from '../server/ws/handlers/ai';

function makeConn() {
  const sent: WsOutboundMessage[] = [];
  const conn: WsConnection = {
    clientSessions: new Set<string>(),
    send: (m: WsOutboundMessage) => sent.push(m)
  };
  return { conn, sent };
}

function makeDeps() {
  const term = {
    write: vi.fn(),
    resize: vi.fn(),
    init: vi.fn(),
    on: vi.fn(),
    getCurrentDir: vi.fn(() => '/etc/nginx')
  };
  const fs = {
    list: vi.fn(() => [{ name: 'nginx.conf', isDirectory: false }] as unknown[]),
    readFile: vi.fn(() => 'content'),
    writeFile: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    mkdir: vi.fn()
  };
  const sshManager = {
    createSession: vi.fn(async () => ({ events: new EventEmitter() })),
    writeToShell: vi.fn(() => true),
    resize: vi.fn(),
    closeSession: vi.fn(),
    sftpList: vi.fn(async () => [] as unknown[]),
    sftpReadFile: vi.fn(async () => 'content'),
    sftpWriteFile: vi.fn(async () => undefined),
    sftpDelete: vi.fn(async () => undefined),
    sftpRename: vi.fn(async () => undefined),
    sftpChmod: vi.fn(async () => undefined),
    sftpMkdir: vi.fn(async () => undefined)
  };
  const storage = {
    getHosts: vi.fn(() => [] as unknown[]),
    isLocked: vi.fn(() => false),
    decrypt: vi.fn((s: string) => s)
  };
  const aiService = { streamChat: vi.fn() };
  const mockSessions = new Map<string, MockSessionEntry>();
  const demoHost = {
    id: 'mock-local-demo',
    name: 'Demo Linux',
    group: '演示',
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    authType: 'mock',
    initialDir: '/etc/nginx',
    createdAt: 0
  };

  const deps = {
    aiService,
    sshManager,
    storage,
    mockSessions,
    demoHost,
    createMockSession: vi.fn(() => ({ term, fs }))
  } as unknown as WsDependencies;

  return { deps, term, fs, sshManager, storage, aiService, mockSessions };
}

const realHost = {
  id: 'h1',
  name: 'Real',
  group: 'g',
  host: '1.2.3.4',
  port: 22,
  username: 'root',
  authType: 'password',
  passwordEncrypted: 'enc',
  createdAt: 0
};

describe('ws handlers · ping', () => {
  it('replies with pong echoing clientTime', () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    handlePing({ type: 'ping', timestamp: 1234 }, conn, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'pong', clientTime: 1234 });
    expect((sent[0] as { serverTime: number }).serverTime).toBeTypeOf('number');
  });
});

describe('ws handlers · terminal', () => {
  it('term:input routes to the mock terminal when the session is mock', () => {
    const { conn } = makeConn();
    const { deps, term, fs, sshManager, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    handleTermInput({ type: 'term:input', sessionId: 's1', data: 'ls\r' }, conn, deps);
    expect(term.write).toHaveBeenCalledWith('ls\r');
    expect(sshManager.writeToShell).not.toHaveBeenCalled();
  });

  it('term:input falls back to sshManager for real sessions', () => {
    const { conn } = makeConn();
    const { deps, sshManager } = makeDeps();
    handleTermInput({ type: 'term:input', sessionId: 'real', data: 'pwd\r' }, conn, deps);
    expect(sshManager.writeToShell).toHaveBeenCalledWith('real', 'pwd\r');
  });

  it('term:resize routes to mock or ssh', () => {
    const { conn } = makeConn();
    const { deps, term, fs, sshManager, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    handleTermResize({ type: 'term:resize', sessionId: 's1', cols: 100, rows: 30 }, conn, deps);
    expect(term.resize).toHaveBeenCalledWith(100, 30);
    handleTermResize({ type: 'term:resize', sessionId: 'real', cols: 80, rows: 24 }, conn, deps);
    expect(sshManager.resize).toHaveBeenCalledWith('real', 80, 24);
  });

  it('term:close cleans mock session, ssh session and the client set', () => {
    const { conn } = makeConn();
    const { deps, term, fs, sshManager, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    conn.clientSessions.add('s1');
    handleTermClose({ type: 'term:close', sessionId: 's1' }, conn, deps);
    expect(mockSessions.has('s1')).toBe(false);
    expect(sshManager.closeSession).toHaveBeenCalledWith('s1');
    expect(conn.clientSessions.has('s1')).toBe(false);
  });

  it('term:init mock path creates a session and sends term:ready', async () => {
    const { conn, sent } = makeConn();
    const { deps, term, mockSessions } = makeDeps();
    await handleTermInit(
      { type: 'term:init', sessionId: 's1', hostId: 'unknown', cols: 80, rows: 24 },
      conn,
      deps
    );
    expect(mockSessions.has('s1')).toBe(true);
    expect(term.init).toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: 'term:ready',
      sessionId: 's1',
      hostName: 'Demo Linux',
      cwd: '/etc/nginx'
    });
  });

  it('term:init refuses real SSH while the store is locked', async () => {
    const { conn, sent } = makeConn();
    const { deps, storage, sshManager } = makeDeps();
    storage.getHosts.mockReturnValue([realHost]);
    storage.isLocked.mockReturnValue(true);
    await handleTermInit(
      { type: 'term:init', sessionId: 's2', hostId: 'h1', cols: 80, rows: 24 },
      conn,
      deps
    );
    expect(sshManager.createSession).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'term:error', sessionId: 's2' });
    expect((sent[0] as { message: string }).message).toContain('锁定');
  });

  it('term:init real SSH path connects and sends term:ready', async () => {
    const { conn, sent } = makeConn();
    const { deps, storage, sshManager } = makeDeps();
    storage.getHosts.mockReturnValue([realHost]);
    await handleTermInit(
      { type: 'term:init', sessionId: 's3', hostId: 'h1', cols: 80, rows: 24 },
      conn,
      deps
    );
    expect(sshManager.createSession).toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: 'term:ready',
      sessionId: 's3',
      hostName: 'Real',
      cwd: '/root'
    });
  });
});

describe('ws handlers · sftp', () => {
  it('sftp:list uses the mock fs when the session is mock', async () => {
    const { conn, sent } = makeConn();
    const { deps, term, fs, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    await handleSftpList(
      { type: 'sftp:list', requestId: 'r1', sessionId: 's1', dirPath: '/etc/nginx' },
      conn,
      deps
    );
    expect(fs.list).toHaveBeenCalledWith('/etc/nginx');
    expect(sent[0]).toMatchObject({ type: 'sftp:response', requestId: 'r1', success: true });
  });

  it('sftp:list returns an error response when ssh listing throws', async () => {
    const { conn, sent } = makeConn();
    const { deps, sshManager } = makeDeps();
    sshManager.sftpList.mockRejectedValue(new Error('boom'));
    await handleSftpList(
      { type: 'sftp:list', requestId: 'r2', sessionId: 'real', dirPath: '/x' },
      conn,
      deps
    );
    expect(sent[0]).toMatchObject({
      type: 'sftp:response',
      requestId: 'r2',
      success: false,
      error: 'boom'
    });
  });

  it('sftp:write uses the mock fs when the session is mock', async () => {
    const { conn, sent } = makeConn();
    const { deps, term, fs, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    await handleSftpWrite(
      { type: 'sftp:write', requestId: 'r4', sessionId: 's1', filePath: '/tmp/a', content: 'hi' },
      conn,
      deps
    );
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/a', 'hi');
    expect(sent[0]).toMatchObject({ type: 'sftp:response', requestId: 'r4', success: true });
  });

  it('sftp:mkdir delegates to sshManager for real sessions', async () => {
    const { conn, sent } = makeConn();
    const { deps, sshManager } = makeDeps();
    await handleSftpMkdir(
      { type: 'sftp:mkdir', requestId: 'r3', sessionId: 'real', dirPath: '/newdir' },
      conn,
      deps
    );
    expect(sshManager.sftpMkdir).toHaveBeenCalledWith('real', '/newdir');
    expect(sent[0]).toMatchObject({ type: 'sftp:response', requestId: 'r3', success: true });
  });
});

describe('ws handlers · ai:chat', () => {
  it('forwards streaming callbacks to outbound messages', async () => {
    const { conn, sent } = makeConn();
    const { deps, aiService } = makeDeps();
    aiService.streamChat.mockImplementation(
      async (_m: unknown, _c: unknown, cb: StreamCallbacks) => {
        cb.onThinking?.('t');
        cb.onContent?.('c');
        cb.onDone?.('full', 'think');
      }
    );
    await handleAiChat(
      { type: 'ai:chat', requestId: 'a1', messages: [{ role: 'user', content: 'hi' }] },
      conn,
      deps
    );
    expect(sent.map(m => m.type)).toEqual(['ai:thinking', 'ai:content', 'ai:done']);
    expect(sent[2]).toMatchObject({
      type: 'ai:done',
      requestId: 'a1',
      fullContent: 'full',
      fullThinking: 'think'
    });
  });

  it('forwards stream errors', async () => {
    const { conn, sent } = makeConn();
    const { deps, aiService } = makeDeps();
    aiService.streamChat.mockImplementation(
      async (_m: unknown, _c: unknown, cb: StreamCallbacks) => {
        cb.onError?.(new Error('nope'));
      }
    );
    await handleAiChat({ type: 'ai:chat', requestId: 'a2', messages: [] }, conn, deps);
    expect(sent[0]).toMatchObject({ type: 'ai:error', requestId: 'a2', error: 'nope' });
  });
});

describe('dispatchWsMessage', () => {
  it('routes a message to the matching handler', async () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    await dispatchWsMessage({ type: 'ping', timestamp: 99 }, conn, deps);
    expect(sent[0]).toMatchObject({ type: 'pong', clientTime: 99 });
  });

  it('ignores unknown message types without throwing', async () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await dispatchWsMessage({ type: 'totally:unknown' } as unknown as WsInboundMessage, conn, deps);
    expect(sent).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
