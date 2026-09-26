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
import {
  handleAgentRun,
  handleAgentConfirmPlan,
  handleAgentSkip
} from '../server/ws/handlers/agent';

import { createDefaultSessionManager } from '../server/ws/wsRouter';
import type { LocalPtyManager } from '../server/localPtyManager';
import type { LocalFsManager } from '../server/localFsManager';
import type { SshManager } from '../server/sshManager';

function makeConn(connectionId = 'test-conn-1') {
  const sent: WsOutboundMessage[] = [];
  const conn: WsConnection = {
    connectionId,
    clientSessions: new Set<string>(),
    send: (m: WsOutboundMessage) => sent.push(m)
  };
  return { conn, sent };
}

const realHost = {
  id: 'h1',
  name: 'Real',
  group: 'g',
  host: '1.2.3.4',
  port: 22,
  username: 'root',
  authType: 'password' as const,
  passwordEncrypted: 'enc',
  createdAt: 0
};

const localHost = {
  id: 'local-shell',
  name: '本机终端 (Local Shell)',
  group: '本地',
  host: 'localhost',
  port: 0,
  username: 'local',
  authType: 'local' as const,
  initialDir: 'C:\\Users\\test',
  createdAt: 0
};

const mockHost = {
  id: 'mock-local-demo',
  name: 'Demo Linux',
  group: '演示',
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  authType: 'mock' as const,
  initialDir: '/etc/nginx',
  createdAt: 0
};

