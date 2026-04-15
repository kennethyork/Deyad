import { app, BrowserWindow, session, Menu, shell, dialog, ipcMain } from 'electron';
import fixPath from 'fix-path';
import log from 'electron-log/main';

// ── Persistent logging via electron-log ───────────────────────────────────────
// Logs are written to:
//   Linux:   ~/.config/deyad/logs/
//   macOS:   ~/Library/Logs/deyad/
//   Windows: %USERPROFILE%\AppData\Roaming\deyad\logs\
log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB per log file
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {text}';
log.transports.console.level = 'warn'; // don't spam dev console

// Redirect console.error/warn so all warnings hit the log file too
Object.assign(console, log.functions);

// Fix PATH so commands (docker, podman, node, npm, git, ollama) are found
// when the app is launched from a desktop shortcut instead of a terminal.
fixPath();

// ── Global error handlers — catch any uncaught errors in the main process ────
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason);
});

// Prevent Electron main crashes when stdout/stderr are closed (EPIPE)
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE') return;
  throw err;
});
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE') return;
  throw err;
});

// Suppress GLib-GObject signal handler warnings on Linux (harmless Chromium/GTK noise)
app.commandLine.appendSwitch('log-level', '3');

// disable hardware acceleration to avoid GPU spikes when rendering chat
app.disableHardwareAcceleration();

import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';
import {
  appDir as appDirUtil,
  loadSettings as loadSettingsUtil,
  saveSettings as saveSettingsUtil,
  DEFAULT_SETTINGS,
} from './lib/mainUtils';
import type { DeyadSettings } from './lib/mainUtils';

// IPC handler modules (extracted from this file)
import { registerGitHandlers } from './main/ipcGit';
import { registerCapacitorHandlers } from './main/ipcCapacitor';
import { registerDeployHandlers } from './main/ipcDeploy';
import { registerOllamaHandlers } from './main/ipcOllama';
import { registerDockerHandlers } from './main/ipcDocker';
import { registerTerminalHandlers } from './main/ipcTerminal';
import { registerAppHandlers, getDevProcesses } from './main/ipcApps';
import { registerSettingsHandlers } from './main/ipcSettings';

// ── Auto-updater ──────────────────────────────────────────────────────────────
try {
   
  const mod = require('update-electron-app');
  const updateElectronApp = mod.updateElectronApp ?? mod.default ?? mod;
  updateElectronApp({
    updateInterval: '1 hour',
    logger: log,
  });
} catch (err) { log.debug('auto-updater not available in dev — ignore:', err); }

// Forward auto-update events to renderer for progress UI
try {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = log;
  autoUpdater.on?.('checking-for-update', () => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:checking'));
  });
  autoUpdater.on?.('update-available', (info: { version: string }) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:available', info.version));
  });
  autoUpdater.on?.('update-not-available', () => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:not-available'));
  });
  autoUpdater.on?.('download-progress', (progress: { percent: number }) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:progress', progress.percent));
  });
  autoUpdater.on?.('update-downloaded', (info: { version: string }) => {
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:downloaded', info.version));
  });
  autoUpdater.on?.('error', (err: Error) => {
    log.error('[auto-updater]', err);
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('update:error', err.message));
  });
  // IPC: allow renderer to trigger install-and-restart
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });
} catch (e) { console.debug('auto-updater not available:', e); }

if (started) { app.quit(); }

const APPS_DIR = path.join(app.getPath('userData'), 'deyad-apps');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'deyad-settings.json');
const SNAPSHOTS_DIR = path.join(app.getPath('userData'), 'deyad-snapshots');

/** Returns the verified absolute directory for an app. */
function appDir(appId: string): string {
  return appDirUtil(APPS_DIR, appId);
}

// ── Settings ──────────────────────────────────────────────────────────────────

function loadSettings(): DeyadSettings {
  return loadSettingsUtil(SETTINGS_PATH);
}

function saveSettings(settings: DeyadSettings): void {
  saveSettingsUtil(SETTINGS_PATH, settings);
}

let currentSettings = loadSettings();

