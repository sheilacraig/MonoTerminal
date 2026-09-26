import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  matchesShortcut,
  formatShortcutFromEvent,
  getTerminalConflictWarning
} from '../src/constants/shortcuts';

function mockKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    keyCode: 0,
    which: 0,
    ...overrides
  } as KeyboardEvent;
}

describe('Terminal-safe Shortcut Standardization & Matcher', () => {
  it('uses Ctrl+Shift+<Letter> defaults to avoid SSH/tmux/Vim conflicts', () => {
    expect(SHORTCUTS.TOGGLE_AGENT).toBe('Ctrl+\\');
    expect(SHORTCUTS.TOGGLE_SIDEBAR).toBe('Ctrl+Shift+B');
    expect(SHORTCUTS.NEW_TAB).toBe('Ctrl+Shift+T');
    expect(SHORTCUTS.CLOSE_TAB).toBe('Ctrl+Shift+W');
  });

  it('does NOT intercept bare Ctrl+B (tmux prefix) when sidebar is Ctrl+Shift+B', () => {
    const tmuxPrefixEvent = mockKeyEvent({
      ctrlKey: true,
      shiftKey: false,
      key: 'b',
      code: 'KeyB'
    });
    expect(matchesShortcut(tmuxPrefixEvent, SHORTCUTS.TOGGLE_SIDEBAR)).toBe(false);

    const sidebarToggleEvent = mockKeyEvent({
      ctrlKey: true,
      shiftKey: true,
      key: 'B',
      code: 'KeyB'
    });
    expect(matchesShortcut(sidebarToggleEvent, SHORTCUTS.TOGGLE_SIDEBAR)).toBe(true);
  });

  it('matches custom shortcuts like F2, Alt+B, and Ctrl+\\ accurately', () => {
    const f2Event = mockKeyEvent({ key: 'F2', code: 'F2' });
    expect(matchesShortcut(f2Event, 'F2')).toBe(true);
    expect(matchesShortcut(f2Event, 'Ctrl+F2')).toBe(false);

    const altBEvent = mockKeyEvent({ altKey: true, key: 'b', code: 'KeyB' });
    expect(matchesShortcut(altBEvent, 'Alt+B')).toBe(true);
    expect(matchesShortcut(altBEvent, 'Ctrl+Shift+B')).toBe(false);

    const backslashEvent = mockKeyEvent({
      ctrlKey: true,
      key: '\\',
      code: 'Backslash',
      keyCode: 220
    });
    expect(matchesShortcut(backslashEvent, 'Ctrl+\\')).toBe(true);
  });

  it('formats recorded keyboard events into normalized shortcut strings', () => {
    expect(
      formatShortcutFromEvent(
        mockKeyEvent({ ctrlKey: true, shiftKey: true, key: 'B', code: 'KeyB' })
      )
    ).toBe('Ctrl+Shift+B');

    expect(
      formatShortcutFromEvent(mockKeyEvent({ ctrlKey: true, key: 'Control', code: 'ControlLeft' }))
    ).toBeNull();

    expect(formatShortcutFromEvent(mockKeyEvent({ key: 'F2', code: 'F2' }))).toBe('F2');
  });

  it('warns when a user binds a bare Ctrl+<Letter> that conflicts with terminal control codes', () => {
    expect(getTerminalConflictWarning('Ctrl+B')).toContain('tmux');
    expect(getTerminalConflictWarning('Ctrl+W')).toContain('删除光标前单词');
    expect(getTerminalConflictWarning('Ctrl+Shift+B')).toBeNull();
    expect(getTerminalConflictWarning('Ctrl+\\')).toBeNull();
  });
});
