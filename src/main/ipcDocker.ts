/**
 * Database / Prisma Studio IPC handlers.
 *
 * For SQLite-backed full-stack apps, there is no Docker or container engine
 * required. The "database viewer" is Prisma Studio, launched as a local
 * child process on demand.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import nodeNet from 'node:net';
import { spawn, execSync, type ChildProcess } from 'node:child_process';

// ── Prisma Studio process registry ───────────────────────────────────────────

const studioProcesses = new Map<string, ChildProcess>();

function killStudio(appId: string): void {
  const proc = studioProcesses.get(appId);
  if (proc) {
    try { proc.kill(); } catch (err) { console.debug('kill studio:', err); }
    studioProcesses.delete(appId);
  }
}

/** Kill any process listening on the given port (best-effort, Linux/macOS). */
function killProcessOnPort(port: number): void {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8', timeout: 3000 });
      const pids = new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(Boolean));
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 }); } catch { /* already dead */ }
      }
    } catch { /* no listeners */ }
  } else {
    try {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', timeout: 3000 }).trim();
      if (out) {
        for (const pid of out.split(/\s+/)) {
          try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already dead */ }
        }
      }
    } catch { /* no listeners */ }
  }
}

/** No-op — kept for backward compatibility with ipcApps.ts import. */
export async function stopCompose(_appDir: (id: string) => string, appId: string): Promise<void> {
  killStudio(appId);
}
export function registerDockerHandlers(appDir: (id: string) => string): void {
  // ── Database inspection ─────────────────────────────────────────────────
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

  // ── Docker check — always true since SQLite needs no container engine ───
  ipcMain.handle('docker:check', async () => true);

  // ── Start Prisma Studio ─────────────────────────────────────────────────
  ipcMain.handle('docker:db-start', async (event, appId: string) => {
    const dir = appDir(appId);
    const backendDir = path.join(dir, 'backend');
    if (!fs.existsSync(backendDir)) {
      return { success: false, error: 'No backend directory found in app directory' };
    }

    // Verify schema.prisma exists
    const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');
    if (!fs.existsSync(schemaPath)) {
      return { success: false, error: 'No prisma/schema.prisma found — create a schema first' };
    }

    // Verify prisma is installed
    if (!fs.existsSync(path.join(backendDir, 'node_modules', 'prisma'))) {
      return { success: false, error: 'Prisma not installed — run npm install in the backend terminal first' };
    }

    // Read guiPort from deyad.json
    let guiPort = 5555;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      if (meta.guiPort) guiPort = meta.guiPort;
    } catch (err) { console.debug('Could not read guiPort from deyad.json:', err); }

    // Stop any existing instance and free the port
    killStudio(appId);
    killProcessOnPort(guiPort);

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const proc = spawn(npx, ['prisma', 'studio', '--port', String(guiPort), '--browser=none'], {
      cwd: backendDir,
      stdio: 'pipe',
      env: { ...process.env },
    });

    studioProcesses.set(appId, proc);

    // Capture stderr for error reporting
    let stderrBuf = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBuf.length < 4096) stderrBuf += chunk.toString();
    });

    // Wait up to 3 s to detect immediate crash / spawn error before returning success
    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      let settled = false;

      const onSpawnError = (err: Error) => {
        if (settled) return;
        settled = true;
        studioProcesses.delete(appId);
        resolve({ success: false, error: err.message });
      };

      const onEarlyExit = (code: number | null) => {
        if (settled) return;
        settled = true;
        studioProcesses.delete(appId);
        const msg = stderrBuf.trim() || `Prisma Studio exited immediately (code ${code})`;
        resolve({ success: false, error: msg });
      };

      proc.on('error', onSpawnError);
      proc.on('exit', onEarlyExit);

      setTimeout(() => {
        if (settled) return;
        settled = true;
        // Process survived 3 s — consider it started successfully.
        // Swap early-exit listeners for the long-running exit handler.
        proc.removeListener('exit', onEarlyExit);
        proc.removeListener('error', onSpawnError);
        proc.on('exit', () => {
          studioProcesses.delete(appId);
          if (!event.sender.isDestroyed()) {
            event.sender.send('docker:db-status', { appId, status: 'stopped' });
          }
        });
        if (!event.sender.isDestroyed()) {
          event.sender.send('docker:db-status', { appId, status: 'running' });
        }
        resolve({ success: true });
      }, 3000);
    });

    return result;
  });

  // ── Stop Prisma Studio ──────────────────────────────────────────────────
  ipcMain.handle('docker:db-stop', async (event, appId: string) => {
    try {
      // Read guiPort so we can also kill stale processes on it
      const dir = appDir(appId);
      let guiPort = 5555;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
        if (meta.guiPort) guiPort = meta.guiPort;
      } catch { /* use default */ }

      killStudio(appId);
      killProcessOnPort(guiPort);
      event.sender.send('docker:db-status', { appId, status: 'stopped' });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  // ── DB status — check whether Prisma Studio process is alive ───────────
  ipcMain.handle('docker:db-status', async (_event, appId: string) => {
    const dir = appDir(appId);
    const backendDir = path.join(dir, 'backend');
    if (!fs.existsSync(backendDir)) return { status: 'none' };
    const proc = studioProcesses.get(appId);
    if (!proc || proc.exitCode !== null || proc.killed) {
      studioProcesses.delete(appId);
      return { status: 'stopped' };
    }
    return { status: 'running' };
  });

  // ── Port availability check ─────────────────────────────────────────────
  ipcMain.handle('docker:port-check', (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const sock = nodeNet.createConnection({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => { resolve(false); });
      sock.setTimeout(2000, () => { sock.destroy(); resolve(false); });
    });
  });
}
