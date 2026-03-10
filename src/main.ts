import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';

// disable hardware acceleration to avoid GPU spikes when rendering chat
app.disableHardwareAcceleration();
import os from 'os';
// pty will be required at runtime to avoid bundler issues
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { crc32 } from './lib/crc32';
import {
  safeAppId,
  appDir as appDirUtil,
  loadSettings as loadSettingsUtil,
  saveSettings as saveSettingsUtil,
  saveSnapshot as saveSnapshotUtil,
  loadSnapshot as loadSnapshotUtil,
  deleteSnapshot as deleteSnapshotUtil,
  DEFAULT_SETTINGS,
} from './lib/mainUtils';
import type { DeyadSettings } from './lib/mainUtils';

// ── Auto-updater ──────────────────────────────────────────────────────────────
// update-electron-app checks for updates from GitHub Releases by default.
// It no-ops gracefully in dev mode or when no repository field is in package.json.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const updateElectronApp = require('update-electron-app');
  updateElectronApp({ updateInterval: '1 hour' });
} catch { /* auto-updater not available in dev — ignore */ }

const execFileAsync = promisify(execFile);

if (started) { app.quit(); }

const APPS_DIR = path.join(app.getPath('userData'), 'deyad-apps');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'deyad-settings.json');
const SNAPSHOTS_DIR = path.join(app.getPath('userData'), 'deyad-snapshots');
const DOCKER_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_GITIGNORE = 'node_modules/\ndist/\n.env\n*.log\ndeyad-messages.json\n';

// ── Security: appId sanitization ──────────────────────────────────────────────
// safeAppId and appDir imported from ./lib/mainUtils

/** Returns the verified absolute directory for an app. */
function appDir(appId: string): string {
  return appDirUtil(APPS_DIR, appId);
}

// ── Settings ──────────────────────────────────────────────────────────────────

// Settings: imported from ./lib/mainUtils, bound to SETTINGS_PATH

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

/** Tracks running `npm run dev` processes keyed by appId. */
const devProcesses = new Map<string, ChildProcess>();

/**
 * Returns the directory that contains the Vite project for an app.
 * For full-stack apps the Vite root is the `frontend/` subdirectory;
 * for frontend-only apps it is the app root itself.
 */
function getViteRoot(appId: string): string | null {
  const dir = appDir(appId);
  if (fs.existsSync(path.join(dir, 'frontend', 'vite.config.ts'))) {
    return path.join(dir, 'frontend');
  }
  if (fs.existsSync(path.join(dir, 'vite.config.ts'))) {
    return dir;
  }
  return null;
}

// Dev mode: set VITE_DEV_SERVER_URL env var to load from Vite dev server
// Production: loads the built renderer from .vite/renderer/main_window/

if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}


// ── Plugin infrastructure ─────────────────────────────────────────────────

interface PluginTemplate {
  name: string;
  description: string;
  icon: string;
  appType: 'frontend' | 'fullstack';
  prompt: string;
}
interface PluginManifest {
  name: string;
  description?: string;
  templates?: PluginTemplate[];
}

let loadedPlugins: PluginManifest[] = [];

function loadPlugins() {
  const pluginsDir = path.join(app.getPath('userData'), 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    return;
  }
  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pluginsDir, d.name));
  loadedPlugins = [];
  for (const dir of dirs) {
    const manifestPath = path.join(dir, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
        loadedPlugins.push(manifest);
      } catch {
        // ignore malformed
      }
    }
  }
}

// call early
app.whenReady().then(() => {
  loadPlugins();
});

// IPC to expose list
ipcMain.handle('plugins:list', () => loadedPlugins);

// ── Database inspection ───────────────────────────────────────────────────
ipcMain.handle('db:describe', (_event, appId: string) => {
  const dir = appDir(appId);
  const schemaPath = path.join(dir, 'backend', 'prisma', 'schema.prisma');
  const result: { tables: { name: string; columns: string[] }[] } = { tables: [] };
  if (!fs.existsSync(schemaPath)) return result;
  const text = fs.readFileSync(schemaPath, 'utf-8');
  const lines = text.split(/\r?\n/);
  let current: { name: string; columns: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^model\s+(\w+)/);
    if (m) {
      if (current) result.tables.push(current);
      current = { name: m[1], columns: [] };
      continue;
    }
    if (current) {
      if (/^}$/.test(line.trim())) {
        result.tables.push(current);
        current = null;
        continue;
      }
      const col = line.trim().split(' ')[0];
      if (col) current.columns.push(col);
    }
  }
  return result;
});

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
    },
  });

  // clear cache before loading to ensure latest CSS/JS is used
  mainWindow.webContents.session.clearCache().then(() => {
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

// ── AI (Ollama + Cloud Providers) ─────────────────────────────────────────────

async function listOllamaModels(): Promise<{ models: { name: string; modified_at: string; size: number; details?: Record<string, string> }[] }> {
  return new Promise((resolve, reject) => {
    const request = net.request(`${getOllamaBaseUrl()}/api/tags`);
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse Ollama response')); }
      });
    });
    request.on('error', (err: Error) => reject(new Error(`Ollama not reachable: ${err.message}`)));
    request.end();
  });
}

