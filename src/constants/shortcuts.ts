export const SHORTCUTS = {
  TOGGLE_AGENT: 'Ctrl+\\',
  TOGGLE_SIDEBAR: 'Ctrl+Shift+B',
  NEW_TAB: 'Ctrl+Shift+T',
  CLOSE_TAB: 'Ctrl+Shift+W',
  FORCE_DANGER_CONFIRM: 'Alt+Y'
};

/**
 * Legacy default shortcuts that conflicted with standard POSIX/SSH/tmux/Vim control keys.
 * Used during settings normalization to auto-upgrade unmodified legacy configs.
 */
export const LEGACY_CONFLICT_SHORTCUTS: Record<string, string> = {
  'Ctrl+B': SHORTCUTS.TOGGLE_SIDEBAR,
  'Ctrl+T': SHORTCUTS.NEW_TAB,
  'Ctrl+W': SHORTCUTS.CLOSE_TAB
};

const KEY_ALIASES: Record<string, string[]> = {
  '\\': ['backslash', '\\', '|'],
  ',': ['comma', ',', '<'],
  '.': ['period', '.', '>'],
  '/': ['slash', '/', '?'],
  ';': ['semicolon', ';', ':'],
  "'": ['quote', "'", '"'],
  '[': ['bracketleft', '[', '{'],
  ']': ['bracketright', ']', '}'],
  '`': ['backquote', '`', '~'],
  '-': ['minus', '-', '_'],
  '=': ['equal', '=', '+'],
  space: ['space', ' ']
};

/**
 * Match a KeyboardEvent against a human-readable shortcut descriptor like
 * "Ctrl+Shift+B", "Ctrl+\\", "Alt+1", or "F2".
 */
export function matchesShortcut(e: KeyboardEvent, shortcutStr?: string): boolean {
  if (!shortcutStr || typeof shortcutStr !== 'string') return false;
  const parts = shortcutStr
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;

  let wantCtrl = false;
  let wantShift = false;
  let wantAlt = false;
  let keyToken = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') {
      wantCtrl = true;
    } else if (lower === 'shift') {
      wantShift = true;
    } else if (lower === 'alt' || lower === 'option') {
      wantAlt = true;
    } else {
      keyToken = part;
    }
  }

  if (!keyToken) return false;

  const hasCtrl = Boolean(e.ctrlKey || e.metaKey);
  const hasShift = Boolean(e.shiftKey);
  const hasAlt = Boolean(e.altKey);

  if (hasCtrl !== wantCtrl || hasShift !== wantShift || hasAlt !== wantAlt) {
    return false;
  }

  const targetLower = keyToken.toLowerCase();
  const eventKeyLower = (e.key || '').toLowerCase();
  const eventCodeLower = (e.code || '').toLowerCase();

  if (targetLower === '\\' || targetLower === 'backslash') {
    return isBackslashEvent(e);
  }

  // Single letter A-Z
  if (/^[a-z]$/.test(targetLower)) {
    return eventKeyLower === targetLower || eventCodeLower === `key${targetLower}`;
  }

  // Single digit 0-9
  if (/^[0-9]$/.test(targetLower)) {
    return eventKeyLower === targetLower || eventCodeLower === `digit${targetLower}`;
  }

  // Function keys F1-F12
  if (/^f([1-9]|1[0-2])$/.test(targetLower)) {
    return eventKeyLower === targetLower || eventCodeLower === targetLower;
  }

  const aliases = KEY_ALIASES[targetLower];
  if (aliases) {
    return aliases.includes(eventKeyLower) || aliases.includes(eventCodeLower);
  }

  return eventKeyLower === targetLower || eventCodeLower === targetLower;
}

/**
 * Convert a KeyboardEvent into a normalized shortcut string (e.g., "Ctrl+Shift+B").
 * Returns null if only modifier keys are pressed.
 */
