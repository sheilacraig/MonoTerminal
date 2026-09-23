import React, { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
  AGENT_INPUT_ATTR,
  findCopyScope,
  getSelectionAnchorNode,
  getSelectionText,
  insertTextAtCaret,
  isEditableElement,
  readClipboardText,
  writeClipboardText
} from '../utils/clipboard';

/**
 * Global "select to copy / right-click to paste" bridge for the terminal and
 * the AI panel.
 *
 * Chromium gives us no context menu and the terminal canvas reports no DOM
 * selection, so both gestures are wired up by hand:
 *
 *  - `mouseup`   → the freshly made selection is written to the clipboard.
 *  - `contextmenu` → clipboard content is pasted at the caret (AI panel) or
 *                    handed to the terminal (which pastes through xterm so
 *                    bracketed-paste mode is respected).
 *
 * Only regions marked `data-copy-scope` participate, so dialogs, the sidebar
 * and settings keep their normal behaviour.
 */
export const ClipboardScopeBridge: React.FC = () => {
  const { settings } = useSettings();
  const copyOnSelect = settings.terminal?.copyOnSelect !== false;
  const rightClickPaste = settings.terminal?.rightClickPaste !== false;

  // Select → copy
  useEffect(() => {
    if (!copyOnSelect) return;

    const handleMouseUp = () => {
      const text = getSelectionText();
      if (!text.trim()) return;
      if (!findCopyScope(getSelectionAnchorNode())) return;
      void writeClipboardText(text);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [copyOnSelect]);

  // Right-click → paste
  useEffect(() => {
    if (!rightClickPaste) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const scope = findCopyScope(target);

      // `data-copy-scope="terminal"` is owned by TerminalView, which needs the
      // xterm instance to paste with bracketed-paste support.
      if (scope !== 'agent') return;

      event.preventDefault();

      // Right-clicking anywhere in the panel pastes into the question box:
      // directly when the caret already sits there, otherwise after focusing it.
      const editableTarget = isEditableElement(target) ? target : null;
      const agentInput = editableTarget ?? document.querySelector<HTMLElement>(`[${AGENT_INPUT_ATTR}]`);

      void (async () => {
        const text = await readClipboardText();
        if (text === null) return; // clipboard blocked — leave it to Ctrl+V
        if (!text) return;
        if (agentInput) insertTextAtCaret(agentInput, text);
      })();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [rightClickPaste]);

  return null;
};