ipcMain.handle('ollama:list-models', async () => {
  return listOllamaModels();
});

/** Stream from Ollama (NDJSON format). */
function streamOllama(event: Electron.IpcMainInvokeEvent, model: string, messages: { role: string; content: string }[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: true });
    const request = net.request({ method: 'POST', url: `${getOllamaBaseUrl()}/api/chat` });
    let buffer = '';
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (!event.sender.isDestroyed()) event.sender.send('ollama:stream-done');
      resolve();
    };
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content && !event.sender.isDestroyed()) {
              event.sender.send('ollama:stream-token', parsed.message.content);
            }
            if (parsed.done) finish();
          } catch { /* skip malformed */ }
        }
      });
      response.on('end', () => finish());
    });
    request.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        if (!event.sender.isDestroyed()) event.sender.send('ollama:stream-error', err.message);
        reject(err);
      }
    });
    request.setHeader('Content-Type', 'application/json');
    request.write(body);
    request.end();
  });
}

ipcMain.handle('ollama:chat-stream', async (event, { model, messages }: { model: string; messages: { role: string; content: string }[] }) => {
  return streamOllama(event, model, messages);
});

/** Fill-in-the-middle completion for inline autocomplete. */
ipcMain.handle('ollama:fim-complete', async (_event, { model, prompt, suffix, stop }: { model: string; prompt: string; suffix?: string; stop?: string[] }) => {
  return new Promise<string>((resolve, reject) => {
    const body: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 128, stop: stop || ['\n\n', '```'] },
    };
    if (suffix) body.suffix = suffix;
    const request = net.request({ method: 'POST', url: `${getOllamaBaseUrl()}/api/generate` });
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || '');
        } catch { resolve(''); }
      });
    });
    request.on('error', (err: Error) => reject(err));
    request.setHeader('Content-Type', 'application/json');
    request.write(JSON.stringify(body));
    request.end();
  });
});

/** Generate embeddings via Ollama for codebase indexing. */
ipcMain.handle('ollama:embed', async (_event, { model, input }: { model: string; input: string | string[] }) => {
  return new Promise<{ embeddings: number[][] }>((resolve, reject) => {
    const body = JSON.stringify({ model, input });
    const request = net.request({ method: 'POST', url: `${getOllamaBaseUrl()}/api/embed` });
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ embeddings: parsed.embeddings || [] });
        } catch { resolve({ embeddings: [] }); }
      });
    });
    request.on('error', (err: Error) => reject(err));
    request.setHeader('Content-Type', 'application/json');
    request.write(body);
    request.end();
  });
});

// ── Git Helpers ───────────────────────────────────────────────────────────────

ipcMain.handle('git:show', async (_event, appId: string, hash: string, filePath: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  // Validate hash is hex-only to prevent injection
  if (!/^[0-9a-f]+$/i.test(hash)) return null;
  try {
    const { stdout } = await execFileAsync('git', ['show', `${hash}:${filePath}`], { cwd: dir, timeout: 10000 });
    return stdout;
  } catch { return null; }
});

ipcMain.handle('git:diff-stat', async (_event, appId: string, hash: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return [];
  if (!/^[0-9a-f]+$/i.test(hash)) return [];
  try {
    const { stdout } = await execFileAsync(
      'git', ['diff-tree', '--no-commit-id', '-r', '--name-status', hash],
      { cwd: dir, timeout: 10000 },
    );
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [status, ...parts] = line.split('\t');
      return { status, path: parts.join('\t') };
    });
  } catch { return []; }
});

