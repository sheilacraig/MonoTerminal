import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../server/application/events/InMemoryEventBus';
import { EventEmittingFsProvider } from '../server/infrastructure/filesystem/EventEmittingFsProvider';
import { MockFileSystemProvider } from '../server/infrastructure/filesystem/MockFileSystemProvider';
import { MockTerminalProvider } from '../server/infrastructure/terminal/MockTerminalProvider';
import { DefaultSessionManager } from '../server/application/session/DefaultSessionManager';
import { CommandEngine } from '../server/application/command/CommandEngine';
import { ContextEngine } from '../server/application/context/ContextEngine';
import {
  POWERSHELL_OSC133_HOOK_SCRIPT,
  buildPowerShellOsc133Args
} from '../server/infrastructure/terminal/powershellOsc133Hook';
import { MockFileSystem, MockTerminalSession } from '../server/mockServer';
import type { MockSessionEntry } from '../server/ws/types';
import type { MonoEvent } from '../server/domain/events/types';

function createTestEnvironment() {
  const eventBus = new InMemoryEventBus();
  const mockSessions = new Map<string, MockSessionEntry>();
  const createMockSession = (sessionId: string): MockSessionEntry => {
    const fs = new MockFileSystem();
    const term = new MockTerminalSession(sessionId, fs);
    return { term, fs };
  };

  const mockTermProvider = new MockTerminalProvider(mockSessions, createMockSession);
  const rawMockFsProvider = new MockFileSystemProvider(mockSessions);
  const fsProvider = new EventEmittingFsProvider(rawMockFsProvider, eventBus);

  const sessionManager = new DefaultSessionManager({
    terminalProviders: {
      local: mockTermProvider,
      ssh: mockTermProvider,
      mock: mockTermProvider
    },
    fileSystemProviders: {
      local: fsProvider,
      ssh: fsProvider,
      mock: fsProvider
    },
    hooks: {
      onSessionConnected: session => {
        eventBus.publish({
          type: 'session:connected',
          sessionId: session.id,
          sessionType: session.type,
          hostId: session.host.id,
          cwd: session.terminal.cwd,
          timestamp: Date.now()
        });
      },
      onSessionDisconnected: (session, reason) => {
        eventBus.publish({
          type: 'session:disconnected',
          sessionId: session.id,
          reason,
          timestamp: Date.now()
        });
      }
    }
  });

  const commandEngine = new CommandEngine(eventBus, (sessionId, cwd) => {
    sessionManager.updateCwd(sessionId, cwd);
  });
  const contextEngine = new ContextEngine(sessionManager, commandEngine, eventBus);

  return {
    eventBus,
    mockSessions,
    fsProvider,
    sessionManager,
    commandEngine,
    contextEngine
  };
}

