import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';
import { crc32 } from './lib/crc32';

const execFileAsync = promisify(execFile);

if (started) { app.quit(); }

const APPS_DIR = path.join(app.getPath('userData'), 'deyad-apps');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'deyad-settings.json');
const DOCKER_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_GITIGNORE = 'node_modules/\ndist/\n.env\n*.log\ndeyad-messages.json\n';

// ── Settings ──────────────────────────────────────────────────────────────────

interface DeyadSettings {
  ollamaHost: string;
  defaultModel: string;
}

const DEFAULT_SETTINGS: DeyadSettings = {
  ollamaHost: 'http://localhost:11434',
  defaultModel: '',
};

function loadSettings(): DeyadSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) };
    }
  } catch { /* ignore corrupt file */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: DeyadSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
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
  const dir = path.join(APPS_DIR, appId);
  if (fs.existsSync(path.join(dir, 'frontend', 'vite.config.ts'))) {
    return path.join(dir, 'frontend');
  }
  if (fs.existsSync(path.join(dir, 'vite.config.ts'))) {
    return dir;
  }
  return null;
}

if (!fs.existsSync(APPS_DIR)) {
  fs.mkdirSync(APPS_DIR, { recursive: true });
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// ── AI (Ollama) ───────────────────────────────────────────────────────────────

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
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              event.sender.send('ollama:stream-token', parsed.message.content);
            }
            if (parsed.done) {
              event.sender.send('ollama:stream-done');
              resolve();
            }
          } catch { /* skip malformed */ }
        }
      });
      response.on('end', () => { event.sender.send('ollama:stream-done'); resolve(); });
    });
    request.on('error', (err: Error) => {
      event.sender.send('ollama:stream-error', err.message);
      reject(err);
    });
    request.setHeader('Content-Type', 'application/json');
    request.write(body);
    request.end();
  });
}

ipcMain.handle('ollama:chat-stream', async (event, { model, messages }: { model: string; messages: { role: string; content: string }[] }) => {
  return streamOllama(event, model, messages);
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
  return { id, ...meta };
});

ipcMain.handle('apps:read-files', (_event, appId: string) => {
  const dir = path.join(APPS_DIR, appId);
  if (!fs.existsSync(dir)) return {};
  const result: Record<string, string> = {};
  const walk = (base: string, rel = '') => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const fullPath = path.join(base, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
        try { result[relPath] = fs.readFileSync(fullPath, 'utf-8'); } catch { /* skip binary */ }
      }
    }
  };
  walk(dir);
  return result;
});

ipcMain.handle('apps:write-files', async (_event, { appId, files }: { appId: string; files: Record<string, string> }) => {
  const dir = path.join(APPS_DIR, appId);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
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
  const dir = path.join(APPS_DIR, appId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
});

ipcMain.handle('apps:get-dir', (_event, appId?: string) =>
  appId ? path.join(APPS_DIR, appId) : APPS_DIR,
);

ipcMain.handle('apps:open-folder', (_event, appId: string) => {
  shell.openPath(path.join(APPS_DIR, appId));
  return true;
});

ipcMain.handle('apps:rename', (_event, { appId, newName }: { appId: string; newName: string }) => {
  const metaPath = path.join(APPS_DIR, appId, 'deyad.json');
  if (!fs.existsSync(metaPath)) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.name = newName;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return true;
  } catch { return false; }
});

ipcMain.handle('apps:save-messages', (_event, { appId, messages }: { appId: string; messages: unknown[] }) => {
  const dir = path.join(APPS_DIR, appId);
  if (!fs.existsSync(dir)) return false;
  try {
    fs.writeFileSync(path.join(dir, 'deyad-messages.json'), JSON.stringify(messages), 'utf-8');
    return true;
  } catch { return false; }
});

ipcMain.handle('apps:load-messages', (_event, appId: string) => {
  const file = path.join(APPS_DIR, appId, 'deyad-messages.json');
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

  const sendLog = (data: string) =>
    event.sender.send('apps:dev-log', { appId, data });

  // Run npm install if node_modules is absent
  if (!fs.existsSync(path.join(viteRoot, 'node_modules'))) {
    sendLog('📦 Installing dependencies…\n');
    try {
      await execFileAsync('npm', ['install'], { cwd: viteRoot, timeout: 180000 });
      sendLog('✅ Dependencies installed\n');
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
  const dir = path.join(APPS_DIR, appId);
  const composeFile = path.join(dir, 'docker-compose.yml');
  if (fs.existsSync(composeFile)) {
    try {
      await execFileAsync('docker', ['compose', '-f', composeFile, 'down'], { timeout: 30000 });
    } catch { /* best-effort */ }
  }
}

ipcMain.handle('docker:check', async () => checkDockerAvailable());

ipcMain.handle('docker:db-start', async (event, appId: string) => {
  const dir = path.join(APPS_DIR, appId);
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
  const dir = path.join(APPS_DIR, appId);
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

ipcMain.handle('apps:export', async (_event, appId: string) => {
  const dir = path.join(APPS_DIR, appId);
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

/**
 * Builds a ZIP buffer from a directory using the Store method (no compression).
 * This is a minimal implementation that produces valid ZIP archives.
 */
async function buildZipBuffer(baseDir: string, prefix: string): Promise<Buffer> {
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

/** Stores one snapshot per app — the state before the most recent AI write. */
const fileSnapshots = new Map<string, Record<string, string>>();

ipcMain.handle('apps:snapshot', (_event, { appId, files }: { appId: string; files: Record<string, string> }) => {
  fileSnapshots.set(appId, files);
  return true;
});

ipcMain.handle('apps:has-snapshot', (_event, appId: string) => {
  return fileSnapshots.has(appId);
});

ipcMain.handle('apps:revert', async (_event, appId: string) => {
  const snapshot = fileSnapshots.get(appId);
  if (!snapshot) return { success: false, error: 'No snapshot available' };

  const dir = path.join(APPS_DIR, appId);

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

  fileSnapshots.delete(appId);
  return { success: true };
});

// ── Git Version Control ─────────────────────────────────────────────────────

async function gitInit(appId: string): Promise<void> {
  const dir = path.join(APPS_DIR, appId);
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
  const dir = path.join(APPS_DIR, appId);
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
  const dir = path.join(APPS_DIR, appId);
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
