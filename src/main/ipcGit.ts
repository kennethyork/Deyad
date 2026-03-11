/**
 * Git IPC handlers for version control.
 */

import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

const DEFAULT_GITIGNORE = 'node_modules/\ndist/\n.env\n*.log\ndeyad-messages.json\n';

export async function gitInit(appDir: (id: string) => string, appId: string): Promise<void> {
  const dir = appDir(appId);
  if (fs.existsSync(path.join(dir, '.git'))) return;
  try {
    await execFileAsync('git', ['init'], { cwd: dir, timeout: 10000 });
    fs.writeFileSync(path.join(dir, '.gitignore'), DEFAULT_GITIGNORE, 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
    await execFileAsync('git', ['commit', '-m', 'Initial scaffold'], { cwd: dir, timeout: 10000 });
  } catch { /* git may not be installed */ }
}

export async function gitCommit(appDir: (id: string) => string, appId: string, message: string): Promise<void> {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return;
  try {
    await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir, timeout: 10000 });
    if (stdout.trim()) {
      await execFileAsync('git', ['commit', '-m', message], { cwd: dir, timeout: 10000 });
    }
  } catch { /* git may not be installed */ }
}

export function registerGitHandlers(appDir: (id: string) => string): void {
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

  ipcMain.handle('git:show', async (_event, appId: string, hash: string, filePath: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    if (!/^[0-9a-f]+$/i.test(hash)) return null;
    if (filePath.includes('..') || path.isAbsolute(filePath)) return null;
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
}
