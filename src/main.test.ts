/**
 * main.ts is the Electron entry point — it cannot be imported in a Vitest environment
 * because it depends on Electron APIs (app, BrowserWindow, etc.) that don't exist in Node.
 *
 * This test validates the main.ts file structurally rather than executing it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainSrc = fs.readFileSync(path.resolve(__dirname, 'main.ts'), 'utf-8');

describe('main.ts (structural)', () => {
  it('imports electron modules', () => {
    expect(mainSrc).toContain("from 'electron'");
  });

  it('sets up uncaughtException handler', () => {
    expect(mainSrc).toContain("process.on('uncaughtException'");
  });

  it('sets up unhandledRejection handler', () => {
    expect(mainSrc).toContain("process.on('unhandledRejection'");
  });

  it('initializes electron-log', () => {
    expect(mainSrc).toContain('log.initialize()');
  });

  it('calls fixPath for desktop launcher compatibility', () => {
    expect(mainSrc).toContain('fixPath()');
  });

  it('creates browser window', () => {
    expect(mainSrc).toContain('new BrowserWindow');
  });

  it('registers IPC handlers', () => {
    expect(mainSrc).toContain('registerTerminalHandlers');
    expect(mainSrc).toContain('registerDockerHandlers');
  });

  it('sets up CSP headers', () => {
    expect(mainSrc).toContain('Content-Security-Policy');
  });

  it('validates appId via appDir utility', () => {
    expect(mainSrc).toContain('appDirUtil');
  });

  it('has no bare catch blocks', () => {
    const bareCatches = (mainSrc.match(/catch\s*{/g) || []).length;
    expect(bareCatches).toBe(0);
  });

  /* ── Directory and settings setup ──────────────────── */

  it('creates APPS_DIR from userData path', () => {
    expect(mainSrc).toContain("path.join(app.getPath('userData'), 'deyad-apps')");
  });

  it('creates SNAPSHOTS_DIR from userData path', () => {
    expect(mainSrc).toContain("path.join(app.getPath('userData'), 'deyad-snapshots')");
  });

  it('creates SETTINGS_PATH from userData path', () => {
    expect(mainSrc).toContain("path.join(app.getPath('userData'), 'deyad-settings.json')");
  });

  it('creates APPS_DIR if it does not exist', () => {
    expect(mainSrc).toContain("if (!fs.existsSync(APPS_DIR))");
    expect(mainSrc).toContain("fs.mkdirSync(APPS_DIR, { recursive: true })");
  });

  it('creates SNAPSHOTS_DIR if it does not exist', () => {
    expect(mainSrc).toContain("if (!fs.existsSync(SNAPSHOTS_DIR))");
    expect(mainSrc).toContain("fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })");
  });

  /* ── Settings management ───────────────────────────── */

  it('loads settings from file', () => {
    expect(mainSrc).toContain('loadSettingsUtil(SETTINGS_PATH)');
  });

  it('saves settings to file', () => {
    expect(mainSrc).toContain('saveSettingsUtil(SETTINGS_PATH, settings)');
  });

  it('getOllamaBaseUrl checks OLLAMA_HOST env var first', () => {
    expect(mainSrc).toContain('process.env.OLLAMA_HOST');
  });

  it('getOllamaBaseUrl falls back to settings ollamaHost', () => {
    expect(mainSrc).toContain('currentSettings.ollamaHost');
  });

  it('getOllamaBaseUrl falls back to DEFAULT_SETTINGS', () => {
    expect(mainSrc).toContain('DEFAULT_SETTINGS.ollamaHost');
  });

  /* ── IPC handler registration ──────────────────────── */

  it('registers all IPC handler modules', () => {
    expect(mainSrc).toContain('registerOllamaHandlers');
    expect(mainSrc).toContain('registerAppHandlers');
    expect(mainSrc).toContain('registerSettingsHandlers');
    expect(mainSrc).toContain('registerGitHandlers');
    expect(mainSrc).toContain('registerCapacitorHandlers');
    expect(mainSrc).toContain('registerDeployHandlers');
  });

  /* ── BrowserWindow configuration ───────────────────── */

  it('configures window with correct dimensions', () => {
    expect(mainSrc).toContain('width: 1280');
    expect(mainSrc).toContain('height: 820');
  });

  it('configures minimum window dimensions', () => {
    expect(mainSrc).toContain('minWidth: 200');
    expect(mainSrc).toContain('minHeight: 300');
  });

  it('sets context isolation and sandbox', () => {
    expect(mainSrc).toContain('contextIsolation: true');
    expect(mainSrc).toContain('sandbox: true');
  });

  it('disables nodeIntegration', () => {
    expect(mainSrc).toContain('nodeIntegration: false');
  });

  it('enables webviewTag', () => {
    expect(mainSrc).toContain('webviewTag: true');
  });

  it('uses preload.js for preload', () => {
    expect(mainSrc).toContain("path.join(__dirname, 'preload.js')");
  });

  it('clears cache before loading content', () => {
    expect(mainSrc).toContain('clearCache()');
  });

  /* ── Menu ──────────────────────────────────────────── */

  it('builds an application menu', () => {
    expect(mainSrc).toContain('buildAppMenu');
    expect(mainSrc).toContain('Menu.setApplicationMenu');
  });

  it('menu contains Help submenu', () => {
    expect(mainSrc).toContain("label: 'Help'");
  });

  it('menu links to GitHub Repository', () => {
    expect(mainSrc).toContain("label: 'GitHub Repository'");
    expect(mainSrc).toContain('https://github.com/theKennethy/Deyad');
  });

  it('menu links to Report an Issue', () => {
    expect(mainSrc).toContain("label: 'Report an Issue'");
    expect(mainSrc).toContain('https://github.com/theKennethy/Deyad/issues');
  });

  it('menu links to Releases', () => {
    expect(mainSrc).toContain("label: 'Releases'");
    expect(mainSrc).toContain('https://github.com/theKennethy/Deyad/releases');
  });

  it('menu has About Deyad dialog', () => {
    expect(mainSrc).toContain("label: 'About Deyad'");
    expect(mainSrc).toContain('dialog.showMessageBox');
  });

  /* ── Header stripping (security) ───────────────────── */

  it('strips x-frame-options for localhost only', () => {
    expect(mainSrc).toContain("'x-frame-options'");
    expect(mainSrc).toContain("url.startsWith('http://localhost:')");
  });

  it('strips CSP for Prisma Studio webviews', () => {
    expect(mainSrc).toContain("'content-security-policy'");
    expect(mainSrc).toContain('prisma-studio');
  });

  it('registers header stripping on Prisma Studio session partition', () => {
    expect(mainSrc).toContain("session.fromPartition('persist:prisma-studio')");
  });

  it('handles did-attach-webview for localhost requests', () => {
    expect(mainSrc).toContain("'did-attach-webview'");
    expect(mainSrc).toContain('onBeforeSendHeaders');
  });

  /* ── Content loading ───────────────────────────────── */

  it('loads custom HTML from argv if provided', () => {
    expect(mainSrc).toContain("process.argv");
    expect(mainSrc).toContain(".endsWith('.html')");
    expect(mainSrc).toContain("mainWindow.loadFile(path.resolve(customArg))");
  });

  it('loads from VITE_DEV_SERVER_URL in dev mode', () => {
    expect(mainSrc).toContain('VITE_DEV_SERVER_URL');
    expect(mainSrc).toContain('mainWindow.loadURL');
  });

  it('loads production index.html from renderer directory', () => {
    expect(mainSrc).toContain("'../renderer/main_window/index.html'");
  });

  /* ── App lifecycle ─────────────────────────────────── */

  it('creates window on app ready', () => {
    expect(mainSrc).toContain("app.on('ready'");
  });

  it('kills dev processes on window-all-closed', () => {
    expect(mainSrc).toContain("app.on('window-all-closed'");
    expect(mainSrc).toContain('getDevProcesses');
    expect(mainSrc).toContain('proc.kill()');
  });

  it('recreates window on activate (macOS)', () => {
    expect(mainSrc).toContain("app.on('activate'");
    expect(mainSrc).toContain('BrowserWindow.getAllWindows().length === 0');
  });

  it('quits on window-all-closed except macOS', () => {
    expect(mainSrc).toContain("process.platform !== 'darwin'");
    expect(mainSrc).toContain('app.quit()');
  });

  /* ── Auto-updater ──────────────────────────────────── */

  it('sets up auto-updater with 1 hour interval', () => {
    expect(mainSrc).toContain("updateInterval: '1 hour'");
  });

  it('forwards update events to renderer', () => {
    expect(mainSrc).toContain("'update:checking'");
    expect(mainSrc).toContain("'update:available'");
    expect(mainSrc).toContain("'update:not-available'");
    expect(mainSrc).toContain("'update:progress'");
    expect(mainSrc).toContain("'update:downloaded'");
    expect(mainSrc).toContain("'update:error'");
  });

  it('handles update:install via ipcMain', () => {
    expect(mainSrc).toContain("ipcMain.handle('update:install'");
    expect(mainSrc).toContain('quitAndInstall');
  });

  /* ── EPIPE handling ────────────────────────────────── */

  it('handles EPIPE on stdout and stderr', () => {
    expect(mainSrc).toContain("err?.code === 'EPIPE'");
    expect(mainSrc).toContain("process.stdout?.on?.('error'");
    expect(mainSrc).toContain("process.stderr?.on?.('error'");
  });

  /* ── Logging configuration ─────────────────────────── */

  it('configures log file size and format', () => {
    expect(mainSrc).toContain('maxSize = 5 * 1024 * 1024');
    expect(mainSrc).toContain("format = '{y}-{m}-{d} {h}:{i}:{s}.{ms}");
  });

  it('sets console log level to warn', () => {
    expect(mainSrc).toContain("console.level = 'warn'");
  });

  /* ── Misc ──────────────────────────────────────────── */

  it('disables hardware acceleration', () => {
    expect(mainSrc).toContain('app.disableHardwareAcceleration()');
  });

  it('suppresses GLib warnings via log-level switch', () => {
    expect(mainSrc).toContain("app.commandLine.appendSwitch('log-level', '3')");
  });

  it('quits on electron-squirrel-startup', () => {
    expect(mainSrc).toContain('if (started)');
    expect(mainSrc).toContain('app.quit()');
  });

  it('redirects console to electron-log', () => {
    expect(mainSrc).toContain('Object.assign(console, log.functions)');
  });

  it('imports mainUtils for settings and appDir', () => {
    expect(mainSrc).toContain("from './lib/mainUtils'");
    expect(mainSrc).toContain('loadSettings as loadSettingsUtil');
    expect(mainSrc).toContain('saveSettings as saveSettingsUtil');
  });

  it('sets background color for window', () => {
    expect(mainSrc).toContain("backgroundColor: '#0f172a'");
  });

  it('uses hiddenInset titleBarStyle', () => {
    expect(mainSrc).toContain("titleBarStyle: 'hiddenInset'");
  });
});
