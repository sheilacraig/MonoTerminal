/**
 * 探针 2：term:init 传入不存在的 hostId 时的行为
 * 预期缺陷：hosts.find 失败后静默回退到 demoHost（本机 shell），
 * 用户以为连的是远程主机，实际拿到本机 PTY。
 */
import fs from 'fs';
import { EventEmitter } from 'events';
import { handleTermInit } from '../server/ws/handlers/terminal';
import type { WsConnection, WsDependencies } from '../server/ws/types';

const sent: unknown[] = [];
const conn: WsConnection = {
  clientSessions: new Set<string>(),
  send: (msg: unknown) => {
    sent.push(msg);
  }
} as unknown as WsConnection;

let localCreated = 0;
const deps = {
  aiService: {} as never,
  sshManager: {
    createSession: async () => {
      throw new Error('ssh createSession should not be called');
    },
    closeSession: () => {},
    writeToShell: () => false,
    resize: () => {}
  } as never,
  storage: {
    getHosts: () => [], // hostId 一定找不到
    isLocked: () => false,
    decrypt: () => ''
  } as never,
  mockSessions: new Map(),
  demoHost: {
    id: 'local-shell',
    name: '本机终端 (Local Shell)',
    group: '本地',
    host: 'localhost',
    port: 0,
    username: 'fake-user',
    authType: 'local',
    initialDir: 'C:\\Users\\fake',
    createdAt: 0
  } as never,
  createMockSession: (() => ({})) as never,
  localPtyManager: {
    createSession: () => {
      localCreated++;
      return {
        pty: {} as never,
        events: new EventEmitter(),
        initialCwd: 'C:\\Users\\fake',
        shellCommand: 'pwsh.exe'
      };
    },
    has: () => false,
    write: () => {},
    resize: () => {},
    closeSession: () => {}
  } as never,
  localFsManager: {} as never
} as unknown as WsDependencies;

await handleTermInit(
  {
    type: 'term:init',
    sessionId: 'probe-session-1',
    hostId: 'totally-nonexistent-host',
    cols: 80,
    rows: 24
  },
  conn,
  deps
);

const lines: string[] = [];
lines.push('=== hostId 静默回退探针 ===');
lines.push(`hostId='totally-nonexistent-host'（hosts 列表为空）`);
lines.push(`localPtyManager.createSession 调用次数: ${localCreated}`);
lines.push(`发送给前端的消息: ${JSON.stringify(sent, null, 2)}`);
const sawError = sent.some(
  (m: any) => m?.type === 'term:error'
);
const sawReady = sent.some((m: any) => m?.type === 'term:ready');
lines.push(
  `结论: ${sawError ? '返回 term:error（正确拒绝）' : sawReady && localCreated > 0 ? '返回 term:ready 并创建了【本机】PTY —— 静默回退实证成立' : '其他'}`
);

fs.writeFileSync(new URL('./out-hostfallback.txt', import.meta.url), lines.join('\n'), 'utf8');
console.log('done');
