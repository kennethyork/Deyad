/**
 * Returns true when the renderer is running inside Electron and the
 * preload contextBridge has successfully exposed the `window.dyad` API.
 */
export function isElectronApp(): boolean {
  return typeof window !== 'undefined' && typeof window.dyad !== 'undefined';
}