export function formatShortcutFromEvent(e: KeyboardEvent): string | null {
  const ignoredKeys = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'Dead', 'Process']);
  if (ignoredKeys.has(e.key)) return null;

  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  let mainKey = '';
  if (isBackslashEvent(e)) {
    mainKey = '\\';
  } else if (e.code && e.code.startsWith('Key') && e.code.length === 4) {
    mainKey = e.code.slice(3).toUpperCase();
  } else if (e.code && e.code.startsWith('Digit') && e.code.length === 6) {
    mainKey = e.code.slice(5);
  } else if (/^F([1-9]|1[0-2])$/i.test(e.key)) {
    mainKey = e.key.toUpperCase();
  } else if (e.code === 'Comma' || e.key === ',') {
    mainKey = ',';
  } else if (e.code === 'Period' || e.key === '.') {
    mainKey = '.';
  } else if (e.code === 'Slash' || e.key === '/') {
    mainKey = '/';
  } else if (e.code === 'Space' || e.key === ' ') {
    mainKey = 'Space';
  } else if (e.key && e.key.length === 1) {
    mainKey = e.key.toUpperCase();
  } else {
    return null;
  }

  // Require at least one modifier for non-Function keys
  if (mods.length === 0 && !/^F([1-9]|1[0-2])$/.test(mainKey)) {
    return null;
  }

  return [...mods, mainKey].join('+');
}

/**
 * Check if a shortcut string conflicts with high-frequency SSH / tmux / Readline / Vim control keys.
 */
export function getTerminalConflictWarning(shortcutStr?: string): string | null {
  if (!shortcutStr) return null;
  const normalized = shortcutStr.trim();
  const match = /^Ctrl\+([A-Z])$/i.exec(normalized);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const knownConflicts: Record<string, string> = {
    A: 'GNU Screen 前缀键 / Shell 行首跳转 (Ctrl+A)',
    B: 'tmux 默认前缀键 / Vim 向上翻页 / Shell 光标左移 (Ctrl+B)',
    C: '中断当前进程信号 SIGINT (Ctrl+C)',
    D: '退出当前 Shell / EOF / Vim 半页下翻 (Ctrl+D)',
    E: 'Shell 光标移至行尾 (Ctrl+E)',
    F: 'Vim 向下翻页 / Shell 光标右移 (Ctrl+F)',
    H: '终端退格删除 Backspace (Ctrl+H)',
    K: 'Shell 剪切光标至行尾内容 (Ctrl+K)',
    L: 'Shell 清屏 clear (Ctrl+L)',
    N: 'Shell 下一条历史命令 (Ctrl+N)',
    P: 'Shell 上一条历史命令 (Ctrl+P)',
    R: 'Shell 反向搜索历史命令 (Ctrl+R)',
    S: '终端 XOFF 暂停输出流 (Ctrl+S)',
    T: 'fzf 文件搜索 / Shell 交换字符 (Ctrl+T)',
    U: 'Shell 剪切光标至行首内容 (Ctrl+U)',
    V: 'Vim 可视块列编辑模式 (Ctrl+V)',
    W: 'Shell / Vim 删除光标前单词或切换分屏 (Ctrl+W)',
    Z: '挂起当前进程至后台 SIGTSTP (Ctrl+Z)'
  };

  const detail = knownConflicts[letter] || `终端 ASCII 控制字符 ^${letter}`;
  return `单 Ctrl+${letter} 会拦截 ${detail}，强烈建议改为 Ctrl+Shift+${letter}`;
}

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
  return matchesShortcut(e, SHORTCUTS.TOGGLE_SIDEBAR);
}

export function isNewTabEvent(e: KeyboardEvent): boolean {
  return matchesShortcut(e, SHORTCUTS.NEW_TAB);
}

export function isCloseTabEvent(e: KeyboardEvent): boolean {
  return matchesShortcut(e, SHORTCUTS.CLOSE_TAB);
}

export function isAltYEvent(e: KeyboardEvent): boolean {
  return e.altKey && (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y');
}