describe('Phase 4: InMemoryEventBus & EventEmittingFsProvider', () => {
  it('dispatches typed events and global events, and isolates subscriber errors', () => {
    const bus = new InMemoryEventBus();
    const allEvents: MonoEvent[] = [];
    const cmdFailedEvents: MonoEvent[] = [];

    const unsubAll = bus.subscribeAll(evt => allEvents.push(evt));
    bus.subscribe('command:failed', () => {
      throw new Error('subscriber failure should be caught');
    });
    const unsubFailed = bus.subscribe('command:failed', evt => cmdFailedEvents.push(evt));

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.publish({
      type: 'command:started',
      sessionId: 's1',
      commandId: 'c1',
      command: 'nginx -t',
      timestamp: 100
    });

    bus.publish({
      type: 'command:failed',
      sessionId: 's1',
      commandId: 'c1',
      command: 'nginx -t',
      exitCode: 1,
      stdout: '',
      stderr: 'syntax error',
      timestamp: 200
    });

    expect(allEvents).toHaveLength(2);
    expect(cmdFailedEvents).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    unsubAll();
    unsubFailed();
  });

  it('emits file events for external calls and suppresses file:opened when internal: true (P1-E)', async () => {
    const { eventBus, sessionManager, fsProvider } = createTestEnvironment();
    await sessionManager.create({
      id: 'sess-fs',
      host: {
        id: 'mock-1',
        name: 'Mock Host',
        group: 'Test',
        host: '127.0.0.1',
        port: 22,
        username: 'root',
        authType: 'mock',
        createdAt: 0
      },
      cols: 80,
      rows: 24
    });

    const opened: string[] = [];
    const saved: string[] = [];
    const changed: string[] = [];

    eventBus.subscribe('file:opened', e => opened.push(e.path));
    eventBus.subscribe('file:saved', e => saved.push(e.path));
    eventBus.subscribe('file:changed', e => changed.push(`${e.operation}:${e.path}`));

    // External read -> emits file:opened
    await fsProvider.read('sess-fs', '/etc/nginx/nginx.conf');
    expect(opened).toEqual(['/etc/nginx/nginx.conf']);

    // Internal probe read -> does NOT emit file:opened (P1-E)
    await fsProvider.read('sess-fs', '/etc/nginx/nginx.conf', { internal: true });
    expect(opened).toEqual(['/etc/nginx/nginx.conf']);

    // Write -> emits file:saved
    await fsProvider.write('sess-fs', '/etc/nginx/test.conf', 'server {}');
    expect(saved).toEqual(['/etc/nginx/test.conf']);

    // Mkdir, rename, chmod, delete -> emit file:changed
    await fsProvider.mkdir('sess-fs', '/etc/nginx/newdir');
    await fsProvider.rename('sess-fs', '/etc/nginx/test.conf', '/etc/nginx/renamed.conf');
    await fsProvider.chmod('sess-fs', '/etc/nginx/renamed.conf', 0o600);
    await fsProvider.delete('sess-fs', '/etc/nginx/renamed.conf', false);

    expect(changed).toContain('mkdir:/etc/nginx/newdir');
    expect(changed).toContain('rename:/etc/nginx/test.conf');
    expect(changed).toContain('chmod:/etc/nginx/renamed.conf');
    expect(changed).toContain('delete:/etc/nginx/renamed.conf');
  });
});

describe('Phase 5: CommandEngine & PowerShell OSC 133 Hook', () => {
  it('tracks semantic command lifecycle and emits command events without fabricating records on heuristic error (P0-A)', () => {
    const { eventBus, commandEngine } = createTestEnvironment();
    const events: string[] = [];
    eventBus.subscribeAll(e => events.push(e.type));

    // Ingest OSC 7 CWD change
    commandEngine.ingestClientEvent({
      sessionId: 's1',
      kind: 'cwd',
      cwd: '/var/www',
      timestamp: 1000
    });
    expect(commandEngine.getCwd('s1')).toBe('/var/www');
    expect(commandEngine.hasSemanticIntegration('s1')).toBe(true);
    expect(events).toContain('directory:changed');

    // Ingest OSC 133 command finished (failed)
    commandEngine.ingestClientEvent({
      sessionId: 's1',
      kind: 'finished',
      command: 'systemctl restart nginx',
      cwd: '/var/www',
      exitCode: 1,
      output: 'Job for nginx.service failed',
      timestamp: 2000
    });

    const failed = commandEngine.failed('s1');
    expect(failed).toBeDefined();
    expect(failed?.command).toBe('systemctl restart nginx');
    expect(failed?.exitCode).toBe(1);
    expect(events).toContain('command:finished');
    expect(events).toContain('command:failed');

    // Heuristic error on a non-OSC session does NOT create a fake CommandRecord
    commandEngine.ingestClientEvent({
      sessionId: 's-no-osc',
      kind: 'heuristic_error',
      output: 'Permission denied',
      timestamp: 3000
    });
    expect(commandEngine.hasSemanticIntegration('s-no-osc')).toBe(false);
    expect(commandEngine.recent('s-no-osc')).toHaveLength(0);
    expect(commandEngine.getHeuristicError('s-no-osc')?.snippet).toBe('Permission denied');
  });

  it('generates PowerShell OSC 133 + OSC 7 prompt bootstrap script with Get-History fallback (P1-1, P2-4, P2-9)', () => {
    const args = buildPowerShellOsc133Args();
    expect(args).toContain('-Command');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('Import-Module PSReadLine');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('Get-History -Count 1');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('133;E;');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('133;D;');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('133;A');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('133;B');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain(']7;file://');
    expect(POWERSHELL_OSC133_HOOK_SCRIPT).toContain('function Global:prompt');

    // Case-insensitive -c / -COMMAND detection (P2-9)
    expect(buildPowerShellOsc133Args(['-C', 'echo hi'])).toEqual(['-C', 'echo hi']);
    expect(buildPowerShellOsc133Args(['-command', 'echo hi'])).toEqual(['-command', 'echo hi']);
  });

  it('P1-1 live verification: executes POWERSHELL_OSC133_HOOK_SCRIPT and emits OSC 133;E;echo test + OSC 133;D;0', async () => {
    if (process.platform !== 'win32') return;

    const { execFileSync } = await import('child_process');
    const { ShellIntegrationTracker } = await import('../src/utils/shellIntegration');

    const rawOut = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NoExit', '-Command', POWERSHELL_OSC133_HOOK_SCRIPT],
      {
        input: 'echo test\r\nexit\r\n',
        encoding: 'utf-8',
        windowsHide: true
      }
    );

    expect(rawOut).toContain('\x1b]133;E;echo test\x07');
    expect(rawOut).toContain('\x1b]133;D;0\x07');
    expect(rawOut).toContain('\x1b]7;file://localhost/');

    // Parse all emitted OSC 133 and OSC 7 sequences through ShellIntegrationTracker
    const tracker = new ShellIntegrationTracker();
    // eslint-disable-next-line no-control-regex
    const oscRegex = /\x1b\](133|7);([^\x07]*)\x07/g;
    let match: RegExpExecArray | null;
    while ((match = oscRegex.exec(rawOut)) !== null) {
      if (match[1] === '133') {
        tracker.handleOsc133('live-ps', match[2]);
      } else if (match[1] === '7') {
        tracker.handleOsc7('live-ps', match[2]);
      }
    }

    const lastCmd = tracker.getLastCommand('live-ps');
    expect(lastCmd).not.toBeNull();
    expect(lastCmd?.command).toBe('echo test');
    expect(lastCmd?.exitCode).toBe(0);
  });
});

