import { HostAsset } from '../types';

export interface ParsedQuickConnect {
  username: string;
  host: string;
  port: number;
  name: string;
}

/**
 * Parse quick connect expressions supported by the Left Session Dock:
 * - `root@10.0.1.24`
 * - `root@host:2222`
 * - `ssh -p 2222 user@host`
 * - `ssh user@host -p 2222`
 * - `10.0.1.30:22`
 * - `10.0.1.30`
 */
export function parseQuickConnect(raw: string): ParsedQuickConnect | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let working = trimmed;
  let port = 22;

  // Strip leading `ssh ` if present
  if (/^ssh\s+/i.test(working)) {
    working = working.replace(/^ssh\s+/i, '').trim();
  }

  // Extract `-p <port>` flag anywhere in the string
  const portFlagMatch = working.match(/(?:^|\s)-p\s*(\d+)(?:\s|$)/i);
  if (portFlagMatch) {
    const parsedPort = parseInt(portFlagMatch[1], 10);
    if (parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort;
    }
    working = working.replace(portFlagMatch[0], ' ').trim();
  }

  // Take the first remaining non-flag token as [user@]host[:port]
  const tokens = working.split(/\s+/).filter(t => t && !t.startsWith('-'));
  if (tokens.length === 0) return null;

  const target = tokens[0];
  let username = 'root';
  let hostPart = target;

  const atIndex = target.lastIndexOf('@');
  if (atIndex > 0) {
    username = target.slice(0, atIndex).trim() || 'root';
    hostPart = target.slice(atIndex + 1).trim();
  }

  if (!hostPart) return null;

  // Check for `:port` suffix on hostPart (avoid breaking IPv6 unless bracketed)
  const colonIndex = hostPart.lastIndexOf(':');
  if (colonIndex > 0 && hostPart.indexOf(':') === colonIndex) {
    const maybePort = hostPart.slice(colonIndex + 1).trim();
    const hostOnly = hostPart.slice(0, colonIndex).trim();
    if (/^\d+$/.test(maybePort)) {
      const p = parseInt(maybePort, 10);
      if (p > 0 && p <= 65535) {
        port = p;
      }
      hostPart = hostOnly;
    }
  }

  if (!hostPart) return null;

  return {
    username,
    host: hostPart,
    port,
    name: `${username}@${hostPart}${port !== 22 ? `:${port}` : ''}`
  };
}

/**
 * Format a standard SSH CLI command for a host asset.
 */
export function formatSshCommand(
  host: Pick<HostAsset, 'host' | 'port' | 'username' | 'authType'>,
  platformHint?: string
): string {
  if (host.authType === 'local') {
    const isWin =
      platformHint !== undefined
        ? /win/i.test(platformHint)
        : typeof navigator !== 'undefined'
          ? /win/i.test(navigator.userAgent || navigator.platform || '')
          : typeof process !== 'undefined' && process.platform === 'win32';
    return isWin ? 'powershell' : '$SHELL';
  }
  const user = host.username || 'root';
  const targetHost = host.host || '127.0.0.1';
  const port = host.port || 22;
  if (port !== 22 && port > 0) {
    return `ssh -p ${port} ${user}@${targetHost}`;
  }
  return `ssh ${user}@${targetHost}`;
}

/**
 * Normalize legacy group names so local shell groups cleanly under `本机终端`.
 */
export function normalizeHostGroup(host: Pick<HostAsset, 'group' | 'authType'>): string {
  const g = (host.group || '').trim();
  if (!g || g === '本地' || g === '内置' || g === '演示' || g === '本机与沙盒') {
    if (host.authType === 'local') {
      return '本机终端';
    }
    return g || '默认分组';
  }
  return g;
}