ipcMain.handle('git:checkout', async (_event, appId: string, hash: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
  if (!/^[0-9a-f]+$/i.test(hash)) return { success: false, error: 'Invalid hash' };
  try {
    await execFileAsync('git', ['checkout', hash, '--', '.'], { cwd: dir, timeout: 10000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ── App Projects ────────────────────────────────────────────────────────────

ipcMain.handle('apps:list', () => {
  try {
    const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const metaPath = path.join(APPS_DIR, e.name, 'deyad.json');
        let meta: Record<string, unknown> = { name: e.name, description: '', createdAt: '', appType: 'frontend' };
        if (fs.existsSync(metaPath)) {
          try { meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) }; } catch { /* ignore */ }
        }
        // Backward compatibility: migrate isFullStack boolean to appType
        if (!meta.appType && 'isFullStack' in meta) {
          meta.appType = meta.isFullStack ? 'fullstack' : 'frontend';
        }
        return { id: e.name, ...meta };
      });
  } catch { return []; }
});

ipcMain.handle('apps:create', async (_event, { name, description, appType, dbProvider }: { name: string; description: string; appType: string; dbProvider?: string }) => {
  const id = `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const dir = path.join(APPS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const resolvedAppType = appType || 'frontend';
  const meta: Record<string, unknown> = {
    name,
    description,
    createdAt: new Date().toISOString(),
    appType: resolvedAppType,
  };
  if (resolvedAppType === 'fullstack' && dbProvider) {
    meta.dbProvider = dbProvider;
  }
  fs.writeFileSync(path.join(dir, 'deyad.json'), JSON.stringify(meta, null, 2));
  await gitInit(id);
  return { id, ...meta };
});

ipcMain.handle('apps:read-files', (_event, appId: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return {};
  const result: Record<string, string> = {};
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', '.next', '__pycache__']);
  const walk = (base: string, rel = '') => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const fullPath = path.join(base, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath, relPath);
      } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
        try { result[relPath] = fs.readFileSync(fullPath, 'utf-8'); } catch { /* skip binary */ }
      }
    }
  };
  walk(dir);
  return result;
});

ipcMain.handle('apps:write-files', async (_event, { appId, files }: { appId: string; files: Record<string, string> }) => {
  const dir = appDir(appId);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.resolve(dir, relPath);
    // Prevent path traversal — all files must stay inside the app directory
    if (!fullPath.startsWith(dir + path.sep) && fullPath !== dir) {
      throw new Error(`Invalid file path: ${relPath}`);
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  // Auto-commit if git is initialized
  await gitCommit(appId, `Update ${Object.keys(files).length} file(s)`);
  return true;
});

ipcMain.handle('apps:delete', async (_event, appId: string) => {
  // Stop dev server if running
  const proc = devProcesses.get(appId);
  if (proc) {
    proc.kill();
    devProcesses.delete(appId);
  }
  await stopCompose(appId).catch(() => {});
  const dir = appDir(appId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  // Clean up persisted snapshot
  deleteSnapshot(appId);
  return true;
});

ipcMain.handle('apps:get-dir', (_event, appId?: string) =>
  appId ? appDir(appId) : APPS_DIR,
);

ipcMain.handle('apps:open-folder', (_event, appId: string) => {
  shell.openPath(appDir(appId));
  return true;
});

ipcMain.handle('apps:rename', (_event, { appId, newName }: { appId: string; newName: string }) => {
  const metaPath = path.join(appDir(appId), 'deyad.json');
  if (!fs.existsSync(metaPath)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.name = newName;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return true;
  } catch { return false; }
});

ipcMain.handle('apps:save-messages', (_event, { appId, messages }: { appId: string; messages: unknown[] }) => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return false;
  try {
    fs.writeFileSync(path.join(dir, 'deyad-messages.json'), JSON.stringify(messages), 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('apps:load-messages', (_event, appId: string) => {
  const file = path.join(appDir(appId), 'deyad-messages.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
});

// ── Dev Server (Preview) ────────────────────────────────────────────────────

ipcMain.handle('apps:dev-start', async (event, appId: string) => {
  // Stop any existing dev process for this app first
  const existing = devProcesses.get(appId);
  if (existing) {
    existing.kill();
    devProcesses.delete(appId);
  }

  const viteRoot = getViteRoot(appId);
  if (!viteRoot) {
    return {
      success: false,
      error: 'No Vite project found. Chat with the AI to scaffold your app first.',
    };
  }

  const sendLog = (data: string) => {
    if (!event.sender.isDestroyed()) event.sender.send('apps:dev-log', { appId, data });
  };

  // Run npm install if node_modules is absent
  if (!fs.existsSync(path.join(viteRoot, 'node_modules'))) {
    sendLog('Installing dependencies…\n');
    try {
      await execFileAsync('npm', ['install'], { cwd: viteRoot, timeout: 180000 });
      sendLog('Dependencies installed\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `npm install failed: ${msg}` };
    }
  }

  // Spawn vite dev server
  const child = spawn('npm', ['run', 'dev'], { cwd: viteRoot, stdio: 'pipe' });
  devProcesses.set(appId, child);

  child.stdout?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
  child.on('close', () => {
    devProcesses.delete(appId);
    if (!event.sender.isDestroyed()) {
      event.sender.send('apps:dev-status', { appId, status: 'stopped' });
    }
  });

  event.sender.send('apps:dev-status', { appId, status: 'starting' });
  return { success: true };
});

ipcMain.handle('apps:dev-stop', async (event, appId: string) => {
  const proc = devProcesses.get(appId);
  if (proc) {
    proc.kill();
    devProcesses.delete(appId);
  }
  event.sender.send('apps:dev-status', { appId, status: 'stopped' });
  return { success: true };
});

ipcMain.handle('apps:dev-status', (_event, appId: string) => ({
  status: devProcesses.has(appId) ? 'running' : 'stopped',
}));

// ── Docker / MySQL ──────────────────────────────────────────────────────────

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: DOCKER_CHECK_TIMEOUT_MS });
    return true;
  } catch { return false; }
}

async function stopCompose(appId: string): Promise<void> {
  const dir = appDir(appId);
  const composeFile = path.join(dir, 'docker-compose.yml');
  if (fs.existsSync(composeFile)) {
    try {
      await execFileAsync('docker', ['compose', '-f', composeFile, 'down'], { timeout: 30000 });
    } catch { /* best-effort */ }
  }
}

ipcMain.handle('docker:check', async () => checkDockerAvailable());

ipcMain.handle('docker:db-start', async (event, appId: string) => {
  const dir = appDir(appId);
  const composeFile = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) {
    return { success: false, error: 'No docker-compose.yml found in app directory' };
  }
  try {
    await execFileAsync('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait'], { timeout: 120000 });
    event.sender.send('docker:db-status', { appId, status: 'running' });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

ipcMain.handle('docker:db-stop', async (event, appId: string) => {
  try {
    await stopCompose(appId);
    event.sender.send('docker:db-status', { appId, status: 'stopped' });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

ipcMain.handle('docker:db-status', async (_event, appId: string) => {
  const dir = appDir(appId);
  const composeFile = path.join(dir, 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) return { status: 'none' };
  try {
    const { stdout } = await execFileAsync(
      'docker', ['compose', '-f', composeFile, 'ps', '--format', 'json'],
      { timeout: 10000 },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    if (!lines.length) return { status: 'stopped' };
    const containers = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    const running = containers.some((c: { State?: string }) => c?.State === 'running');
    return { status: running ? 'running' : 'stopped' };
  } catch { return { status: 'stopped' }; }
});

// ── Settings ────────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => currentSettings);

ipcMain.handle('settings:set', (_event, settings: Partial<DeyadSettings>) => {
  currentSettings = { ...currentSettings, ...settings };
  saveSettings(currentSettings);
  return currentSettings;
});

// ── App Export (ZIP) ────────────────────────────────────────────────────────

ipcMain.handle('apps:export', async (_event, { appId, format }: { appId: string; format?: 'zip' | 'mobile' }) => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

  // Read app name for the suggested filename
  let appName = appId;
  const metaPath = path.join(dir, 'deyad.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.name) appName = meta.name;
    } catch { /* ignore */ }
  }

  const sanitized = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  if (format === 'mobile') {
    // For mobile export we want a directory rather than zip. Ask for folder.
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Select output directory for mobile export',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: appName,
    });
    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
    const outDir = filePaths[0];

    try {
      // copy all files from app dir to outDir/mobile (to avoid overwriting)
      const target = path.join(outDir, `${sanitized}-mobile`);
      fs.rmSync(target, { recursive: true, force: true });
      copyRecursiveSync(dir, target);
      // add minimal mobile boilerplate
      const indexHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${appName}</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="manifest.json"></head><body><div id="root"></div><script src="index.js"></script></body></html>`;
      fs.writeFileSync(path.join(target, 'index.html'), indexHtml, 'utf-8');
      const manifest = JSON.stringify({
        name: appName,
        short_name: appName,
        start_url: '.',
        display: 'standalone',
        background_color: '#ffffff',
        description: appName,
      }, null, 2);
      fs.writeFileSync(path.join(target, 'manifest.json'), manifest, 'utf-8');
      return { success: true, path: target };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  // default zip export
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: `${sanitized}.zip`,
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });

  if (canceled || !filePath) return { success: false, error: 'Cancelled' };

  try {
    // Build a zip using Node.js without additional dependencies.
    // We use a minimal zip builder that creates a valid ZIP file.
    const zipData = await buildZipBuffer(dir, appId);
    fs.writeFileSync(filePath, zipData);
    return { success: true, path: filePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

// helper to copy recursively (synchronous)
function copyRecursiveSync(src: string, dest: string) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ── Package Manager ────────────────────────────────────────────────────────

ipcMain.handle('npm:list', async (_event, appId: string) => {
  const dir = appDir(appId);
  const pkgPath = path.join(dir, 'package.json');
  // Also check frontend/ for fullstack apps
  const frontendPkg = path.join(dir, 'frontend', 'package.json');
  const targetPkg = fs.existsSync(pkgPath) ? pkgPath : fs.existsSync(frontendPkg) ? frontendPkg : null;
  if (!targetPkg) return { dependencies: {}, devDependencies: {} };
  try {
    const pkg = JSON.parse(fs.readFileSync(targetPkg, 'utf-8'));
    return {
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    };
  } catch { return { dependencies: {}, devDependencies: {} }; }
});

ipcMain.handle('npm:install', async (event, appId: string, packageName: string, isDev: boolean) => {
  const dir = appDir(appId);
  // Validate package name (alphanumeric, hyphens, slashes, @scopes)
  if (!/^(@[\w-]+\/)?[\w][\w.\-]*$/.test(packageName)) {
    return { success: false, error: 'Invalid package name' };
  }
  const viteRoot = getViteRoot(appId) || dir;
  const args = ['install', packageName];
  if (isDev) args.push('--save-dev');
  try {
    const { stdout, stderr } = await execFileAsync('npm', args, { cwd: viteRoot, timeout: 120000 });
    if (!event.sender.isDestroyed()) event.sender.send('npm:install-log', { appId, data: stdout + stderr });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('npm:uninstall', async (_event, appId: string, packageName: string) => {
  const dir = appDir(appId);
  if (!/^(@[\w-]+\/)?[\w][\w.\-]*$/.test(packageName)) {
    return { success: false, error: 'Invalid package name' };
  }
  const viteRoot = getViteRoot(appId) || dir;
  try {
    await execFileAsync('npm', ['uninstall', packageName], { cwd: viteRoot, timeout: 60000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// ── Environment Variables ────────────────────────────────────────────────────

ipcMain.handle('env:read', (_event, appId: string) => {
  const dir = appDir(appId);
  // Check multiple locations
  const envPaths = [
    path.join(dir, '.env'),
    path.join(dir, 'frontend', '.env'),
    path.join(dir, 'backend', '.env'),
  ];
  const result: Record<string, Record<string, string>> = {};
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const relName = path.relative(dir, envPath);
      const vars: Record<string, string> = {};
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          vars[key] = value;
        }
      }
      result[relName] = vars;
    }
  }
  return result;
});

ipcMain.handle('env:write', (_event, appId: string, envFile: string, vars: Record<string, string>) => {
  const dir = appDir(appId);
  const envPath = path.join(dir, envFile);
  // Verify the env path is within the app directory
  const resolved = path.resolve(envPath);
  if (!resolved.startsWith(path.resolve(dir))) return { success: false, error: 'Path traversal detected' };
  const content = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, 'utf-8');
  return { success: true };
});

// ── Terminal support ───────────────────────────────────────────────────────
// spawn a pseudo terminal and forward data events to renderer
const terminals = new Map<string, any>();

ipcMain.handle('terminal:start', (_event, { appId }: { appId?: string }) => {
  let pty;
  try {
    pty = require('node-pty');
  } catch {
    throw new Error('node-pty is not available. Rebuild native modules with electron-rebuild.');
  }
  const cwd = appId ? appDir(appId) : undefined;
  const shellPath = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
  const term = pty.spawn(shellPath, [], { cwd, env: process.env });
  const id = uuidv4();
  terminals.set(id, term);

  term.onData((data: string) => {
    _event.sender.send('terminal:data', { id, data });
  });
  term.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
    _event.sender.send('terminal:exit', { id, exitCode, signal });
    terminals.delete(id);
  });
  return id;
});
ipcMain.handle('terminal:write', (_event, { termId, data }: { termId: string; data: string }) => {
  const term = terminals.get(termId);
  if (term) term.write(data);
});

ipcMain.handle('terminal:resize', (_event, { termId, cols, rows }: { termId: string; cols: number; rows: number }) => {
  const term = terminals.get(termId);
  if (term) term.resize(cols, rows);
});

ipcMain.handle('terminal:kill', (_event, termId: string) => {
  const term = terminals.get(termId);
  if (term) {
    term.kill();
    terminals.delete(termId);
  }
});

ipcMain.handle('show-context-menu', (event, type?: 'terminal' | 'global') => {
  const { Menu } = require('electron');
  const template: any[] = [
    { label: 'Cut', role: 'cut' },
    { label: 'Copy', role: 'copy' },
    { label: 'Paste', role: 'paste' },
    { type: 'separator' },
    { label: 'Select All', role: 'selectAll' },
  ];
  if (type === 'terminal') {
    template.push({ type: 'separator' });
    template.push({ label: 'Clear', click: () => event.sender.send('terminal:clear') });
  }
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

/**
 * Builds a ZIP buffer from a directory using the Store method (no compression).
 * This is a minimal implementation that produces valid ZIP archives.
 */
async function buildZipBuffer(baseDir: string, _prefix: string): Promise<Buffer> {
  const entries: { name: string; data: Buffer }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
        try {
          entries.push({ name: relPath, data: fs.readFileSync(fullPath) });
        } catch { /* skip unreadable */ }
      }
    }
  };
  walk(baseDir, '');

  // Build ZIP in memory (Store method, no compression)
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8');
    // Local file header
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // compression (store)
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0, 12);          // mod date
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    nameBuffer.copy(local, 30);

    parts.push(local, entry.data);

    // Central directory entry
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centralDir.push(central);

    offset += local.length + entry.data.length;
  }

  const centralDirBuffer = Buffer.concat(centralDir);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirBuffer.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDirBuffer, endRecord]);
}

