/**
 * Shared error-handling helpers.
 *
 * TypeScript strict mode types caught errors as `unknown`. Use `errorMessage`
 * to safely extract a human-readable message instead of casting to `any`.
 */

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Normalize an unknown thrown value into a proper Error instance,
 * useful when forwarding errors to callbacks typed with Error.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(errorMessage(err));
}
