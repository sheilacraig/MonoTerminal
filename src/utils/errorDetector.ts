const ERROR_PATTERNS = [
  /\bTraceback\s+\(most\s+recent\s+call\s+last\):/i,
  /\b(FATAL|PANIC|CRITICAL):\s+/i,
  /\b(Failed\s+with\s+result|Active:\s+failed|failed\s+because|status=\d+\/FAILURE)/i,
  /\b(exited\s+with\s+error|error\s+code)/i,
  /\b\[emerg\]\s+/i,
  /\b(Address\s+already\s+in\s+use|EADDRINUSE)\b/i,
  /\b(command\s+not\s+found|no\s+such\s+file\s+or\s+directory)\b/i,
  /\b(Permission\s+denied|Access\s+denied)\b/i,
  /\b(Connection\s+refused|Connection\s+timed\s+out)\b/i,
  /\b(Segmentation\s+fault|Core\s+dumped)\b/i,
  /\b(SyntaxError|TypeError|ReferenceError|NameError):\s+/i,
  /\berr(or)?:\s+[a-zA-Z0-9_\-\/]+/i
];

export function detectTerminalError(text: string): { hasError: boolean; snippet?: string } {
  if (!text) return { hasError: false };

  // Strip ANSI escape codes
  const plainText = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(plainText)) {
      // Find the line that matched
      const lines = plainText.split('\n');
      const matchedLine = lines.find(l => pattern.test(l)) || lines[lines.length - 1];
      return {
        hasError: true,
        snippet: matchedLine.trim().slice(0, 100)
      };
    }
  }

  return { hasError: false };
}