describe('Phase 6: ContextEngine', () => {
  it('assembles structured WorkspaceContext and probes .git/HEAD without self-exciting openFiles (P1-E)', async () => {
    const { sessionManager, fsProvider, commandEngine, contextEngine } = createTestEnvironment();

    await sessionManager.create({
      id: 'sess-ctx',
      host: {
        id: 'mock-ctx',
        name: 'Prod Web 01',
        group: 'Prod',
        host: '10.0.0.1',
        port: 22,
        username: 'ubuntu',
        authType: 'mock',
        initialDir: '/etc/nginx',
        createdAt: 0
      },
      cols: 120,
      rows: 35
    });

    // Simulate a .git/HEAD file inside /etc/nginx
    await fsProvider.mkdir('sess-ctx', '/etc/nginx/.git');
    await fsProvider.write('sess-ctx', '/etc/nginx/.git/HEAD', 'ref: refs/heads/main\n');

    // User opens a file via SFTP
    await fsProvider.read('sess-ctx', '/etc/nginx/nginx.conf');

    // Record a failed command
    commandEngine.ingestClientEvent({
      sessionId: 'sess-ctx',
      kind: 'finished',
      command: 'nginx -t',
      cwd: '/etc/nginx',
      exitCode: 1,
      output: 'nginx: configuration file test failed',
      timestamp: Date.now()
    });

    const ctx = await contextEngine.buildContext('sess-ctx');

    expect(ctx.session.id).toBe('sess-ctx');
    expect(ctx.session.hostName).toBe('Prod Web 01');
    expect(ctx.terminal.cwd).toBe('/etc/nginx');
    expect(ctx.terminal.hasSemanticIntegration).toBe(true);
    expect(ctx.command.failed?.command).toBe('nginx -t');
    expect(ctx.command.failed?.exitCode).toBe(1);
    expect(ctx.git?.branch).toBe('main');

    // Verify .git/HEAD was NOT added to openFiles (P1-E)
    expect(ctx.filesystem.openFiles).toEqual(['/etc/nginx/nginx.conf']);
    expect(ctx.filesystem.selectedFile).toBe('/etc/nginx/nginx.conf');
  });
});
