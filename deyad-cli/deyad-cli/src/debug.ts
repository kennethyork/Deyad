/** Conditional debug logging — only outputs when DEYAD_DEBUG is set. */
export function debugLog(msg: string, ...args: unknown[]): void {
  if (process.env['DEYAD_DEBUG']) {
    console.error(`[deyad:debug] ${msg}`, ...args);
  }
}
