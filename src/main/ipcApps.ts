/**
 * App lifecycle IPC handlers: CRUD, dev server, export, import, snapshots.
 */

import { dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import nodeNet from 'node:net';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { crc32 } from '../lib/crc32';
import {
  safeAppId,
  saveSnapshot as saveSnapshotUtil,
  loadSnapshot as loadSnapshotUtil,
  deleteSnapshot as deleteSnapshotUtil,
} from '../lib/mainUtils';
import { gitInit, gitCommit } from './ipcGit';

const execFileAsync = promisify(execFile);

/** Tracks running `npm run dev` processes keyed by appId. */
const devProcesses = new Map<string, ChildProcess>();

export function getDevProcesses(): typeof devProcesses {
  return devProcesses;
}

/**
 * Returns the directory that contains the Vite project for an app.
 * For full-stack apps the Vite root is the `frontend/` subdirectory;
 * for frontend-only apps it is the app root itself.
 */
export function getViteRoot(appDir: (id: string) => string, appId: string): string | null {
  const dir = appDir(appId);
  if (fs.existsSync(path.join(dir, 'frontend', 'vite.config.ts'))) {
    return path.join(dir, 'frontend');
  }
  if (fs.existsSync(path.join(dir, 'vite.config.ts'))) {
    return dir;
  }
  return null;
}

// ── Port Allocation ─────────────────────────────────────────────────────────

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = nodeNet.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function allocateAppPorts(appId: string): Promise<[number, number]> {
  let h = 0;
  for (let i = 0; i < appId.length; i++) {
    h = ((h << 5) - h + appId.charCodeAt(i)) | 0;
  }
  let dbPort = ((h >>> 0) % 50000) + 10000;
  for (let attempt = 0; attempt < 100; attempt++) {
    const guiPort = dbPort + 1;
    const [dbFree, guiFree] = await Promise.all([isPortFree(dbPort), isPortFree(guiPort)]);
    if (dbFree && guiFree) return [dbPort, guiPort];
    dbPort = ((dbPort - 10000 + 2) % 50000) + 10000;
  }
  throw new Error('Could not find two free consecutive ports after 100 attempts');
}

// ── ZIP builder ─────────────────────────────────────────────────────────────

async function buildZipBuffer(baseDir: string): Promise<Buffer> {
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
        } catch (err) { console.debug('skip unreadable:', err); }
      }
    }
  };
  walk(baseDir, '');

  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8');
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuffer.copy(local, 30);
    parts.push(local, entry.data);

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

