/**
 * Cross-platform path utilities for SFTP and local file trees.
 *
 * Normalizes all path separators to POSIX `/` so both Windows (e.g. `C:/Users/foo`)
 * and Linux/macOS (e.g. `/etc/nginx`) paths behave identically in the UI,
 * breadcrumbs, tree traversal and API calls.
 */

/**
 * Normalize path separators to `/` and strip redundant trailing slashes
 * (except for root `/` and Windows drive roots like `C:/`).
 */
export function normalizePath(p: string): string {
  if (!p) return '/';
  // Normalize backslashes to forward slashes
  let normalized = p.replace(/\\/g, '/');

  // Collapse consecutive slashes (except leading double slash for network shares)
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');

  // Handle Windows drive root: "C:" or "C:/"
  if (/^[a-zA-Z]:\/?$/.test(normalized)) {
    return `${normalized.slice(0, 2).toUpperCase()}/`;
  }

  // Preserve single root slash
  if (normalized === '/') return '/';

  // Strip trailing slash
  normalized = normalized.replace(/\/+$/, '');

  // If path starts with lowercase drive letter like c:/, uppercase the drive
  if (/^[a-z]:\//i.test(normalized)) {
    normalized = normalized[0].toUpperCase() + normalized.slice(1);
  }

  return normalized || '/';
}

/** Check if the path is a root directory (`/` or Windows drive root like `C:/`). */
export function isRootPath(p: string): boolean {
  const norm = normalizePath(p);
  return norm === '/' || /^[A-Z]:\/$/.test(norm);
}

/**
 * Get the parent directory path across platforms.
 *
 * Examples:
 *   /etc/nginx          -> /etc
 *   /etc                -> /
 *   /                   -> /
 *   C:/Users/name/docs  -> C:/Users/name
 *   C:/Users            -> C:/
 *   C:/                 -> C:/
 */
export function getParentPath(p: string): string {
  const norm = normalizePath(p);
  if (isRootPath(norm)) return norm;

  const lastSlash = norm.lastIndexOf('/');
  if (lastSlash === -1) return '/';
  if (lastSlash === 0) return '/';

  const parent = norm.substring(0, lastSlash);
  // If parent is drive letter like "C:", return "C:/"
  if (/^[A-Z]:$/.test(parent)) {
    return `${parent}/`;
  }

  return parent || '/';
}

/**
 * Safely join a base directory and one or more relative path segments.
 *
 * Examples:
 *   joinPath('/etc', 'nginx')             -> /etc/nginx
 *   joinPath('/', 'etc')                  -> /etc
 *   joinPath('C:/Users', 'name', 'test')  -> C:/Users/name/test
 *   joinPath('C:/', 'test')               -> C:/test
 */
export function joinPath(base: string, ...parts: string[]): string {
  let result = normalizePath(base);
  for (const part of parts) {
    if (!part) continue;
    const cleanPart = part.replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
    if (!cleanPart) continue;

    if (result === '/' || result.endsWith('/')) {
      result = `${result}${cleanPart}`;
    } else {
      result = `${result}/${cleanPart}`;
    }
  }
  return normalizePath(result);
}

/**
 * Get the basename (last path segment / file name) of a path.
 */
export function getBaseName(p: string): string {
  const norm = normalizePath(p);
  if (isRootPath(norm)) return norm;
  const lastSlash = norm.lastIndexOf('/');
  return lastSlash === -1 ? norm : norm.slice(lastSlash + 1);
}
