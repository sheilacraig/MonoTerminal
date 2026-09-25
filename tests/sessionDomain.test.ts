import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { WsOutboundMessage } from '../shared/wsProtocol';
import { createDefaultSessionManager } from '../server/ws/wsRouter';
import { LocalFsManager, isProtectedLocalDeletePath } from '../server/localFsManager';
import type { LocalPtyManager } from '../server/localPtyManager';
import type { SshManager } from '../server/sshManager';
import type { MockSessionEntry } from '../server/ws/types';
import { handleSftpList } from '../server/ws/handlers/sftp';
import { handleTermResize } from '../server/ws/handlers/terminal';

const localHost = {
  id: 'local-shell',
  name: 'Local Shell',
  group: '本地',
  host: 'localhost',
  port: 0,
  username: 'local',
  authType: 'local' as const,
  initialDir: 'C:\\Users\\test',
  createdAt: 0
};

const sshHost = {
  id: 'ssh-1',
  name: 'Prod Web',
  group: '生产',
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  authType: 'password' as const,
  initialDir: '/var/www',
  createdAt: 0
};

const mockHost = {
  id: 'mock-1',
  name: 'Sandbox',
  group: '演示',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'mock' as const,
  initialDir: '/etc/nginx',
  createdAt: 0
};

function createHarness(detachGracePeriodMs = 60_000) {
  const ptyEvents = new EventEmitter();
  const sshEvents = new EventEmitter();
  const mockTerm = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    resize: vi.fn(),
    init: vi.fn(),
    getCurrentDir: vi.fn(() => '/etc/nginx')
  });
  const mockFs = {
    list: vi.fn(() => []),
    readFile: vi.fn(() => 'mock-content'),
    writeFile: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    mkdir: vi.fn()
  };

  const localPtySession = {
    pty: { write: vi.fn(), resize: vi.fn(), kill: vi.fn() },
    events: ptyEvents,
    initialCwd: 'C:\\Users\\test',
    shellCommand: 'pwsh.exe'
  };

  const localPtyManager = {
    createSession: vi.fn(() => localPtySession),
    getSession: vi.fn(() => localPtySession),
    has: vi.fn(() => true),
    write: vi.fn(),
    resize: vi.fn(),
    closeSession: vi.fn()
  };

  const localFsManager = {
    list: vi.fn(() => []),
    readFile: vi.fn(() => 'local-content'),
    writeFile: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    mkdir: vi.fn()
  };

  const sshManager = {
    createSession: vi.fn(async () => ({ events: sshEvents })),
    writeToShell: vi.fn(() => true),
    resize: vi.fn(),
    closeSession: vi.fn(),
    sftpList: vi.fn(async () => []),
    sftpReadFile: vi.fn(async () => 'ssh-content'),
    sftpWriteFile: vi.fn(async () => undefined),
    sftpDelete: vi.fn(async () => undefined),
    sftpRename: vi.fn(async () => undefined),
    sftpChmod: vi.fn(async () => undefined),
    sftpMkdir: vi.fn(async () => undefined)
  };

  const mockSessions = new Map<string, MockSessionEntry>();
  const createMockSession = vi.fn(
    () => ({ term: mockTerm, fs: mockFs }) as unknown as MockSessionEntry
  );

  const sessionManager = createDefaultSessionManager({
    localPtyManager: localPtyManager as unknown as LocalPtyManager,
    localFsManager: localFsManager as unknown as LocalFsManager,
    sshManager: sshManager as unknown as SshManager,
    mockSessions,
    createMockSession,
    detachGracePeriodMs
  });

  return {
    sessionManager,
    ptyEvents,
    sshEvents,
    mockTerm,
    mockFs,
    localPtyManager,
    localFsManager,
    sshManager,
    mockSessions
  };
}

