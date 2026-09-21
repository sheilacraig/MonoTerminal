/**
 * Cross-environment (browser + Node.js) unique ID generator.
 *
 * Prefers the Web Crypto API (`crypto.randomUUID`), which is available in
 * all modern browsers and Node.js 19+ (Node 18 exposes it behind a flag).
 * Falls back to a manual UUIDv4 built from `getRandomValues`, and finally
 * to a timestamp + random string only when no CSPRNG is reachable.
 */

function getWebCrypto(): Crypto | undefined {
  if (typeof globalThis !== 'undefined') {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
      return c;
    }
  }
  return undefined;
}

function uuidv4FromBytes(bytes: Uint8Array): string {
  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a unique identifier, optionally with a readable prefix.
 * Example: generateId('sess-') => 'sess-3f2a...-...'
 */
export function generateId(prefix = ''): string {
  const c = getWebCrypto();

  if (c && typeof c.randomUUID === 'function') {
    return prefix + c.randomUUID();
  }

  if (c) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return prefix + uuidv4FromBytes(bytes);
  }

  // Last resort (no CSPRNG available) — still collision-resistant in practice
  // thanks to the timestamp component, but not cryptographically strong.
  return (
    prefix +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}
