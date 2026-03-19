/**
 * Database (SQLite) IPC handlers.
 * Parses Prisma schema for schema inspection and uses sqlite3 CLI for data queries.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

/** Find the SQLite database file for an app (Prisma default location). */
function findDbFile(appDirPath: string): string | null {
  const candidates = [
    path.join(appDirPath, 'backend', 'prisma', 'dev.db'),
    path.join(appDirPath, 'backend', 'dev.db'),
    path.join(appDirPath, 'prisma', 'dev.db'),
    path.join(appDirPath, 'dev.db'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function registerDockerHandlers(appDir: (id: string) => string): void {
  // ── Database schema inspection (Prisma) ─────────────────────────────────
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

  // ── List tables in the SQLite database ──────────────────────────────────
  ipcMain.handle('db:tables', async (_event, appId: string) => {
    const dir = appDir(appId);
    const dbFile = findDbFile(dir);
    if (!dbFile) return [];
    try {
      const { stdout } = await execFileAsync('sqlite3', [
        dbFile,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%' ORDER BY name",
      ], { timeout: 5000 });
      return stdout.trim().split('\n').filter(Boolean);
    } catch { return []; }
  });

  // ── Run a read-only SQL query against the SQLite database ───────────────
  ipcMain.handle('db:query', async (_event, { appId, sql }: { appId: string; sql: string }) => {
    const dir = appDir(appId);
    const dbFile = findDbFile(dir);
    if (!dbFile) return [];
    try {
      const { stdout } = await execFileAsync('sqlite3', [
        '-json', dbFile, sql,
      ], { timeout: 10000 });
      const trimmed = stdout.trim();
      if (!trimmed) return [];
      return JSON.parse(trimmed);
    } catch { return []; }
  });
}
