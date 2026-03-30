/**
 * Returns true when the renderer is running inside Electron and the
 * preload contextBridge has successfully exposed the `window.deyad` API.
 */
export function isElectronApp(): boolean {
  return typeof window !== 'undefined' && typeof window.deyad !== 'undefined';
}