// ── Undo / Revert ───────────────────────────────────────────────────────────

/** Persists snapshots to disk so they survive app restarts. */
if (!fs.existsSync(SNAPSHOTS_DIR)) {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

function saveSnapshot(appId: string, files: Record<string, string>): void {
  saveSnapshotUtil(SNAPSHOTS_DIR, appId, files);
}

function loadSnapshot(appId: string): Record<string, string> | null {
  return loadSnapshotUtil(SNAPSHOTS_DIR, appId);
}

function deleteSnapshot(appId: string): void {
  deleteSnapshotUtil(SNAPSHOTS_DIR, appId);
}

ipcMain.handle('apps:snapshot', (_event, { appId, files }: { appId: string; files: Record<string, string> }) => {
  saveSnapshot(appId, files);
  return true;
});

ipcMain.handle('apps:has-snapshot', (_event, appId: string) => {
  return loadSnapshot(safeAppId(appId)) !== null;
});

ipcMain.handle('apps:revert', async (_event, appId: string) => {
  const snapshot = loadSnapshot(safeAppId(appId));
  if (!snapshot) return { success: false, error: 'No snapshot available' };

  const dir = appDir(appId);

  // Remove all current non-meta files
  const walk = (base: string) => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const fullPath = path.join(base, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
        try { fs.unlinkSync(fullPath); } catch { /* skip */ }
      }
    }
  };
  walk(dir);

  // Write snapshot files back
  for (const [relPath, content] of Object.entries(snapshot)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  deleteSnapshot(appId);
  return { success: true };
});

