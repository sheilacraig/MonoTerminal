import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalAuthStore } from '../src/services/terminalAuth';

/**
 * These tests pin the behaviour that fixes the "sudo has nowhere to type the
 * password" bug: a parked multi-line block must only be released once the
 * password has actually been accepted — and never when it was rejected.
 */
describe('TerminalAuthStore — elevation pre-flight', () => {
  let store: TerminalAuthStore;
  let sent: string[];

  const BLOCK = "sudo cat > /etc/nginx/conf.d/site.conf << 'EOF'\rserver { listen 80; }\rEOF";

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    store = new TerminalAuthStore('s1');
    store.bindSender((_sid, data) => sent.push(data));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends `sudo -v` alone instead of dumping the whole block', () => {
    store.beginElevation(BLOCK);

    expect(sent).toEqual(['sudo -v\r']);
    // The heredoc body must NOT be in flight — that is the whole point.
    expect(sent.join('')).not.toContain('server { listen 80; }');

    const state = store.getSnapshot();
    expect(state.visible).toBe(true);
    expect(state.origin).toBe('elevation');
    expect(state.pendingBlock).toBe(BLOCK);
  });

  it('releases the parked block after a successful password', () => {
    store.beginElevation(BLOCK);
    store.noteOutput('[sudo] password for whh: ');
    store.submit('hunter2');

    expect(sent[1]).toBe('hunter2\r');

    // Nothing more until the verification window elapses (3200ms)…
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(2);

    // …then the untouched block goes out in a single write.
    vi.advanceTimersByTime(1300);
    expect(sent[2]).toBe(`${BLOCK}\r`);
    expect(store.getSnapshot().visible).toBe(false);
  });

  it('never releases the block when the password was rejected', () => {
    store.beginElevation(BLOCK);
    store.noteOutput('[sudo] password for whh: ');
    store.submit('wrong-password');

    store.noteOutput('Sorry, try again.');
    vi.advanceTimersByTime(10000);

    expect(sent.join('')).not.toContain('server { listen 80; }');
    const state = store.getSnapshot();
    expect(state.phase).toBe('error');
    expect(state.error).toContain('Sorry');
    expect(state.visible).toBe(true);
  });

  it('lets the user retry after a rejected password', () => {
    store.beginElevation(BLOCK);
    store.noteOutput('[sudo] password for whh: ');
    store.submit('wrong');
    store.noteOutput('Sorry, try again.\n[sudo] password for whh: ');
    expect(store.getSnapshot().phase).toBe('collect');

    store.submit('right');
    vi.advanceTimersByTime(3500);
    expect(sent[sent.length - 1]).toBe(`${BLOCK}\r`);
  });

  it('proceeds without a password prompt (cached credentials / NOPASSWD)', () => {
    store.beginElevation(BLOCK);
    expect(sent).toEqual(['sudo -v\r']);

    vi.advanceTimersByTime(2600);
    expect(sent[1]).toBe(`${BLOCK}\r`);
  });

  it('does not release the block when sudo itself is not permitted', () => {
    store.beginElevation(BLOCK);
    store.noteOutput('whh is not in the sudoers file.  This incident will be reported.\n');

    vi.advanceTimersByTime(10000);
    expect(sent.join('')).not.toContain('server { listen 80; }');
    expect(store.getSnapshot().phase).toBe('error');
  });

  it('drops a parked block on cancel and triggers refocus', () => {
    let refocused = false;
    store.bindOnFlush(() => {
      refocused = true;
    });

    store.beginElevation(BLOCK);
    store.cancel();
    vi.advanceTimersByTime(10000);

    expect(sent).toEqual(['sudo -v\r']);
    expect(store.getSnapshot().visible).toBe(false);
    expect(refocused).toBe(true);
  });

  it('fills the block without a trailing newline in `fill` mode', () => {
    store.beginElevation(BLOCK, 'fill');
    store.noteOutput('[sudo] password for whh: ');
    store.submit('hunter2');
    vi.advanceTimersByTime(3500);

    expect(sent[sent.length - 1]).toBe(BLOCK);
    expect(sent[sent.length - 1].endsWith('\r')).toBe(false);
  });

  it('opens automatically for a prompt typed by hand', () => {
    store.noteOutput('whh@web:~$ su -\r\n密码：');
    const state = store.getSnapshot();
    expect(state.visible).toBe(true);
    expect(state.origin).toBe('detected');
    expect(state.pendingBlock).toBeNull();
  });
});