function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_HOST || currentSettings.ollamaHost || DEFAULT_SETTINGS.ollamaHost;
}

if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

// ── Register all IPC handler modules ────────────────────────────────────────

registerOllamaHandlers(getOllamaBaseUrl);
registerDockerHandlers(appDir);
registerTerminalHandlers(appDir);
registerAppHandlers(appDir, APPS_DIR, SNAPSHOTS_DIR);
registerSettingsHandlers(
  appDir,
  () => currentSettings,
  (s: DeyadSettings) => { currentSettings = s; saveSettings(s); },
);
registerGitHandlers(appDir);
registerCapacitorHandlers(appDir);
registerDeployHandlers(appDir);


// ── Application Menu ────────────────────────────────────────────────────────

function buildAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/theKennethy/Deyad'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/theKennethy/Deyad/issues'),
        },
        {
          label: 'Releases',
          click: () => shell.openExternal('https://github.com/theKennethy/Deyad/releases'),
        },
        { type: 'separator' },
        {
          label: 'About Deyad',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Deyad',
              message: 'Deyad',
              detail: 'Local AI app builder powered by Ollama models.\n\nhttps://github.com/theKennethy/Deyad',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Window Creation ─────────────────────────────────────────────────────────

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    // allow extremely small windows (e.g. tiny monitors / remote displays)
    minWidth: 200,
    minHeight: 300,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  // clear cache before loading to ensure latest CSS/JS is used
  mainWindow.webContents.session.clearCache().then(() => {

    // Enforce Content Security Policy (WCAG + OWASP best practice)
    mainWindow.webContents.session.webRequest.onHeadersReceived(
      { urls: ['file://*', 'http://localhost:*/*'] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline'; " +
              "worker-src 'self' blob:; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*; " +
              "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:*; " +
              "font-src 'self' data:; " +
              "frame-src http://localhost:* http://127.0.0.1:*;"
            ],
          },
        });
      },
    );

    // Helper: register header stripping on a session so embedded webviews
    // (Prisma Studio etc.) can load without X-Frame-Options / CSP blocking.
    // SECURITY: Only strips headers for localhost origins — external sites
    // retain their full CSP and X-Frame-Options protections.
    const registerHeaderStripping = (ses: Electron.Session) => {
      ses.webRequest.onHeadersReceived(
        { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'] },
        (details, callback) => {
          const url = details.url;
          if (!url.startsWith('http://localhost:') && !url.startsWith('http://127.0.0.1:')) {
            callback({ cancel: false });
            return;
          }
          const headers = { ...details.responseHeaders };
          for (const key of Object.keys(headers)) {
            const lk = key.toLowerCase();
            if (lk === 'x-frame-options') delete headers[key];
            // Remove CSP to allow Prisma Studio UI to render correctly in webviews
            if (lk === 'content-security-policy') delete headers[key];
          }
          callback({ responseHeaders: headers });
        },
      );
    };

    // Strip headers on the main session
    registerHeaderStripping(mainWindow.webContents.session);

    // Prisma Studio webview partition – strip headers
    const prismaStudioSession = session.fromPartition('persist:prisma-studio');
    registerHeaderStripping(prismaStudioSession);

    // When a webview is attached, ensure its session allows requests from localhost
    mainWindow.webContents.on('did-attach-webview', (_event, webContents) => {
      webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['http://localhost:*/*'] },
        (details, callback) => {
          callback({ requestHeaders: details.requestHeaders });
        },
      );
    });

    // allow launching a specific HTML file (e.g. vanilla/index.html)
    const customArg = process.argv.slice(1).find((a) => a.endsWith('.html'));
    if (customArg) {
      // relative paths supplied from project root
      mainWindow.loadFile(path.resolve(customArg));
    } else if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      mainWindow.loadFile(
        path.join(__dirname, '../renderer/main_window/index.html'),
      );
    }
  });
};

// ── Lifecycle ───────────────────────────────────────────────────────────────

app.on('ready', () => {
  buildAppMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  const devProcesses = getDevProcesses();
  for (const proc of devProcesses.values()) proc.kill();
  devProcesses.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