// ── Git Version Control ─────────────────────────────────────────────────────

async function gitInit(appId: string): Promise<void> {
  const dir = appDir(appId);
  if (fs.existsSync(path.join(dir, '.git'))) return;
  try {
    await execFileAsync('git', ['init'], { cwd: dir, timeout: 10000 });
    // Create a .gitignore
    fs.writeFileSync(path.join(dir, '.gitignore'), DEFAULT_GITIGNORE, 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
    await execFileAsync('git', ['commit', '-m', 'Initial scaffold'], { cwd: dir, timeout: 10000 });
  } catch { /* git may not be installed */ }
}

async function gitCommit(appId: string, message: string): Promise<void> {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return;
  try {
    await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
    // Check if there are changes to commit
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir, timeout: 10000 });
    if (stdout.trim()) {
      await execFileAsync('git', ['commit', '-m', message], { cwd: dir, timeout: 10000 });
    }
  } catch { /* git may not be installed */ }
}

ipcMain.handle('git:log', async (_event, appId: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return [];
  try {
    const { stdout } = await execFileAsync(
      'git', ['log', '--oneline', '--format=%H|%s|%ci', '-20'],
      { cwd: dir, timeout: 10000 },
    );
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
  } catch { return []; }
});

// ── Capacitor (Mobile) ──────────────────────────────────────────────────────

