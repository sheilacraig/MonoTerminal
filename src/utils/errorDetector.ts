/**
 * Terminal error detection with severity tiers.
 *
 * - critical: system/kernel-level failures (OOM, kernel panic, fatal service errors)
 * - error:    operation/service failures that definitely need attention
 * - warning:  suspicious output that may or may not be a real problem
 *
 * `hasError` stays true for ANY tier (backwards compatible); consumers should
 * inspect `severity` to decide how aggressively to surface the problem.
 */

export type ErrorSeverity = 'critical' | 'error' | 'warning';

export interface TerminalErrorCheck {
  hasError: boolean;
  snippet?: string;
  severity?: ErrorSeverity;
}

/** Cooldown for re-raising the same error bubble within one session (ms). */
export const ERROR_BUBBLE_COOLDOWN_MS = 30_000;

const CRITICAL_PATTERNS: RegExp[] = [
  // Kernel / OS level
  /Kernel panic/i,
  /BUG: unable to handle kernel/i,
  /\b(Out of memory: Killed process|oom-kill|OOMKilled)\b/i,
  /\bCannot allocate memory\b/i,
  // Fatal application-level (nginx [emerg], "FATAL:", "PANIC:", ...)
  /\b(FATAL|PANIC|CRITICAL):\s+/i,
  // NOTE: no \b before \[ — log lines look like "nginx: [emerg] ..." where a
  // word boundary never exists between the space and the bracket
  /\[emerg\]\s+/i
];

const ERROR_PATTERNS: RegExp[] = [
  // systemd / service supervision
  /\b(Failed\s+with\s+result|Active:\s+failed|failed\s+because|status=\d+\/FAILURE)/i,
  /\bFailed to start\b/i,
  /\bUnit [\w@.-]+ (not found|could not be found)/i,
  // Non-zero exits
  /\b(exited\s+with\s+error|error\s+code)/i,
  /\bexit(?:ed)? with (?:exit )?(?:code|status)\s*[:=]?\s*[1-9]\d*/i,
  /\bexit (?:code|status)\s*[:=]?\s*[1-9]\d*/i,
  /\bterminated with (?:exit )?(?:code |status )?[1-9]\d*/i,
  // Networking / ports
  /\b(Address\s+already\s+in\s+use|EADDRINUSE)\b/i,
  /\b(Connection\s+refused|Connection\s+timed\s+out)\b/i,
  /\b(Network is unreachable|No route to host)\b/i,
  /\b(Temporary failure in name resolution|Name or service not known)\b/i,
  // TLS / certificates
  /\b(certificate verify failed|SSL_ERROR\w*|unable to get local issuer certificate|handshake fail(ed|ure))\b/i,
  // Filesystem / disk
  /\b(No space left on device)\b/i,
  /\bRead-only file system\b/i,
  /\b(Input\/output error|I\/O error)\b/i,
  // Shell / process basics
  /\b(command\s+not\s+found|no\s+such\s+file\s+or\s+directory)\b/i,
  /\b(Permission\s+denied|Access\s+denied)\b/i,
  /\b(Segmentation\s+fault|Core\s+dumped|segfault\s+at)\b/i,
  // Language runtimes & tracebacks
  /\bTraceback\s+\(most\s+recent\s+call\s+last\):/i,
  /\b(SyntaxError|TypeError|ReferenceError|NameError|ImportError|ModuleNotFoundError|ValueError|KeyError|AttributeError|IndexError):\s+/i,
  // Tooling
  /\bError response from daemon\b/i,
  /\bmake(\[\d+\])?: \*\*\*/i,
  /\b(dpkg: error|E: Unable to locate package)\b/i
];

const WARNING_PATTERNS: RegExp[] = [
  /\bWARN(ING)?\b[:\s]/i,
  /\bdeprecated\b/i,
  // Broad fallback — intentionally the lowest tier to avoid noisy bubbles
  /\berr(or)?:\s+[a-zA-Z0-9_\-/]+/i
];

const TIERS: ReadonlyArray<readonly [ErrorSeverity, readonly RegExp[]]> = [
  ['critical', CRITICAL_PATTERNS],
  ['error', ERROR_PATTERNS],
  ['warning', WARNING_PATTERNS]
];

export function detectTerminalError(text: string): TerminalErrorCheck {
  if (!text) return { hasError: false };

  // Strip ANSI escape codes (\x1b control char is intentional here)
  // eslint-disable-next-line no-control-regex
  const plainText = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Highest tier wins: stop scanning as soon as a tier produces a match
  for (const [severity, patterns] of TIERS) {
    for (const pattern of patterns) {
      if (pattern.test(plainText)) {
        const lines = plainText.split('\n');
        const matchedLine = lines.find(l => pattern.test(l)) || lines[lines.length - 1];
        return {
          hasError: true,
          severity,
          snippet: matchedLine.trim().slice(0, 100)
        };
      }
    }
  }

  return { hasError: false };
}