function makeDeps() {
  const term = {
    write: vi.fn(),
    resize: vi.fn(),
    init: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
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
    decrypt: vi.fn((s: string) => s),
    // UX round-1 ①: handleAgentRun reads the plan-confirmation setting
    getSettings: vi.fn(() => ({ agent: { requirePlanConfirmation: true } }))
  };
  const aiService = { streamChat: vi.fn() };
  const mockSessions = new Map<string, MockSessionEntry>();
  const demoHost = {
    id: 'local-shell',
    name: '本机终端 (Local Shell)',
    group: '本地',
    host: 'localhost',
    port: 0,
    username: 'local',
    authType: 'local' as const,
    initialDir: '~',
    createdAt: 0
  };
  const localPtySession = {
    pty: { write: vi.fn(), resize: vi.fn(), kill: vi.fn() },
    events: new EventEmitter(),
    initialCwd: 'C:\\Users\\test',
    shellCommand: 'pwsh.exe'
  };
  const localPtyManager = {
    createSession: vi.fn(() => localPtySession),
    getSession: vi.fn(() => localPtySession),
    has: vi.fn((sid: string) => sid === 'local-s1'),
    write: vi.fn(),
    resize: vi.fn(),
    closeSession: vi.fn()
  };
  const localFsManager = {
    list: vi.fn(() => [{ name: 'file.txt', isDirectory: false }] as unknown[]),
    readFile: vi.fn(() => 'content'),
    writeFile: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    mkdir: vi.fn()
  };

  const createMockSession = vi.fn(() => ({ term, fs }) as unknown as MockSessionEntry);

  const sessionManager = createDefaultSessionManager({
    localPtyManager: localPtyManager as unknown as LocalPtyManager,
    localFsManager: localFsManager as unknown as LocalFsManager,
    sshManager: sshManager as unknown as SshManager,
    mockSessions,
    createMockSession
  });

  // Pre-seed 'local-s1' and 'real' for direct handler unit tests that skip term:init,
  // and intercept mockSessions.set('s1', ...) to register the mock session in sessionManager
  void sessionManager.create({ id: 'local-s1', host: localHost, cols: 80, rows: 24 });
  void sessionManager.create({ id: 'real', host: realHost, cols: 80, rows: 24 });
  localPtyManager.createSession.mockClear();
  sshManager.createSession.mockClear();
  sshManager.resize.mockClear();

  const origMockSet = mockSessions.set.bind(mockSessions);
  mockSessions.set = (key: string, value: MockSessionEntry) => {
    const res = origMockSet(key, value);
    if (!sessionManager.get(key)) {
      void sessionManager.create({ id: key, host: mockHost, cols: 80, rows: 24 });
    }
    return res;
  };

  const deps = {
    aiService,
    sshManager,
    storage,
    mockSessions,
    demoHost,
    createMockSession,
    localPtyManager,
    localFsManager,
    sessionManager
  } as unknown as WsDependencies;

  return {
    deps,
    term,
    fs,
    sshManager,
    storage,
    aiService,
    mockSessions,
    localPtyManager,
    localFsManager,
    localPtySession,
    sessionManager
  };
}

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

  it('term:input routes to sshManager for registered ssh sessions', () => {
    const { conn } = makeConn();
    const { deps, sshManager } = makeDeps();
    handleTermInput({ type: 'term:input', sessionId: 'real', data: 'pwd\r' }, conn, deps);
    expect(sshManager.writeToShell).toHaveBeenCalledWith('real', 'pwd\r');
  });

  it('term:input rejects unknown sessionId with term:error instead of falling back to sshManager', () => {
    const { conn, sent } = makeConn();
    const { deps, sshManager } = makeDeps();
    handleTermInput({ type: 'term:input', sessionId: 'unknown-sid', data: 'pwd\r' }, conn, deps);
    expect(sshManager.writeToShell).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: 'term:error',
      sessionId: 'unknown-sid'
    });
  });

  it('term:input routes to the local pty when the session is local', () => {
    const { conn } = makeConn();
    const { deps, localPtyManager, sshManager } = makeDeps();
    handleTermInput({ type: 'term:input', sessionId: 'local-s1', data: 'dir\r' }, conn, deps);
    expect(localPtyManager.write).toHaveBeenCalledWith('local-s1', 'dir\r');
    expect(sshManager.writeToShell).not.toHaveBeenCalled();
  });

  it('term:resize routes to the local pty when the session is local', () => {
    const { conn } = makeConn();
    const { deps, localPtyManager, sshManager } = makeDeps();
    handleTermResize(
      { type: 'term:resize', sessionId: 'local-s1', cols: 100, rows: 30 },
      conn,
      deps
    );
    expect(localPtyManager.resize).toHaveBeenCalledWith('local-s1', 100, 30);
    expect(sshManager.resize).not.toHaveBeenCalled();
  });

  it('term:close releases the local pty session', async () => {
    const { conn } = makeConn();
    const { deps, localPtyManager } = makeDeps();
    conn.clientSessions.add('local-s1');
    await handleTermClose({ type: 'term:close', sessionId: 'local-s1' }, conn, deps);
    expect(localPtyManager.closeSession).toHaveBeenCalledWith('local-s1');
    expect(conn.clientSessions.has('local-s1')).toBe(false);
  });

  // Review-3 R6: closing a tab must cancel pending approvals instead of
  // letting an agent plan hang on the 5-minute approval timeout.
  it('term:close cancels pending approvals for the session', async () => {
    const { conn } = makeConn();
    const { deps, localPtyManager } = makeDeps();
    const cancelSessionApprovals = vi.fn();
    deps.approvalManager = { cancelSessionApprovals } as unknown as WsDependencies['approvalManager'];
    await handleTermClose({ type: 'term:close', sessionId: 'local-s1' }, conn, deps);
    expect(cancelSessionApprovals).toHaveBeenCalledWith('local-s1');
    expect(localPtyManager.closeSession).toHaveBeenCalledWith('local-s1');
  });

  it('term:resize routes to mock or ssh', () => {
    const { conn } = makeConn();
    const { deps, term, fs, sshManager, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    term.resize.mockClear();
    handleTermResize({ type: 'term:resize', sessionId: 's1', cols: 100, rows: 30 }, conn, deps);
    expect(term.resize).toHaveBeenCalledWith(100, 30);
    handleTermResize({ type: 'term:resize', sessionId: 'real', cols: 80, rows: 24 }, conn, deps);
    expect(sshManager.resize).toHaveBeenCalledWith('real', 80, 24);
  });

  it('term:close cleans mock session and the client set', async () => {
    const { conn } = makeConn();
    const { deps, term, fs, mockSessions } = makeDeps();
    mockSessions.set('s1', { term, fs } as unknown as MockSessionEntry);
    conn.clientSessions.add('s1');
    await handleTermClose({ type: 'term:close', sessionId: 's1' }, conn, deps);
    expect(mockSessions.has('s1')).toBe(false);
    expect(conn.clientSessions.has('s1')).toBe(false);
  });

  it('term:init mock path creates a session and sends term:ready', async () => {
    const { conn, sent } = makeConn();
    const { deps, term, mockSessions, storage } = makeDeps();
    storage.getHosts.mockReturnValue([
      {
        id: 'mock-local-demo',
        name: 'Demo Linux',
        group: '演示',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      }
    ]);
    await handleTermInit(
      { type: 'term:init', sessionId: 's1', hostId: 'mock-local-demo', cols: 80, rows: 24 },
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

  it('term:init local path creates a pty and sends term:ready', async () => {
    const { conn, sent } = makeConn();
    const { deps, storage, localPtyManager, localPtySession } = makeDeps();
    storage.getHosts.mockReturnValue([localHost]);
    await handleTermInit(
      { type: 'term:init', sessionId: 'local-s1', hostId: 'local-shell', cols: 80, rows: 24 },
      conn,
      deps
    );
    expect(localPtyManager.createSession).toHaveBeenCalledWith(
      'local-s1',
      80,
      24,
      'C:\\Users\\test'
    );
    expect(sent[0]).toMatchObject({
      type: 'term:ready',
      sessionId: 'local-s1',
      hostName: '本机终端 (Local Shell)',
      cwd: localPtySession.initialCwd
    });
  });

  it('term:init local path reports term:error when the pty fails to spawn', async () => {
    const { conn, sent } = makeConn();
    const { deps, storage, localPtyManager } = makeDeps();
    storage.getHosts.mockReturnValue([localHost]);
    localPtyManager.createSession.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    await handleTermInit(
      { type: 'term:init', sessionId: 'local-s1', hostId: 'local-shell', cols: 80, rows: 24 },
      conn,
      deps
    );
    expect(sent[0]).toMatchObject({ type: 'term:error', sessionId: 'local-s1' });
    expect((sent[0] as { message: string }).message).toContain('本机终端启动失败');
  });

  it('term:init local pty data/exit events are forwarded to the connection', async () => {
    const { conn, sent } = makeConn();
    const { deps, storage, localPtySession } = makeDeps();
    storage.getHosts.mockReturnValue([localHost]);
    await handleTermInit(
      { type: 'term:init', sessionId: 'local-s1', hostId: 'local-shell', cols: 80, rows: 24 },
      conn,
      deps
    );
    localPtySession.events.emit('data', 'hello');
    localPtySession.events.emit('exit');
    expect(sent).toEqual([
      {
        type: 'term:ready',
        sessionId: 'local-s1',
        hostName: '本机终端 (Local Shell)',
        cwd: 'C:\\Users\\test'
      },
      { type: 'term:data', sessionId: 'local-s1', data: 'hello' },
      { type: 'term:close', sessionId: 'local-s1' }
    ]);
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

  it('sftp:list uses the local fs when the session is local', async () => {
    const { conn, sent } = makeConn();
    const { deps, localFsManager } = makeDeps();
    await handleSftpList(
      { type: 'sftp:list', requestId: 'r1', sessionId: 'local-s1', dirPath: 'C:\\Users\\test' },
      conn,
      deps
    );
    expect(localFsManager.list).toHaveBeenCalledWith('C:\\Users\\test');
    expect(sent[0]).toMatchObject({ type: 'sftp:response', requestId: 'r1', success: true });
  });

  it('sftp:list returns an error response when local listing throws', async () => {
    const { conn, sent } = makeConn();
    const { deps, localFsManager } = makeDeps();
    localFsManager.list.mockImplementation(() => {
      throw new Error('EACCES');
    });
    await handleSftpList(
      { type: 'sftp:list', requestId: 'r1', sessionId: 'local-s1', dirPath: '/x' },
      conn,
      deps
    );
    expect(sent[0]).toMatchObject({
      type: 'sftp:response',
      requestId: 'r1',
      success: false,
      error: 'EACCES'
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

describe('ws handlers · agent UX round-1', () => {
  it('agent:skip resolves the approval as skipped and notifies the client (UX1-②)', () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    const skip = vi.fn(() => true);
    deps.approvalManager = { skip } as unknown as WsDependencies['approvalManager'];

    handleAgentSkip({ type: 'agent:skip', sessionId: 's1', approvalId: 'appr-1' }, conn, deps);

    expect(skip).toHaveBeenCalledWith('appr-1');
    expect(sent[0]).toMatchObject({
      type: 'agent:approval_resolved',
      sessionId: 's1',
      approvalId: 'appr-1',
      status: 'skipped'
    });
  });

  it('agent:skip stays silent when the approval cannot be skipped', () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    const skip = vi.fn(() => false);
    deps.approvalManager = { skip } as unknown as WsDependencies['approvalManager'];

    handleAgentSkip({ type: 'agent:skip', sessionId: 's1', approvalId: 'appr-gone' }, conn, deps);

    expect(skip).toHaveBeenCalledWith('appr-gone');
    expect(sent).toHaveLength(0);
  });

  it('agent:confirm_plan forwards to agentRuntime.confirmPlan and errors when nothing is pending (UX1-①)', () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    const confirmPlan = vi.fn(() => false);
    deps.agentRuntime = { confirmPlan } as unknown as WsDependencies['agentRuntime'];

    handleAgentConfirmPlan(
      { type: 'agent:confirm_plan', sessionId: 's1', planId: 'plan-1' },
      conn,
      deps
    );
    expect(confirmPlan).toHaveBeenCalledWith('s1', 'plan-1');
    expect(sent[0]).toMatchObject({
      type: 'agent:error',
      sessionId: 's1'
    });

    // success path stays silent (the resumed run pushes plan updates itself)
    sent.length = 0;
    confirmPlan.mockReturnValue(true);
    handleAgentConfirmPlan(
      { type: 'agent:confirm_plan', sessionId: 's1', planId: 'plan-1' },
      conn,
      deps
    );
    expect(sent).toHaveLength(0);
  });

  it('agent:run reports a rejected run (concurrency gate) via agent:error (UX1-③)', async () => {
    const { conn, sent } = makeConn();
    const { deps } = makeDeps();
    const runPlan = vi.fn().mockRejectedValue(new Error('该会话已有正在执行的智能体任务，请等待其完成或先取消'));
    deps.agentRuntime = { runPlan } as unknown as WsDependencies['agentRuntime'];

    await handleAgentRun(
      { type: 'agent:run', requestId: 'agent-r1', sessionId: 's1', goal: '排查 nginx' },
      conn,
      deps
    );

    expect(runPlan).toHaveBeenCalledTimes(1);
    // options carry the plan-confirmation setting read from storage
    expect(runPlan.mock.calls[0][3]).toMatchObject({ requirePlanConfirmation: true });
    expect(sent.some(m => m.type === 'agent:error')).toBe(true);
    const err = sent.find(m => m.type === 'agent:error');
    expect(err).toMatchObject({
      type: 'agent:error',
      sessionId: 's1',
      requestId: 'agent-r1',
      message: '该会话已有正在执行的智能体任务，请等待其完成或先取消'
    });
  });

  it('term:close also cancels any in-flight agent run for the session (UX1-③)', async () => {
    const { conn } = makeConn();
    const { deps } = makeDeps();
    const cancel = vi.fn(() => undefined);
    deps.agentRuntime = { cancel } as unknown as WsDependencies['agentRuntime'];

    await handleTermClose({ type: 'term:close', sessionId: 'local-s1' }, conn, deps);
    expect(cancel).toHaveBeenCalledWith('local-s1');
  });
});
