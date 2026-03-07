import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import started from 'electron-squirrel-startup';

const execFileAsync = promisify(execFile);

if (started) { app.quit(); }

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || 'http://localhost:11434';
const APPS_DIR = path.join(app.getPath('userData'), 'deyad-apps');
const DOCKER_CHECK_TIMEOUT_MS = 5000;

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

// ── Ollama ─────────────────────────────────────────────────────────────────

ipcMain.handle('ollama:list-models', async () => {
  return new Promise((resolve, reject) => {
    const request = net.request(`${OLLAMA_BASE_URL}/api/tags`);
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
});

ipcMain.handle('ollama:chat-stream', async (event, { model, messages }: { model: string; messages: { role: string; content: string }[] }) => {
  return new Promise<void>((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: true });
    const request = net.request({ method: 'POST', url: `${OLLAMA_BASE_URL}/api/chat` });
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
});

// ── App Projects ────────────────────────────────────────────────────────────

ipcMain.handle('apps:list', () => {
  try {
    const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const metaPath = path.join(APPS_DIR, e.name, 'deyad.json');
        let meta = { name: e.name, description: '', createdAt: '', isFullStack: false };
        if (fs.existsSync(metaPath)) {
          try { meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) }; } catch { /* ignore */ }
        }
        return { id: e.name, ...meta };
      });
  } catch { return []; }
});

ipcMain.handle('apps:create', (_event, { name, description, isFullStack }: { name: string; description: string; isFullStack: boolean }) => {
  const id = `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const dir = path.join(APPS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, description, createdAt: new Date().toISOString(), isFullStack: !!isFullStack };
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

ipcMain.handle('apps:write-files', (_event, { appId, files }: { appId: string; files: Record<string, string> }) => {
  const dir = path.join(APPS_DIR, appId);
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
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
