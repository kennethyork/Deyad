/**
 * Generates a cryptographically random password of the given length
 * using URL-safe characters (A-Z, a-z, 0-9, -, _).
 */
export function generatePassword(length = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  // Use crypto.getRandomValues in browser/renderer; Math.random fallback is NOT used —
  // this code only runs in the Electron renderer context where crypto is available.
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}