function copyRecursiveSync(src: string, dest: string) {
  const stats = fs.existsSync(src) ? fs.statSync(src) : null;
  if (stats?.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      if (childItemName === 'node_modules' || childItemName === '.git') return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ── Runtime Detection & Auto-Install ────────────────────────────────────────

/** Check if a command exists on the system. */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(cmd, ['--version'], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Detect the OS package manager available. */
function detectPkgManager(): 'apt' | 'brew' | 'dnf' | 'pacman' | 'winget' | null {
  const platform = process.platform;
  if (platform === 'win32') return 'winget';
  if (platform === 'darwin') {
    try { fs.accessSync('/opt/homebrew/bin/brew', fs.constants.X_OK); return 'brew'; } catch {}
    try { fs.accessSync('/usr/local/bin/brew', fs.constants.X_OK); return 'brew'; } catch {}
    return null;
  }
  // Linux: try common package managers
  for (const pm of ['apt', 'dnf', 'pacman'] as const) {
    try { fs.accessSync(`/usr/bin/${pm}`, fs.constants.X_OK); return pm; } catch {}
  }
  return null;
}

/**
 * Ensure Python 3 is installed. If not, install it via the OS package manager.
 * Returns the path to the python3 binary, or null if installation failed.
 */
async function ensurePython(sendLog: (msg: string) => void): Promise<string | null> {
  // Try common Python binary names
  for (const cmd of ['python3', 'python']) {
    if (await commandExists(cmd)) {
      try {
        const { stdout } = await execFileAsync(cmd, ['--version'], { timeout: 10000 });
        sendLog(`Found ${stdout.trim()}\n`);
      } catch { /* ignore */ }
      return cmd;
    }
  }

  sendLog('Python not found — installing automatically…\n');
  const pm = detectPkgManager();
  if (!pm) {
    sendLog('Error: Could not detect package manager. Please install Python 3.10+ manually.\n');
    return null;
  }

  try {
    switch (pm) {
      case 'apt':
        await execFileAsync('sudo', ['apt', 'update'], { timeout: 60000 });
        await execFileAsync('sudo', ['apt', 'install', '-y', 'python3', 'python3-venv', 'python3-pip'], { timeout: 300000 });
        break;
      case 'dnf':
        await execFileAsync('sudo', ['dnf', 'install', '-y', 'python3', 'python3-pip'], { timeout: 300000 });
        break;
      case 'pacman':
        await execFileAsync('sudo', ['pacman', '-S', '--noconfirm', 'python', 'python-pip'], { timeout: 300000 });
        break;
      case 'brew':
        await execFileAsync('brew', ['install', 'python@3.11'], { timeout: 300000 });
        break;
      case 'winget':
        await execFileAsync('winget', ['install', '--id', 'Python.Python.3.11', '-e', '--accept-source-agreements', '--accept-package-agreements'], { timeout: 300000 });
        break;
    }
    sendLog('Python installed successfully.\n');
    // Verify it's now available
    for (const cmd of ['python3', 'python']) {
      if (await commandExists(cmd)) return cmd;
    }
    sendLog('Warning: Python was installed but the command is not in PATH. You may need to restart Deyad.\n');
    return 'python3';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`Error installing Python: ${msg}\n`);
    sendLog('Please install Python 3.10+ manually from https://python.org\n');
    return null;
  }
}

/**
 * Ensure Node.js is installed. If not, install it via the OS package manager.
 * Returns the path to the node binary, or null if installation failed.
 */
async function ensureNode(sendLog: (msg: string) => void): Promise<string | null> {
  if (await commandExists('node')) {
    try {
      const { stdout } = await execFileAsync('node', ['--version'], { timeout: 10000 });
      sendLog(`Found Node.js ${stdout.trim()}\n`);
    } catch { /* ignore */ }
    return 'node';
  }

  sendLog('Node.js not found \u2014 installing automatically\u2026\n');
  const pm = detectPkgManager();
  if (!pm) {
    sendLog('Error: Could not detect package manager. Please install Node.js 18+ manually.\n');
    return null;
  }

  try {
    switch (pm) {
      case 'apt':
        await execFileAsync('sudo', ['apt', 'update'], { timeout: 60000 });
        await execFileAsync('sudo', ['apt', 'install', '-y', 'nodejs', 'npm'], { timeout: 300000 });
        break;
      case 'dnf':
        await execFileAsync('sudo', ['dnf', 'install', '-y', 'nodejs', 'npm'], { timeout: 300000 });
        break;
      case 'pacman':
        await execFileAsync('sudo', ['pacman', '-S', '--noconfirm', 'nodejs', 'npm'], { timeout: 300000 });
        break;
      case 'brew':
        await execFileAsync('brew', ['install', 'node'], { timeout: 300000 });
        break;
      case 'winget':
        await execFileAsync('winget', ['install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--accept-source-agreements', '--accept-package-agreements'], { timeout: 300000 });
        break;
    }
    sendLog('Node.js installed successfully.\n');
    if (await commandExists('node')) return 'node';
    sendLog('Warning: Node.js was installed but the command is not in PATH. You may need to restart Deyad.\n');
    return 'node';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`Error installing Node.js: ${msg}\n`);
    sendLog('Please install Node.js 18+ manually from https://nodejs.org\n');
    return null;
  }
}

/**
 * Ensure Go is installed. If not, install it via the OS package manager.
 * Returns the path to the go binary, or null if installation failed.
 */
async function ensureGo(sendLog: (msg: string) => void): Promise<string | null> {
  if (await commandExists('go')) {
    try {
      const { stdout } = await execFileAsync('go', ['version'], { timeout: 10000 });
      sendLog(`Found ${stdout.trim()}\n`);
    } catch { /* ignore */ }
    return 'go';
  }

  sendLog('Go not found — installing automatically…\n');
  const pm = detectPkgManager();
  if (!pm) {
    sendLog('Error: Could not detect package manager. Please install Go 1.22+ manually.\n');
    return null;
  }

  try {
    switch (pm) {
      case 'apt':
        // Use the official Go installer for a recent version on apt-based systems
        await execFileAsync('sudo', ['apt', 'update'], { timeout: 60000 });
        await execFileAsync('sudo', ['apt', 'install', '-y', 'golang-go'], { timeout: 300000 });
        break;
      case 'dnf':
        await execFileAsync('sudo', ['dnf', 'install', '-y', 'golang'], { timeout: 300000 });
        break;
      case 'pacman':
        await execFileAsync('sudo', ['pacman', '-S', '--noconfirm', 'go'], { timeout: 300000 });
        break;
      case 'brew':
        await execFileAsync('brew', ['install', 'go'], { timeout: 300000 });
        break;
      case 'winget':
        await execFileAsync('winget', ['install', '--id', 'GoLang.Go', '-e', '--accept-source-agreements', '--accept-package-agreements'], { timeout: 300000 });
        break;
    }
    sendLog('Go installed successfully.\n');
    if (await commandExists('go')) return 'go';
    sendLog('Warning: Go was installed but the command is not in PATH. You may need to restart Deyad.\n');
    return 'go';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendLog(`Error installing Go: ${msg}\n`);
    sendLog('Please install Go 1.22+ manually from https://go.dev/dl\n');
    return null;
  }
}

// ── Deprecated @types/ packages that no longer exist on npm ─────────────────

/** Packages that bundle their own types — @types/ versions are deprecated/removed. */
const DEPRECATED_TYPES = new Set([
  '@types/react-router-dom', '@types/react-router', '@types/react-query',
  '@types/zustand', '@types/framer-motion', '@types/immer',
  '@types/zod', '@types/yup', '@types/jotai', '@types/valtio',
  '@types/next', '@types/prisma', '@types/hono', '@types/elysia',
  '@types/vitest', '@types/lucide-react', '@types/date-fns', '@types/dayjs',
  '@types/clsx', '@types/tailwind-merge', '@types/three',
  '@types/axios', '@types/ky', '@types/got',
]);

/**
 * Remove deprecated @types/ packages from a project's package.json before npm install.
 * This prevents ETARGET errors when the AI adds @types/ for packages that bundle own types.
 */
function sanitizePackageJson(projectDir: string, sendLog: (msg: string) => void): void {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw);
    let changed = false;
    for (const section of ['dependencies', 'devDependencies']) {
      if (!pkg[section]) continue;
      for (const dep of Object.keys(pkg[section])) {
        if (DEPRECATED_TYPES.has(dep)) {
          sendLog(`Removing deprecated ${dep} (package ships its own types)\n`);
          delete pkg[section][dep];
          changed = true;
        }
      }
    }
    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    }
  } catch { /* ignore parse errors */ }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerAppHandlers(
  appDir: (id: string) => string,
  APPS_DIR: string,
  SNAPSHOTS_DIR: string,
): void {
  // Snapshot helpers bound to the snapshots directory
  function saveSnapshot(appId: string, files: Record<string, string>): void {
    saveSnapshotUtil(SNAPSHOTS_DIR, appId, files);
  }
  function loadSnapshot(appId: string): Record<string, string> | null {
    return loadSnapshotUtil(SNAPSHOTS_DIR, appId);
  }
  function deleteSnapshot(appId: string): void {
    deleteSnapshotUtil(SNAPSHOTS_DIR, appId);
  }

  // ── App CRUD ──────────────────────────────────────────────────────────────

  ipcMain.handle('apps:list', () => {
    try {
      const entries = fs.readdirSync(APPS_DIR, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => {
          const metaPath = path.join(APPS_DIR, e.name, 'deyad.json');
          let meta: Record<string, unknown> = { name: e.name, description: '', createdAt: '', appType: 'frontend' };
          if (fs.existsSync(metaPath)) {
            try { meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) }; } catch (err) { console.debug('ignore:', err); }
          }
          if (!meta.appType && 'isFullStack' in meta) {
            meta.appType = meta.isFullStack ? 'fullstack' : 'frontend';
          }
          return { id: e.name, ...meta };
        });
    } catch (err) { console.debug('Handled error:', err); return []; }
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
    if (resolvedAppType === 'fullstack') {
      meta.dbProvider = 'sqlite';
    }
    fs.writeFileSync(path.join(dir, 'deyad.json'), JSON.stringify(meta, null, 2));

    // Pre-install runtimes in the background so they're ready before first preview
    const silentLog = (msg: string) => console.log(`[runtime-setup] ${msg.trim()}`);
    if (resolvedAppType === 'python') {
      ensurePython(silentLog).catch((err) => console.debug('python pre-install:', err));
    } else if (resolvedAppType === 'go') {
      ensureGo(silentLog).catch((err) => console.debug('go pre-install:', err));
    } else {
      ensureNode(silentLog).catch((err) => console.debug('node pre-install:', err));
    }

    await gitInit(appDir, id);
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
          try { result[relPath] = fs.readFileSync(fullPath, 'utf-8'); } catch (err) { console.debug('skip binary:', err); }
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
      if (!fullPath.startsWith(dir + path.sep) && fullPath !== dir) {
        throw new Error(`Invalid file path: ${relPath}`);
      }
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
    await gitCommit(appDir, appId, `Update ${Object.keys(files).length} file(s)`);
    return true;
  });

  ipcMain.handle('apps:delete-files', async (_event, { appId, paths: filePaths }: { appId: string; paths: string[] }) => {
    const dir = appDir(appId);
    for (const relPath of filePaths) {
      const fullPath = path.resolve(dir, relPath);
      if (!fullPath.startsWith(dir + path.sep) && fullPath !== dir) {
        throw new Error(`Invalid file path: ${relPath}`);
      }
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await gitCommit(appDir, appId, `Delete ${filePaths.length} file(s)`);
    return true;
  });

  ipcMain.handle('apps:delete', async (_event, appId: string) => {
    const proc = devProcesses.get(appId);
    if (proc) {
      proc.kill();
      devProcesses.delete(appId);
    }
    const dir = appDir(appId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
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
    } catch (err) { console.debug('Handled error:', err); return false; }
  });

  ipcMain.handle('apps:save-messages', (_event, { appId, messages }: { appId: string; messages: unknown[] }) => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return false;
    try {
      fs.writeFileSync(path.join(dir, 'deyad-messages.json'), JSON.stringify(messages), 'utf-8');
      return true;
    } catch (err) { console.debug('Handled error:', err); return false; }
  });

  ipcMain.handle('apps:load-messages', (_event, appId: string) => {
    const file = path.join(appDir(appId), 'deyad-messages.json');
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
    catch (err) { console.debug('Handled error:', err); return []; }
  });

  // ── Dev Server (Preview) ──────────────────────────────────────────────────

  ipcMain.handle('apps:dev-start', async (event, appId: string) => {
    const existing = devProcesses.get(appId);
    if (existing) {
      existing.kill();
      devProcesses.delete(appId);
    }

    const viteRoot = getViteRoot(appDir, appId);
    if (!viteRoot) {
      return {
        success: false,
        error: 'No Vite project found. Chat with the AI to scaffold your app first.',
      };
    }

    const sendLog = (data: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('apps:dev-log', { appId, data });
    };

    const appRoot = appDir(appId);
    const backendDir = path.join(appRoot, 'backend');
    const isFullstack = fs.existsSync(backendDir) && fs.existsSync(path.join(appRoot, 'docker-compose.yml'));

    // Detect project language from deyad.json or file markers
    let projectLang = 'node';
    try {
      const metaPath = path.join(appRoot, 'deyad.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.appType === 'python') projectLang = 'python';
        else if (meta.appType === 'go') projectLang = 'go';
      }
    } catch { /* ignore */ }
    // Fallback: detect from files
    if (projectLang === 'node') {
      if (fs.existsSync(path.join(appRoot, 'go.mod'))) projectLang = 'go';
      else if (fs.existsSync(path.join(appRoot, 'requirements.txt')) || fs.existsSync(path.join(appRoot, 'main.py'))) projectLang = 'python';
    }

    if (isFullstack) {
      sendLog('Starting database containers…\n');
      try {
        await execFileAsync('podman', ['compose', 'up', '-d'], { cwd: appRoot, timeout: 120000 });
        sendLog('Containers started\n');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`Warning: container start failed: ${msg}\n`);
      }

      if (!fs.existsSync(path.join(backendDir, 'node_modules'))) {
        sendLog('Installing backend dependencies…\n');
        try {
          await execFileAsync('npm', ['install'], { cwd: backendDir, timeout: 180000 });
          sendLog('Backend dependencies installed\n');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendLog(`Warning: backend npm install failed: ${msg}\n`);
        }
      }

      if (fs.existsSync(path.join(backendDir, 'prisma'))) {
        sendLog('Syncing database schema…\n');
        try {
          await execFileAsync('npx', ['--no-install', 'prisma', 'db', 'push', '--skip-generate'], { cwd: backendDir, timeout: 30000 });
          await execFileAsync('npx', ['--no-install', 'prisma', 'generate'], { cwd: backendDir, timeout: 30000 });
          sendLog('Database schema synced\n');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          sendLog(`Warning: prisma db push failed: ${msg}\n`);
        }
      }

      sendLog('Starting backend…\n');
      const backendChild = spawn('npm', ['run', 'dev'], { cwd: backendDir, stdio: 'pipe' });
      devProcesses.set(`${appId}:backend`, backendChild);
      backendChild.stdout?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      backendChild.stderr?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      backendChild.on('close', () => { devProcesses.delete(`${appId}:backend`); });
    }

    // ── Python project: ensure runtime + pip install + uvicorn ────────
    if (projectLang === 'python') {
      const pythonCmd = await ensurePython(sendLog);
      if (!pythonCmd) {
        return { success: false, error: 'Python is not installed and automatic installation failed. Please install Python 3.10+ manually.' };
      }

      sendLog('Installing Python dependencies…\n');
      try {
        // Create venv if missing
        if (!fs.existsSync(path.join(appRoot, '.venv'))) {
          await execFileAsync(pythonCmd, ['-m', 'venv', '.venv'], { cwd: appRoot, timeout: 60000 });
        }
        const pip = path.join(appRoot, '.venv', 'bin', 'pip');
        if (fs.existsSync(path.join(appRoot, 'requirements.txt'))) {
          await execFileAsync(pip, ['install', '-r', 'requirements.txt'], { cwd: appRoot, timeout: 180000 });
        }
        sendLog('Python dependencies installed\n');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`Warning: pip install failed: ${msg}\n`);
      }

      sendLog('Starting Python server…\n');
      const uvicorn = path.join(appRoot, '.venv', 'bin', 'uvicorn');
      const pythonChild = spawn(uvicorn, ['main:app', '--reload', '--port', '8000'], {
        cwd: appRoot, stdio: 'pipe',
      });
      devProcesses.set(appId, pythonChild);
      pythonChild.stdout?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      pythonChild.stderr?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      pythonChild.on('close', () => {
        devProcesses.delete(appId);
        if (!event.sender.isDestroyed()) {
          event.sender.send('apps:dev-status', { appId, status: 'stopped' });
        }
      });
      event.sender.send('apps:dev-status', { appId, status: 'starting' });
      return { success: true };
    }

    // ── Go project: ensure runtime + go mod tidy + go run ───────────
    if (projectLang === 'go') {
      const goCmd = await ensureGo(sendLog);
      if (!goCmd) {
        return { success: false, error: 'Go is not installed and automatic installation failed. Please install Go 1.22+ manually.' };
      }

      sendLog('Installing Go dependencies…\n');
      try {
        await execFileAsync('go', ['mod', 'tidy'], { cwd: appRoot, timeout: 120000 });
        sendLog('Go dependencies installed\n');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendLog(`Warning: go mod tidy failed: ${msg}\n`);
      }

      sendLog('Starting Go server…\n');
      const goChild = spawn('go', ['run', '.'], { cwd: appRoot, stdio: 'pipe' });
      devProcesses.set(appId, goChild);
      goChild.stdout?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      goChild.stderr?.on('data', (chunk: Buffer) => sendLog(chunk.toString()));
      goChild.on('close', () => {
        devProcesses.delete(appId);
        if (!event.sender.isDestroyed()) {
          event.sender.send('apps:dev-status', { appId, status: 'stopped' });
        }
      });
      event.sender.send('apps:dev-status', { appId, status: 'starting' });
      return { success: true };
    }

    // ── Node project: ensure runtime + npm install + npm run dev ──────────────────────
    const nodeCmd = await ensureNode(sendLog);
    if (!nodeCmd) {
      return { success: false, error: 'Node.js is not installed and automatic installation failed. Please install Node.js 18+ manually.' };
    }

    // Always run npm install to pick up any new dependencies added by the AI
    sanitizePackageJson(viteRoot, sendLog);
    sendLog('Installing dependencies…\n');
    try {
      await execFileAsync('npm', ['install'], { cwd: viteRoot, timeout: 180000 });
      sendLog('Dependencies installed\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `npm install failed: ${msg}` };
    }

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
    const backendProc = devProcesses.get(`${appId}:backend`);
    if (backendProc) {
      backendProc.kill();
      devProcesses.delete(`${appId}:backend`);
    }
    event.sender.send('apps:dev-status', { appId, status: 'stopped' });
    return { success: true };
  });

  ipcMain.handle('apps:dev-status', (_event, appId: string) => ({
    status: devProcesses.has(appId) ? 'running' : 'stopped',
  }));

  // ── Export ────────────────────────────────────────────────────────────────

  ipcMain.handle('apps:export', async (_event, { appId, format }: { appId: string; format?: 'zip' | 'mobile' }) => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appName = appId;
    const metaPath = path.join(dir, 'deyad.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.name) appName = meta.name;
      } catch (err) { console.debug('ignore:', err); }
    }

    const sanitized = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (format === 'mobile') {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: 'Select output directory for mobile export',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: appName,
      });
      if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };
      const outDir = filePaths[0];

      try {
        const target = path.join(outDir, `${sanitized}-mobile`);
        fs.rmSync(target, { recursive: true, force: true });
        copyRecursiveSync(dir, target);
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

    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `${sanitized}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (canceled || !filePath) return { success: false, error: 'Cancelled' };

    try {
      const zipData = await buildZipBuffer(dir);
      fs.writeFileSync(filePath, zipData);
      return { success: true, path: filePath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ── Snapshots / Undo ──────────────────────────────────────────────────────

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

    const walk = (base: string) => {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        const fullPath = path.join(base, entry.name);
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
          try { fs.unlinkSync(fullPath); } catch (err) { console.debug('skip:', err); }
        }
      }
    };
    walk(dir);

    for (const [relPath, content] of Object.entries(snapshot)) {
      const fullPath = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    deleteSnapshot(appId);
    return { success: true };
  });

  // ── Import ────────────────────────────────────────────────────────────────

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

    const isFullStack = fs.existsSync(path.join(srcDir, 'backend')) && fs.existsSync(path.join(srcDir, 'frontend'));
    const appType = isFullStack ? 'fullstack' : 'frontend';

    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', '.next', '__pycache__', 'build']);
    // Disable Electron ASAR interception so .asar files copy as regular files
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
      const copyDir = (src: string, dest: string) => {
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          if (SKIP_DIRS.has(entry.name)) continue;
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyDir(srcPath, destPath);
          } else if (entry.isFile()) {
            try { fs.copyFileSync(srcPath, destPath); } catch { /* skip unreadable files */ }
          }
        }
      };
      copyDir(srcDir, destDir);
    } finally {
      process.noAsar = prevNoAsar;
    }

    const meta: Record<string, unknown> = { name, description: `Imported from ${path.basename(srcDir)}`, createdAt: new Date().toISOString(), appType };
    if (appType === 'fullstack') {
      meta.dbProvider = 'sqlite';
    }
    fs.writeFileSync(path.join(destDir, 'deyad.json'), JSON.stringify(meta, null, 2));

    await gitInit(appDir, id);

    return { id, ...meta };
  });

  // ── Duplicate ────────────────────────────────────────────────────────────

  ipcMain.handle('apps:duplicate', async (_event, appId: string) => {
    const srcDir = appDir(appId);
    if (!fs.existsSync(srcDir)) return null;

    // Read source metadata
    const metaPath = path.join(srcDir, 'deyad.json');
    let srcMeta: Record<string, unknown> = {};
    if (fs.existsSync(metaPath)) {
      try { srcMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ignore */ }
    }
    const srcName = (srcMeta.name as string) || appId;
    const newName = `${srcName} (Copy)`;

    const id = `${Date.now()}-${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const destDir = path.join(APPS_DIR, id);
    fs.mkdirSync(destDir, { recursive: true });

    copyRecursiveSync(srcDir, destDir);

    // Write updated metadata with new name and timestamp
    const newMeta: Record<string, unknown> = { ...srcMeta, name: newName, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(destDir, 'deyad.json'), JSON.stringify(newMeta, null, 2));

    await gitInit(appDir, id);

    return { id, ...newMeta };
  });

  // ── Search ────────────────────────────────────────────────────────────

  ipcMain.handle('apps:search-files', (_event, { appId, query }: { appId: string; query: string }) => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return [];
    const results: Array<{ file: string; line: number; text: string }> = [];
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', '.next', '__pycache__']);
    const MAX_RESULTS = 200;

    let pattern: RegExp;
    try {
      pattern = new RegExp(query, 'gi');
    } catch {
      // Fallback to literal match if invalid regex
      pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    }

    const walk = (base: string, rel: string) => {
      if (results.length >= MAX_RESULTS) return;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (results.length >= MAX_RESULTS) return;
        const fullPath = path.join(base, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(fullPath, relPath);
        } else if (entry.name !== 'deyad.json' && entry.name !== 'deyad-messages.json') {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              if (pattern.test(lines[i])) {
                results.push({ file: relPath, line: i + 1, text: lines[i].trim().slice(0, 200) });
              }
              pattern.lastIndex = 0;
            }
          } catch { /* skip binary files */ }
        }
      }
    };
    walk(dir, '');
    return results;
  });
}