ipcMain.handle('apps:capacitor-init', async (_event, appId: string) => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

  // Read app name from deyad.json
  let appName = 'MyApp';
  let appType = 'frontend';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
    appName = meta.name || appName;
    appType = meta.appType || appType;
  } catch { /* use default */ }

  // For fullstack apps, Capacitor wraps the frontend/ subdirectory
  const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;
  if (!fs.existsSync(webDir)) return { success: false, error: 'Frontend directory not found' };

  const capId = appName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'com.deyad.app';

  // Check if already initialized
  if (fs.existsSync(path.join(webDir, 'capacitor.config.ts'))) {
    return { success: true, alreadyInitialized: true };
  }

  try {
    // Install Capacitor core + CLI + platforms
    await execFileAsync('npm', ['install', '@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'], { cwd: webDir, timeout: 120_000 });

    // Write capacitor.config.ts
    const capConfig = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.deyad.${capId}',
  appName: ${JSON.stringify(appName)},
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
`;
    fs.writeFileSync(path.join(webDir, 'capacitor.config.ts'), capConfig);

    // Build the web app first
    await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });

    // Add Android and iOS platforms
    await execFileAsync('npx', ['cap', 'add', 'android'], { cwd: webDir, timeout: 60_000 });
    await execFileAsync('npx', ['cap', 'add', 'ios'], { cwd: webDir, timeout: 60_000 }).catch(() => {
      // iOS only works on macOS — ignore the error on other platforms
    });

    // Sync web assets to native projects
    await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

ipcMain.handle('apps:capacitor-open', async (_event, appId: string, platform: 'android' | 'ios') => {
  const dir = appDir(appId);

  // Determine working directory (fullstack uses frontend/ subdir)
  let webDir = dir;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
    if (meta.appType === 'fullstack') webDir = path.join(dir, 'frontend');
  } catch { /* use root */ }

  try {
    // Rebuild and sync before opening
    await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
    await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });
    await execFileAsync('npx', ['cap', 'open', platform], { cwd: webDir, timeout: 30_000 });
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

// ── Deploy ──────────────────────────────────────────────────────────────────

ipcMain.handle('apps:deploy-check', async () => {
  // Check which deploy CLIs are available
  const checks: Record<string, boolean> = { netlify: false, vercel: false, surge: false, railway: false, flyio: false };
  const cliMap: Record<string, string[]> = {
    netlify: ['netlify', '--version'],
    vercel: ['vercel', '--version'],
    surge: ['surge', '--version'],
    railway: ['railway', '--version'],
    flyio: ['fly', 'version'],
  };
  for (const [key, cmd] of Object.entries(cliMap)) {
    try {
      await execFileAsync(cmd[0], cmd.slice(1), { timeout: 15_000 });
      checks[key] = true;
    } catch { /* not available */ }
  }
  return checks;
});

ipcMain.handle('apps:deploy', async (event, appId: string, provider: 'netlify' | 'vercel' | 'surge' | 'railway' | 'flyio') => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

  // Read app metadata
  let appType = 'frontend';
  let appName = 'deyad-app';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
    appType = meta.appType || appType;
    appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  } catch { /* use defaults */ }

  const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;

  const win = BrowserWindow.fromWebContents(event.sender);
  const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

  try {
    // Step 1: Build
    sendLog('Building project...\n');
    await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
    sendLog('Build complete.\n');

    const distDir = path.join(webDir, 'dist');
    if (!fs.existsSync(distDir)) return { success: false, error: 'Build output (dist/) not found' };

    // Step 2: Deploy based on provider
    let url = '';

    if (provider === 'netlify') {
      sendLog('Deploying to Netlify...\n');
      const { stdout } = await execFileAsync('npx', ['netlify', 'deploy', '--dir=dist', '--prod', '--json'], { cwd: webDir, timeout: 120_000 });
      try {
        const result = JSON.parse(stdout);
        url = result.deploy_url || result.url || '';
      } catch {
        // Try to extract URL from non-JSON output
        const match = stdout.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/);
        url = match?.[0] || '';
      }
    } else if (provider === 'vercel') {
      sendLog('Deploying to Vercel...\n');
      const { stdout } = await execFileAsync('npx', ['vercel', '--prod', '--yes'], { cwd: distDir, timeout: 120_000 });
      url = stdout.trim().split('\n').pop() || '';
    } else if (provider === 'surge') {
      sendLog('Deploying to Surge...\n');
      // Surge needs an index.html in the dir — copy index to 200.html for SPA routing
      const indexPath = path.join(distDir, 'index.html');
      const spaPath = path.join(distDir, '200.html');
      if (fs.existsSync(indexPath) && !fs.existsSync(spaPath)) {
        fs.copyFileSync(indexPath, spaPath);
      }
      const domain = `deyad-${appId.slice(0, 12)}.surge.sh`;
      const { stdout } = await execFileAsync('npx', ['surge', distDir, domain], { cwd: webDir, timeout: 120_000 });
      url = `https://${domain}`;
      sendLog(stdout);
    }

    sendLog(`\nDeployed! ${url}\n`);
    return { success: true, url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`\nDeploy failed: ${msg}\n`);
    return { success: false, error: msg };
  }
});