describe('Phase 1-3 · SessionManager, TerminalProvider & FileSystemProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('P0-C: attaching and detaching a session 5 times consecutively triggers data callback only once', async () => {
    const { sessionManager, ptyEvents } = createHarness();
    await sessionManager.getOrCreate({
      id: 'sid-1',
      host: localHost,
      cols: 120,
      rows: 35
    });

    const staleReceived: WsOutboundMessage[] = [];
    for (let i = 0; i < 5; i++) {
      const connId = `conn-${i}`;
      sessionManager.attach('sid-1', connId, msg => staleReceived.push(msg));
      sessionManager.detach('sid-1', connId);
    }

    const activeReceived: WsOutboundMessage[] = [];
    sessionManager.attach('sid-1', 'conn-final', msg => activeReceived.push(msg));

    // Emit a single chunk from the underlying PTY
    ptyEvents.emit('data', 'hello world\r\n');

    expect(staleReceived).toHaveLength(0);
    expect(activeReceived).toHaveLength(1);
    expect(activeReceived[0]).toEqual({
      type: 'term:data',
      sessionId: 'sid-1',
      data: 'hello world\r\n'
    });
    expect(ptyEvents.listenerCount('data')).toBe(1);
  });

  it('P2-J: detached session is garbage-collected after detachGracePeriodMs unless re-attached', async () => {
    const { sessionManager, localPtyManager } = createHarness(5_000);
    await sessionManager.getOrCreate({
      id: 'sid-gc',
      host: localHost,
      cols: 80,
      rows: 24
    });

    sessionManager.attach('sid-gc', 'c1', () => {});
    sessionManager.detach('sid-gc', 'c1');
    expect(sessionManager.get('sid-gc')?.status).toBe('detached');

    // Re-attach before grace period expires -> cancels GC timer
    vi.advanceTimersByTime(3_000);
    sessionManager.attach('sid-gc', 'c2', () => {});
    expect(sessionManager.get('sid-gc')?.status).toBe('active');

    vi.advanceTimersByTime(5_000);
    expect(sessionManager.get('sid-gc')).toBeDefined();
    expect(localPtyManager.closeSession).not.toHaveBeenCalled();

    // Detach again and let full grace period expire -> auto-closes session
    sessionManager.detach('sid-gc', 'c2');
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(sessionManager.get('sid-gc')).toBeUndefined();
    expect(localPtyManager.closeSession).toHaveBeenCalledWith('sid-gc');
  });

  it('P0-4: SshTerminalProvider forwards error events as term:error and returns write boolean', async () => {
    const { sessionManager, sshEvents, sshManager } = createHarness();
    await sessionManager.create({
      id: 'ssh-s1',
      host: sshHost,
      cols: 100,
      rows: 30
    });

    const received: WsOutboundMessage[] = [];
    sessionManager.attach('ssh-s1', 'conn-ssh', msg => received.push(msg));

    sshEvents.emit('error', new Error('Channel open failure'));

    expect(received).toEqual([
      {
        type: 'term:error',
        sessionId: 'ssh-s1',
        message: 'Channel open failure'
      }
    ]);
    expect(sessionManager.get('ssh-s1')?.status).toBe('error');

    sshManager.writeToShell.mockReturnValueOnce(false);
    expect(sessionManager.writeTerminal('ssh-s1', 'ls\n')).toBe(false);
  });

  it('P1-4: getOrCreate reuses an active or detached mock session without calling init() twice', async () => {
    const { sessionManager, mockTerm } = createHarness();
    await sessionManager.getOrCreate({ id: 'mock-s1', host: mockHost, cols: 80, rows: 24 });
    await sessionManager.getOrCreate({ id: 'mock-s1', host: mockHost, cols: 100, rows: 40 });

    expect(mockTerm.init).toHaveBeenCalledTimes(1);
    expect(mockTerm.resize).toHaveBeenLastCalledWith(100, 40);
  });

  it('P0-5: unknown sessionId in terminal resize and sftp list returns error without calling sshManager', async () => {
    const { sessionManager, sshManager } = createHarness();
    const sent: WsOutboundMessage[] = [];
    const conn = {
      connectionId: 'c1',
      clientSessions: new Set<string>(),
      send: (msg: WsOutboundMessage) => sent.push(msg)
    };
    const deps = { sessionManager, sshManager } as unknown as Parameters<typeof handleSftpList>[2];

    handleTermResize({ type: 'term:resize', sessionId: 'no-such-sid', cols: 80, rows: 24 }, conn, deps);
    await handleSftpList(
      { type: 'sftp:list', requestId: 'req-1', sessionId: 'no-such-sid', dirPath: '/root' },
      conn,
      deps
    );

    expect(sshManager.resize).not.toHaveBeenCalled();
    expect(sshManager.sftpList).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'term:error', sessionId: 'no-such-sid' });
    expect(sent[1]).toMatchObject({
      type: 'sftp:response',
      requestId: 'req-1',
      success: false
    });
  });
});

describe('Phase 3 · LocalFsManager.delete protection & isDirectory validation (P0-1 / P2-I)', () => {
  it('blocks deleting root, critical OS dirs, exact homedir, and ~/.ssh, while allowing normal home subdirs', () => {
    expect(isProtectedLocalDeletePath('/').blocked).toBe(true);
    expect(isProtectedLocalDeletePath('/etc').blocked).toBe(true);
    expect(isProtectedLocalDeletePath('C:\\').blocked).toBe(true);
    expect(isProtectedLocalDeletePath('C:\\Windows').blocked).toBe(true);
    expect(isProtectedLocalDeletePath('~').blocked).toBe(true);
    expect(isProtectedLocalDeletePath(os.homedir()).blocked).toBe(true);
    expect(isProtectedLocalDeletePath('~/.ssh').blocked).toBe(true);
    expect(isProtectedLocalDeletePath('~/.gnupg').blocked).toBe(true);

    // Normal business directory inside home is allowed
    expect(isProtectedLocalDeletePath('~/my-old-project').blocked).toBe(false);
    expect(isProtectedLocalDeletePath(path.join(os.homedir(), 'workspace-temp')).blocked).toBe(
      false
    );
  });

  it('enforces isDirectory consistency and safely deletes a real temp file and temp directory', () => {
    const fsManager = new LocalFsManager();
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'monoterm-fs-test-'));
    const filePath = path.join(tmpBase, 'sample.txt');
    const subDir = path.join(tmpBase, 'subdir');

    try {
      fsManager.writeFile(filePath, 'hello utf8');
      fsManager.mkdir(subDir);

      // Mismatched isDirectory flags must throw and leave the targets intact
      expect(() => fsManager.delete(filePath, true)).toThrow(/文件而非目录/);
      expect(() => fsManager.delete(subDir, false)).toThrow(/目录而非文件/);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(subDir)).toBe(true);

      // Matching flags succeed
      fsManager.delete(filePath, false);
      fsManager.delete(subDir, true);
      expect(fs.existsSync(filePath)).toBe(false);
      expect(fs.existsSync(subDir)).toBe(false);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
