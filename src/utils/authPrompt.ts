/**
 * Interactive authentication detection.
 *
 * Used for two things:
 *  1. Recognising password / confirmation prompts in the terminal output so the
 *     UI can offer a proper masked input box (a canvas terminal gives the user
 *     no obvious "place to type a password").
 *  2. Recognising commands that will trigger such a prompt, so automation never
 *     dumps a whole multi-line script into a waiting password prompt — the
 *     script body would be consumed as the password itself.
 */

export type AuthPromptKind = 'sudo' | 'su' | 'passwd' | 'ssh' | 'key' | 'confirm';

export interface AuthPromptMatch {
  kind: AuthPromptKind;
  /** Human-readable label for the prompt bar. */
  label: string;
  /** `false` for yes/no confirmations (input is not masked). */
  requiresPassword: boolean;
  /** Short explanation shown next to the input. */
  hint: string;
}

const PASSWORD_HINT = '密码不会回显，也不会写入日志；输入后按 Enter 发送';

/**
 * Strip ANSI/OSC escape sequences and normalise line endings.
 *
 * Without this a coloured prompt (`\x1b[0m[sudo] password for x: \x1b[0m`)
 * would never match, and a bare `\r` (used to redraw the prompt line) would
 * leave the visible text unanchored at the end of the buffer.
 */
export function stripAnsi(input: string): string {
  /* eslint-disable no-control-regex -- ANSI/OSC escape sequences are *made of*
     control characters, so matching them necessarily violates this rule. */
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC ... BEL/ST
    .replace(/\x1b[P^_][^\x1b]*\x1b\\/g, '') // DCS/PM/APC ... ST
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI
    .replace(/\x1b[@-Z\\-_]/g, '') // Fe escapes
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  /* eslint-enable no-control-regex */
}

/** Password / passphrase prompts we know how to recognise. */
const PROMPT_RULES: { re: RegExp; match: AuthPromptMatch }[] = [
  {
    // `[sudo] password for whh:` and the zh_CN wording `[sudo] whh 的密码：`
    // Note the optional username between "for" and the colon.
    re: /\[sudo\][^\n]{0,80}?(?:password(?:\s+for)?|的密码|密码)[^\n:：]{0,64}[:：]\s*$/i,
    match: {
      kind: 'sudo',
      label: 'sudo 提权需要密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    // Emitted when ssh2 hands sudo a channel without a usable tty.
    re: /sudo:\s*(?:a\s+)?(?:password|terminal)\s+is\s+required[^\n]*[:：]?\s*$/i,
    match: {
      kind: 'sudo',
      label: 'sudo 需要密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    re: /(?:^|\n)\s*(?:password|passwd)\s*[:：]\s*$/i,
    match: {
      kind: 'passwd',
      label: '需要输入密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    re: /(?:^|\n)\s*(?:current|new)\s+UNIX\s+password\s*[:：]\s*$/i,
    match: {
      kind: 'passwd',
      label: 'passwd 修改密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    // `whh@host's password:` / `whh@host 的密码：`
    re: /[^\s:：]{1,64}(?:'s|的)\s*(?:password|密码)\s*[:：]\s*$/i,
    match: {
      kind: 'ssh',
      label: '需要输入登录密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    re: /enter\s+passphrase\s+for\s+key[^\n]*[:：]\s*$/i,
    match: {
      kind: 'key',
      label: '私钥口令',
      requiresPassword: true,
      hint: '输入私钥口令后按 Enter 发送'
    }
  },
  {
    re: /(?:^|\n)\s*[^\s:：]{1,64}的密码\s*[:：]\s*$/,
    match: {
      kind: 'su',
      label: '需要输入密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  },
  {
    // Bare zh_CN wording emitted by `su`, `passwd` and friends.
    re: /(?:^|\n)\s*密码\s*[:：]\s*$/,
    match: {
      kind: 'su',
      label: '需要输入密码',
      requiresPassword: true,
      hint: PASSWORD_HINT
    }
  }
];

/** `(yes/no/[fingerprint])?` — SSH host-key prompt and friends. */
const CONFIRM_RULES: RegExp[] = [
  /\((?:yes\/no|y\/n)[^)]*\)\s*[?？]?\s*$/i,
  /are\s+you\s+sure\s+you\s+want\s+to\s+continue\s+connecting/i
];

/**
 * Detect an authentication / interaction prompt at the **end** of the terminal
 * tail. Only the tail is inspected, so old output that merely mentions the word
 * "password" cannot re-trigger the bar.
 */
export function detectAuthPrompt(rawTail: string): AuthPromptMatch | null {
  const tail = stripAnsi(rawTail).trimEnd();
  if (!tail) return null;

  for (const rule of PROMPT_RULES) {
    if (rule.re.test(tail)) return rule.match;
  }

  // A plain shell prompt (`root@host:~#`) must never be mistaken for a question.
  if (/[$#>]\s*$/.test(tail)) return null;

  for (const re of CONFIRM_RULES) {
    if (re.test(tail)) {
      return {
        kind: 'confirm',
        label: '终端在等待确认',
        requiresPassword: false,
        hint: '输入 yes / no 后按 Enter 发送'
      };
    }
  }

  return null;
}

const FAILURE_RULES: RegExp[] = [
  /sorry,\s*try\s+again/i,
  /incorrect\s+password/i,
  /authentication\s+failure/i,
  /not\s+in\s+the\s+sudoers\s+file/i,
  /is\s+not\s+allowed\s+to\s+run/i,
  /\d+\s+incorrect\s+password\s+attempts?/i,
  /a\s+password\s+is\s+required/i,
  /no\s+askpass\s+program/i,
  /a\s+terminal\s+is\s+required/i,
  /no\s+tty\s+present/i,
  /密码(?:不正确|错误|有误)/,
  /对不起[，,]?\s*请重试/,
  /认证失败|权限不足/
];

/** Returns the offending line when an authentication attempt clearly failed. */
export function detectAuthFailure(rawChunk: string): string | null {
  const text = stripAnsi(rawChunk);
  for (const rule of FAILURE_RULES) {
    if (!rule.test(text)) continue;
    const line = text
      .split('\n')
      .map(l => l.trim())
      .find(l => rule.test(l));
    return (line || text.trim()).slice(0, 200);
  }
  return null;
}

/** `sudo -S` / `sudo -n` style invocations never prompt — no pre-flight needed. */
const NON_INTERACTIVE_SUDO_RE = /(?:^|[\s|;&(])sudo\s+(?:-[A-Za-z]*[SnA]|--stdin\b|--non-interactive\b)/;

/**
 * Whether a command block will (or may) ask for a privilege-escalation
 * password. Quoted strings are blanked out first so `echo "use sudo carefully"`
 * does not trigger a pointless authentication round-trip, and blocks that
 * already feed the password through stdin are excluded.
 */
export function requiresElevation(command: string): boolean {
  if (!command) return false;
  if (NON_INTERACTIVE_SUDO_RE.test(command)) return false;

  const withoutStrings = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');

  return (
    /(?:^|[\n\r;&|(`]|\s)(?:sudo|doas|pkexec)\s+/.test(withoutStrings) ||
    /(?:^|[\n\r;&|(`])su\s+/.test(withoutStrings)
  );
}

/** Whether a cleaned command block spans multiple lines. */
export function isMultiLineBlock(command: string): boolean {
  return /[\r\n]/.test(command.trim());
}