// ── Fullstack Deploy (Railway / Fly.io) ─────────────────────────────────────

ipcMain.handle('apps:deploy-fullstack', async (event, appId: string, provider: 'railway' | 'flyio') => {
  const dir = appDir(appId);
  if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

  let appName = 'deyad-app';
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
    appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  } catch { /* use default */ }

  const win = BrowserWindow.fromWebContents(event.sender);
  const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

  try {
    let url = '';

    if (provider === 'railway') {
      sendLog('Deploying fullstack app to Railway...\n');

      // Check if railway project already linked
      const hasRailway = fs.existsSync(path.join(dir, '.railway'));
      if (!hasRailway) {
        sendLog('Initializing Railway project...\n');
        await execFileAsync('railway', ['init', '--name', appName], { cwd: dir, timeout: 30_000 });
      }

      sendLog('Pushing to Railway (this may take a few minutes)...\n');
      const { stdout } = await execFileAsync('railway', ['up', '--detach'], { cwd: dir, timeout: 300_000 });
      sendLog(stdout);

      // Try to get the deployment URL
      try {
        const { stdout: domainOut } = await execFileAsync('railway', ['domain'], { cwd: dir, timeout: 15_000 });
        url = domainOut.trim();
        if (url && !url.startsWith('http')) url = `https://${url}`;
      } catch {
        url = '(check Railway dashboard for URL)';
      }
    } else if (provider === 'flyio') {
      sendLog('Deploying fullstack app to Fly.io...\n');

      // Check if fly.toml exists
      const hasFlyToml = fs.existsSync(path.join(dir, 'fly.toml'));
      if (!hasFlyToml) {
        sendLog('Launching new Fly.io app...\n');
        // Write a basic Dockerfile if none exists
        if (!fs.existsSync(path.join(dir, 'Dockerfile'))) {
          const dockerfile = `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN cd frontend && npm ci && npx vite build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/package*.json ./
RUN cd backend && npm ci --production
EXPOSE 3001
CMD ["node", "backend/src/index.js"]
`;
          fs.writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
          sendLog('Generated Dockerfile.\n');
        }

        await execFileAsync('fly', ['launch', '--name', appName, '--no-deploy', '--yes'], { cwd: dir, timeout: 60_000 });
      }

      sendLog('Deploying to Fly.io (this may take a few minutes)...\n');
      const { stdout } = await execFileAsync('fly', ['deploy'], { cwd: dir, timeout: 300_000 });
      sendLog(stdout);
      url = `https://${appName}.fly.dev`;
    }

    sendLog(`\nDeployed! ${url}\n`);
    return { success: true, url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`\nDeploy failed: ${msg}\n`);
    return { success: false, error: msg };
  }
});

// ── Project Import ──────────────────────────────────────────────────────────

ipcMain.handle('apps:import', async (_event, name: string) => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select a project folder to import',
  });
  if (canceled || !filePaths.length) return null;

  const srcDir = filePaths[0];
  const id = `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const destDir = path.join(APPS_DIR, id);
  fs.mkdirSync(destDir, { recursive: true });

  // Detect if it's a full-stack project (has backend/ and frontend/ dirs)
  const isFullStack = fs.existsSync(path.join(srcDir, 'backend')) && fs.existsSync(path.join(srcDir, 'frontend'));
  const appType = isFullStack ? 'fullstack' : 'frontend';

  // Copy files recursively (skip node_modules and .git)
  const copyDir = (src: string, dest: string) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  };
  copyDir(srcDir, destDir);

  // Write deyad.json metadata
  const meta = { name, description: `Imported from ${path.basename(srcDir)}`, createdAt: new Date().toISOString(), appType };
  fs.writeFileSync(path.join(destDir, 'deyad.json'), JSON.stringify(meta, null, 2));

  // Initialize git for the imported project
  await gitInit(id);

  return { id, ...meta };
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  // Kill all running dev servers
  for (const proc of devProcesses.values()) proc.kill();
  devProcesses.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
