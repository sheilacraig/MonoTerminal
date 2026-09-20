export const SHORTCUTS = {
  TOGGLE_AGENT: 'Ctrl+\\',
  TOGGLE_SIDEBAR: 'Ctrl+B',
  NEW_TAB: 'Ctrl+T',
  CLOSE_TAB: 'Ctrl+W',
  FORCE_DANGER_CONFIRM: 'Alt+Y'
};

export function isBackslashEvent(e: KeyboardEvent): boolean {
  return (
    e.code === 'Backslash' ||
    e.key === '\\' ||
    e.keyCode === 220 ||
    e.which === 220 ||
    e.key === '|'
  );
}

export function isSidebarEvent(e: KeyboardEvent): boolean {
  return e.code === 'KeyB' || e.key === 'b' || e.key === 'B';
}

export function isNewTabEvent(e: KeyboardEvent): boolean {
  return e.code === 'KeyT' || e.key === 't' || e.key === 'T';
}

export function isCloseTabEvent(e: KeyboardEvent): boolean {
  return e.code === 'KeyW' || e.key === 'w' || e.key === 'W';
}

export function isAltYEvent(e: KeyboardEvent): boolean {
  return e.altKey && (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y');
}
