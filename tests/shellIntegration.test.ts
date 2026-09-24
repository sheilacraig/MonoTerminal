import { describe, it, expect, vi } from 'vitest';
import { parseOsc133, parseOsc7, ShellIntegrationTracker } from '../src/utils/shellIntegration';

describe('Shell Integration - OSC 133 Parser', () => {
  it('returns null for empty or null data', () => {
    expect(parseOsc133('')).toBeNull();
    // @ts-expect-error test undefined/null safety
    expect(parseOsc133(null)).toBeNull();
  });

  it('parses prompt start: A', () => {
    expect(parseOsc133('A')).toEqual({ type: 'A' });
    expect(parseOsc133('a')).toEqual({ type: 'A' });
  });

  it('parses command start: B', () => {
    expect(parseOsc133('B')).toEqual({ type: 'B' });
  });

  it('parses command executed: C', () => {
    expect(parseOsc133('C')).toEqual({ type: 'C' });
  });

  it('parses command finished: D with exit code', () => {
    expect(parseOsc133('D;0')).toEqual({ type: 'D', exitCode: 0 });
    expect(parseOsc133('D;1')).toEqual({ type: 'D', exitCode: 1 });
    expect(parseOsc133('D;127')).toEqual({ type: 'D', exitCode: 127 });
    expect(parseOsc133('D;255')).toEqual({ type: 'D', exitCode: 255 });
  });

  it('parses command finished: D without explicit exit code defaulting to 0', () => {
    expect(parseOsc133('D')).toEqual({ type: 'D', exitCode: 0 });
    expect(parseOsc133('D;')).toEqual({ type: 'D', exitCode: 0 });
  });

  it('parses explicit command text: E', () => {
    expect(parseOsc133('E;ls -la')).toEqual({ type: 'E', value: 'ls -la' });
    expect(parseOsc133('E;echo "hello; world"')).toEqual({
      type: 'E',
      value: 'echo "hello; world"'
    });
  });

  it('parses property: P', () => {
    expect(parseOsc133('P;k=v')).toEqual({ type: 'P', value: 'k=v' });
  });

  it('returns null for unknown sequence identifiers', () => {
    expect(parseOsc133('Z')).toBeNull();
    expect(parseOsc133('UNKNOWN;123')).toBeNull();
  });
});

describe('Shell Integration - OSC 7 CWD Parser', () => {
  it('returns null for empty input', () => {
    expect(parseOsc7('')).toBeNull();
  });

  it('parses standard file:// URIs', () => {
    expect(parseOsc7('file://localhost/var/log/nginx')).toBe('/var/log/nginx');
    expect(parseOsc7('file://prod-server/etc/systemd')).toBe('/etc/systemd');
  });

  it('handles URL-encoded path components', () => {
    expect(parseOsc7('file://localhost/home/user/my%20documents')).toBe('/home/user/my documents');
  });

  it('strips leading slash for Windows drive letters', () => {
    expect(parseOsc7('file://localhost/C:/Users/whh/MonoTerminal')).toBe(
      'C:/Users/whh/MonoTerminal'
    );
    expect(parseOsc7('file://localhost/d:/workspace/code')).toBe('d:/workspace/code');
  });

  it('falls back to regex when URL parsing fails on non-standard formatting', () => {
    expect(parseOsc7('file://some-host:invalid-port/opt/app')).toBe('/opt/app');
  });
});

