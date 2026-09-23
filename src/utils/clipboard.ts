/**
 * Clipboard & selection helpers.
 *
 * The app runs inside a Chromium shell where the default context menu is absent
 * and the terminal is a canvas-like element, so "select to copy / right-click to
 * paste" has to be implemented explicitly.
 *
 * Scope is opt-in: only elements marked with `data-copy-scope="terminal"` or
 * `data-copy-scope="agent"` take part, so the rest of the UI (modals, sidebar,
 * form controls) keeps the browser's normal behaviour.
 */

/** Attribute that declares which region a node belongs to. */
export const COPY_SCOPE_ATTR = 'data-copy-scope';

export type CopyScope = 'terminal' | 'agent';

/** Marks the AI input so a right-click elsewhere in the panel can target it. */
export const AGENT_INPUT_ATTR = 'data-agent-input';

/** Whether the element can accept inserted text. */
export function isEditableElement(node: EventTarget | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/** Walk up the tree until an element declaring a copy scope is found. */
export function findCopyScope(node: Node | null): CopyScope | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement) {
      const scope = current.getAttribute(COPY_SCOPE_ATTR);
      if (scope === 'terminal' || scope === 'agent') return scope;
    }
    current = current.parentNode;
  }
  return null;
}

/** Current DOM selection as text (empty string when nothing is selected). */
export function getSelectionText(): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return '';
  return selection.toString();
}

/** The node a selection was anchored at — used to tell which pane was used. */
export function getSelectionAnchorNode(): Node | null {
  return window.getSelection()?.anchorNode ?? null;
}

/**
 * Copy text to the system clipboard.
 * Falls back to a hidden textarea + `execCommand('copy')` for the case where
 * `navigator.clipboard` is unavailable or rejected (window not focused, etc).
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}

/** Synchronous copy path — needed inside user gestures that cannot await. */
export function legacyCopy(text: string): boolean {
  try {
    const holder = document.createElement('textarea');
    holder.value = text;
    holder.setAttribute('readonly', '');
    holder.style.position = 'fixed';
    holder.style.top = '-1000px';
    holder.style.left = '-1000px';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    holder.select();
    holder.setSelectionRange(0, holder.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(holder);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Read the clipboard. Returns `null` when the read is blocked so callers can
 * fall back to telling the user to press Ctrl+V instead of silently doing nothing.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText();
    return text ?? '';
  } catch {
    return null;
  }
}

/**
 * Insert text at the caret of an editable element.
 * Uses the native value setter + an `input` event so React-controlled inputs
 * (the AI question box) pick the change up.
 */
export function insertTextAtCaret(element: HTMLElement, text: string): void {
  if (!text) return;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = element.value.slice(0, start) + text + element.value.slice(end);

    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (setter) setter.call(element, next);
    else element.value = next;

    element.dispatchEvent(new Event('input', { bubbles: true }));

    const caret = start + text.length;
    element.focus();
    try {
      element.setSelectionRange(caret, caret);
    } catch {
      /* setSelectionRange throws on some input types — caret position is cosmetic */
    }
    return;
  }

  if (element.isContentEditable) {
    element.focus();
    document.execCommand('insertText', false, text);
  }
}
