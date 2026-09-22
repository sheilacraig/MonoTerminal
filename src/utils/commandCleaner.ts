/**
 * Command Cleaner and Shell Statement Parser.
 *
 * Sanitizes AI-generated codeblocks before sending them to the terminal:
 * 1. Strips whole-line comments (`# ...`) and empty lines.
 * 2. Neutralizes raw ASCII 0x09 tab characters so they NEVER trigger Bash Readline
 *    autocomplete hangs or "(Display all possibilities?)" prompt locks.
 * 3. Safeguards commands like `df -h` that hang in Linux kernel uninterruptible D-state
 *    when network shares (NFS/CIFS) are offline by using `-hl` (local filesystems only).
 * 4. Distinguishes between multiple independent commands (which are safely combined
 *    with ` && ` for batch execution or exposed individually) and compound blocks
 *    (loops, conditionals, heredocs, line continuations).
 */

export interface ParsedShellCommand {
  /** Original raw text. */
  raw: string;
  /**
   * Safe, sanitized command string ready to be executed in the terminal.
   * If there are multiple independent commands, they are linked with ` && `.
   * If it is a compound script, lines are joined with `\r`.
   */
  cleanCommand: string;
  /** Individual independent command lines (if 2 or more). */
  individualCommands: string[];
  /** Whether the block consists of multiple independent commands. */
  hasMultipleCommands: boolean;
  /** Whole-line comments that were stripped (for UI display or tooltip). */
  strippedComments: string[];
}

/**
 * Replaces ASCII 0x09 tab characters within a single line:
 * - Inside quotes (`'` or `"` or backticks): converts to literal `\t` (e.g. for docker --format).
 * - Leading indentation: converts to 2 spaces.
 * - Between tokens: converts to a single space.
 */
export function sanitizeTabsInLine(line: string): string {
  if (!line.includes('\t')) return line;

  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let isLeading = true;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prev = i > 0 ? line[i - 1] : '';

    if (char === "'" && !inDoubleQuote && !inBacktick && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
      isLeading = false;
      result += char;
    } else if (char === '"' && !inSingleQuote && !inBacktick && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      isLeading = false;
      result += char;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && prev !== '\\') {
      inBacktick = !inBacktick;
      isLeading = false;
      result += char;
    } else if (char === '\t') {
      if (inSingleQuote || inDoubleQuote || inBacktick) {
        // Inside quotes (e.g. docker ps --format "table {{.ID}}\t{{.Names}}")
        result += '\\t';
      } else if (isLeading) {
        result += '  '; // 2 spaces for indentation
      } else {
        result += ' '; // single space between arguments
      }
    } else {
      if (!/\s/.test(char)) {
        isLeading = false;
      }
      result += char;
    }
  }

  return result;
}

/**
 * Guards against commands that are notorious for hanging indefinitely in Linux kernel
 * uninterruptible D-state (which ignores Ctrl+C):
 * 1. Rewrites standalone `df -h` to `df -hl` (adds `-l` / `--local`) to only query
 *    local filesystems and skip unreachable CIFS/NFS network mounts.
 */
export function safeGuardHangingCommands(cmd: string): string {
  if (/\bdf\s+-h\b/.test(cmd) && !/\b(-l|--local|-hl|-lh)\b/.test(cmd)) {
    return cmd.replace(/\bdf\s+-h\b/g, 'df -hl');
  }
  return cmd;
}

/** Check if a line starts a heredoc (e.g. `cat << 'EOF'`). */
function getHeredocDelimiter(line: string): string | null {
  const match = line.match(/<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
  return match ? match[1] : null;
}

/** Checks whether a set of lines represents a compound shell structure. */
function isCompoundBlock(lines: string[]): boolean {
  const compoundKeywords = /^\s*(if|then|else|elif|fi|for|while|until|do|done|case|esac)\b/;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (compoundKeywords.test(l)) return true;
    if (l.endsWith('\\')) return true;
    if (l.endsWith('|') || l.endsWith('&&') || l.endsWith('||')) return true;
    if (getHeredocDelimiter(l)) return true;
  }
  return false;
}

/**
 * Normalizes and cleans a command block for safe execution in a terminal.
 */
export function parseShellCommands(rawCode: string): ParsedShellCommand {
  const normalized = (rawCode || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = normalized.split('\n');

  const strippedComments: string[] = [];
  const cleanLines: string[] = [];

  let currentHeredocDelimiter: string | null = null;

  for (const rawLine of allLines) {
    const trimmed = rawLine.trim();

    // Check heredoc state
    if (currentHeredocDelimiter) {
      cleanLines.push(sanitizeTabsInLine(rawLine));
      if (trimmed === currentHeredocDelimiter) {
        currentHeredocDelimiter = null;
      }
      continue;
    }

    // Ignore empty lines
    if (!trimmed) continue;

    // Detect comment lines: lines starting with '#'
    if (trimmed.startsWith('#')) {
      strippedComments.push(trimmed);
      continue;
    }

    // Detect if this line starts a heredoc
    const delim = getHeredocDelimiter(rawLine);
    if (delim) {
      currentHeredocDelimiter = delim;
    }

    cleanLines.push(sanitizeTabsInLine(rawLine));
  }

  if (cleanLines.length === 0) {
    return {
      raw: rawCode,
      cleanCommand: '',
      individualCommands: [],
      hasMultipleCommands: false,
      strippedComments
    };
  }

  // Determine whether this is a compound structure or a list of independent commands
  const compound = isCompoundBlock(cleanLines);

  if (compound) {
    // If lines end with line-continuation `\`, we can either join with space or keep with `\r`
    const cleanCommand = cleanLines.join('\r');
    return {
      raw: rawCode,
      cleanCommand,
      individualCommands: [cleanCommand],
      hasMultipleCommands: false,
      strippedComments
    };
  }

  // Independent single-line commands
  const individualCommands = cleanLines
    .map(l => safeGuardHangingCommands(l.trim()))
    .filter(Boolean);
  const cleanCommand = individualCommands.join(' && ');

  return {
    raw: rawCode,
    cleanCommand,
    individualCommands,
    hasMultipleCommands: individualCommands.length > 1,
    strippedComments
  };
}

/**
 * Simple helper to get the clean execution string directly.
 */
export function cleanCommandForExecution(rawCode: string): string {
  const parsed = parseShellCommands(rawCode);
  return safeGuardHangingCommands(parsed.cleanCommand);
}