describe('ShellIntegrationTracker', () => {
  it('initializes sessions with default state and reports hasIntegration accurately', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-test-1';

    expect(tracker.hasIntegration(sid)).toBe(false);
    expect(tracker.getCwd(sid)).toBe('~');
    expect(tracker.getLastCommand(sid)).toBeNull();
    expect(tracker.getFailedCommand(sid)).toBeNull();

    // Receiving an OSC 133 activates integration flag
    tracker.handleOsc133(sid, 'A');
    expect(tracker.hasIntegration(sid)).toBe(true);
  });

  it('tracks a successful command lifecycle (exit code 0)', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-test-2';
    const finishSpy = vi.fn();
    tracker.onCommandFinished(sid, finishSpy);

    // 1. Prompt displayed
    tracker.handleOsc133(sid, 'A');

    // 2. Command started
    tracker.handleOsc133(sid, 'B');

    // 3. Command text set (either via E or setCommandText)
    tracker.handleOsc133(sid, 'E;echo "hello"');

    // 4. Output started
    tracker.handleOsc133(sid, 'C');

    // 5. Output fed
    tracker.noteOutput(sid, 'hello\n');

    // 6. Finished with exit code 0
    tracker.handleOsc133(sid, 'D;0');

    expect(finishSpy).toHaveBeenCalledTimes(1);
    const cmd = finishSpy.mock.calls[0][0];
    expect(cmd.command).toBe('echo "hello"');
    expect(cmd.output).toBe('hello\n');
    expect(cmd.exitCode).toBe(0);
    expect(cmd.state).toBe('completed');

    expect(tracker.getLastCommand(sid)).toEqual(cmd);
    expect(tracker.getFailedCommand(sid)).toBeNull();
  });

  it('records failed commands on exitCode !== 0 and clears them on subsequent success', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-test-3';

    // Set working directory via OSC 7
    tracker.handleOsc7(sid, 'file://localhost/etc/nginx');
    expect(tracker.getCwd(sid)).toBe('/etc/nginx');

    // Execute failing command
    tracker.handleOsc133(sid, 'B');
    tracker.setCommandText(sid, 'nginx -t');
    tracker.handleOsc133(sid, 'C');
    tracker.noteOutput(sid, 'nginx: [emerg] configuration error in /etc/nginx/nginx.conf:20\n');
    tracker.handleOsc133(sid, 'D;1');

    const failed = tracker.getFailedCommand(sid);
    expect(failed).not.toBeNull();
    expect(failed?.command).toBe('nginx -t');
    expect(failed?.exitCode).toBe(1);
    expect(failed?.output).toContain('nginx: [emerg] configuration error');
    expect(failed?.cwd).toBe('/etc/nginx');

    // Execute subsequent successful command
    tracker.handleOsc133(sid, 'B');
    tracker.setCommandText(sid, 'echo "fixed"');
    tracker.handleOsc133(sid, 'C');
    tracker.noteOutput(sid, 'fixed\n');
    tracker.handleOsc133(sid, 'D;0');

    // Failed command should be cleared
    expect(tracker.getFailedCommand(sid)).toBeNull();
  });

  it('handles explicit clearFailedCommand', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-test-clear';

    tracker.handleOsc133(sid, 'B');
    tracker.handleOsc133(sid, 'C');
    tracker.handleOsc133(sid, 'D;127');
    expect(tracker.getFailedCommand(sid)).not.toBeNull();

    tracker.clearFailedCommand(sid);
    expect(tracker.getFailedCommand(sid)).toBeNull();
  });

  it('finalizes in-flight running command if new prompt A arrives without D', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-test-implicit';
    const finishSpy = vi.fn();
    tracker.onCommandFinished(sid, finishSpy);

    tracker.handleOsc133(sid, 'B');
    tracker.handleOsc133(sid, 'C');
    tracker.noteOutput(sid, 'some output');
    // Shell sends prompt A directly (interrupted or hook omitted D)
    tracker.handleOsc133(sid, 'A');

    expect(finishSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy.mock.calls[0][0].exitCode).toBe(0);
    expect(finishSpy.mock.calls[0][0].state).toBe('completed');
  });

  it('emits onCwdChanged when OSC 7 updates path', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-cwd';
    const cwdSpy = vi.fn();
    const unsubscribe = tracker.onCwdChanged(sid, cwdSpy);

    tracker.handleOsc7(sid, 'file://localhost/var/log');
    expect(cwdSpy).toHaveBeenCalledWith('/var/log');
    expect(tracker.getCwd(sid)).toBe('/var/log');

    // Unsubscribe
    unsubscribe();
    tracker.handleOsc7(sid, 'file://localhost/tmp');
    expect(cwdSpy).toHaveBeenCalledTimes(1);
    expect(tracker.getCwd(sid)).toBe('/tmp');
  });

  it('cleans up state and listeners on dispose', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-dispose';
    const finishSpy = vi.fn();
    tracker.onCommandFinished(sid, finishSpy);

    tracker.handleOsc133(sid, 'A');
    expect(tracker.hasIntegration(sid)).toBe(true);

    tracker.dispose(sid);
    expect(tracker.hasIntegration(sid)).toBe(false);
    expect(tracker.getCwd(sid)).toBe('~');

    // New events on disposed session should not trigger previous listeners
    tracker.handleOsc133(sid, 'B');
    tracker.handleOsc133(sid, 'C');
    tracker.handleOsc133(sid, 'D;0');
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it('preserves commandText set prior to shell emitting B/C sequence', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-pre-b';

    // AI or UI triggers runCommand before shell receives bytes and emits 133;B
    tracker.setCommandText(sid, 'curl -s https://example.com/api');

    // Shell now emits B, C, D
    tracker.handleOsc133(sid, 'B');
    tracker.handleOsc133(sid, 'C');
    tracker.noteOutput(sid, 'curl: (7) Failed to connect to example.com\n');
    tracker.handleOsc133(sid, 'D;7');

    const failed = tracker.getFailedCommand(sid);
    expect(failed?.command).toBe('curl -s https://example.com/api');
    expect(failed?.exitCode).toBe(7);
  });

  it('strips ANSI escape codes from failed command output for clean AI context', () => {
    const tracker = new ShellIntegrationTracker();
    const sid = 'sess-ansi-clean';

    tracker.handleOsc133(sid, 'B');
    tracker.setCommandText(sid, 'git status');
    tracker.handleOsc133(sid, 'C');
    // Output with red/bold ANSI codes
    tracker.noteOutput(
      sid,
      '\x1b[31;1mfatal: not a git repository (or any of the parent directories): .git\x1b[0m\n'
    );
    tracker.handleOsc133(sid, 'D;128');

    const failed = tracker.getFailedCommand(sid);
    expect(failed?.output).toBe(
      'fatal: not a git repository (or any of the parent directories): .git'
    );
  });
});
