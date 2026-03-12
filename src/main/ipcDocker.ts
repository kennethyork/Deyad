/**
 * Docker / Container / Database IPC handlers.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import nodeNet from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const DOCKER_CHECK_TIMEOUT_MS = 5000;

// ── Container Engine (Podman / Docker) ──────────────────────────────────────

/** Detect whether podman or docker is available (prefer podman). */
let _containerEngine: string | null = null;
async function getContainerEngine(): Promise<string> {
  if (_containerEngine) return _containerEngine;
  for (const cmd of ['podman', 'docker']) {
    try {
      await execFileAsync(cmd, ['info'], { timeout: DOCKER_CHECK_TIMEOUT_MS });
      _containerEngine = cmd;
      return cmd;
    } catch (err) { console.debug('try next:', err); }
  }
  throw new Error('No container engine found (tried podman, docker)');
}

/** Build env for compose commands — sets DOCKER_HOST for podman so docker-compose v1 can connect. */
function composeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (_containerEngine === 'podman') {
    const uid = process.getuid?.() ?? 1000;
    env.DOCKER_HOST = `unix:///run/user/${uid}/podman/podman.sock`;
  }
  return env;
}

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await getContainerEngine();
    return true;
  } catch (err) { console.debug('Handled error:', err); return false; }
}

export async function stopCompose(appDir: (id: string) => string, appId: string): Promise<void> {
  const dir = appDir(appId);
  const composeFile = path.join(dir, 'docker-compose.yml');
  if (fs.existsSync(composeFile)) {
    try {
      const engine = await getContainerEngine();
      await execFileAsync(engine, ['compose', '-f', composeFile, 'down'], { timeout: 30000, env: composeEnv() });
    } catch (err) { console.debug('best-effort:', err); }
  }
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

  // ── Container handlers ──────────────────────────────────────────────────
  ipcMain.handle('docker:check', async () => checkDockerAvailable());

  ipcMain.handle('docker:db-start', async (event, appId: string) => {
    const dir = appDir(appId);
    const composeFile = path.join(dir, 'docker-compose.yml');
    if (!fs.existsSync(composeFile)) {
      return { success: false, error: 'No docker-compose.yml found in app directory' };
    }
    try {
      const engine = await getContainerEngine();
      await execFileAsync(engine, ['compose', '-f', composeFile, 'up', '-d'], { timeout: 120000, env: composeEnv() });
      event.sender.send('docker:db-status', { appId, status: 'running' });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('docker:db-stop', async (event, appId: string) => {
    try {
      event.sender.send('docker:db-status', { appId, status: 'stopped' });
      await stopCompose(appDir, appId);
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
      const engine = await getContainerEngine();
      const { stdout } = await execFileAsync(
        engine, ['compose', '-f', composeFile, 'ps', '--format', 'json'],
        { timeout: 10000, env: composeEnv() },
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (!lines.length) return { status: 'stopped' };
      const containers = lines
        .map((l) => { try { return JSON.parse(l); } catch (err) { console.debug('JSON parse failed:', err); return null; } })
        .filter(Boolean);
      const running = containers.some((c: { State?: string }) => c?.State === 'running');
      return { status: running ? 'running' : 'stopped' };
    } catch (err) { console.debug('Handled error:', err); return { status: 'stopped' }; }
  });

  ipcMain.handle('docker:port-check', (_event, port: number) => {
    return new Promise<boolean>((resolve) => {
      const sock = nodeNet.createConnection({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => { resolve(false); });
      sock.setTimeout(2000, () => { sock.destroy(); resolve(false); });
    });
  });
}
