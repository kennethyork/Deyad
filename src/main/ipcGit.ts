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
    await execFileAsync('git', [
      '-c', 'user.email=deyad@localhost',
      '-c', 'user.name=Deyad',
      'commit', '-m', 'Initial scaffold',
    ], { cwd: dir, timeout: 10000 });
  } catch (err) { console.debug('git may not be installed:', err); }
}

export async function gitCommit(appDir: (id: string) => string, appId: string, message: string): Promise<void> {
  const dir = appDir(appId);
  if (!fs.existsSync(path.join(dir, '.git'))) return;
  try {
    await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir, timeout: 10000 });
    if (stdout.trim()) {
      await execFileAsync('git', [
        '-c', 'user.email=deyad@localhost',
        '-c', 'user.name=Deyad',
        'commit', '-m', message,
      ], { cwd: dir, timeout: 10000 });
    }
  } catch (err) { console.debug('git may not be installed:', err); }
}

export function registerGitHandlers(appDir: (id: string) => string): void {
  ipcMain.handle('git:commit', async (_event, appId: string, message: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    try {
      await execFileAsync('git', ['add', '.'], { cwd: dir, timeout: 10000 });
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir, timeout: 10000 });
      if (!stdout.trim()) return { success: true, output: 'Nothing to commit.' };
      const result = await execFileAsync('git', ['commit', '-m', message], { cwd: dir, timeout: 10000 });
      return { success: true, output: result.stdout.trim() };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

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
    } catch (err) { console.debug('Handled error:', err); return []; }
  });

  ipcMain.handle('git:show', async (_event, appId: string, hash: string, filePath: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    if (!/^[0-9a-f]{6,40}$/i.test(hash)) return null;
    if (filePath.includes('..') || path.isAbsolute(filePath)) return null;
    try {
      const { stdout } = await execFileAsync('git', ['show', `${hash}:${filePath}`], { cwd: dir, timeout: 10000 });
      return stdout;
    } catch (err) { console.debug('Handled error:', err); return null; }
  });

  ipcMain.handle('git:diff-stat', async (_event, appId: string, hash: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return [];
    if (!/^[0-9a-f]{6,40}$/i.test(hash)) return [];
    try {
      const { stdout } = await execFileAsync(
        'git', ['diff-tree', '--no-commit-id', '-r', '--name-status', hash],
        { cwd: dir, timeout: 10000 },
      );
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [status, ...parts] = line.split('\t');
        return { status, path: parts.join('\t') };
      });
    } catch (err) { console.debug('Handled error:', err); return []; }
  });

  ipcMain.handle('git:checkout', async (_event, appId: string, hash: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    if (!/^[0-9a-f]{6,40}$/i.test(hash)) return { success: false, error: 'Invalid hash' };
    try {
      await execFileAsync('git', ['checkout', hash, '--', '.'], { cwd: dir, timeout: 10000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Remote / GitHub ────────────────────────────────────────────────────

  ipcMain.handle('git:remote-get', async (_event, appId: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir, timeout: 10000 });
      return stdout.trim() || null;
    } catch (err) { console.debug('Handled error:', err); return null; }
  });

  ipcMain.handle('git:remote-set', async (_event, appId: string, url: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    // Validate URL format (HTTPS or SSH)
    if (!/^https?:\/\/.+|^git@.+:.+/.test(url)) return { success: false, error: 'Invalid remote URL' };
    try {
      // Try set-url first (in case origin already exists), otherwise add
      try {
        await execFileAsync('git', ['remote', 'set-url', 'origin', url], { cwd: dir, timeout: 10000 });
      } catch (err) {
        console.debug('Handled error:', err);
        await execFileAsync('git', ['remote', 'add', 'origin', url], { cwd: dir, timeout: 10000 });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:push', async (_event, appId: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    try {
      // Get current branch name
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 10000 });
      const branch = branchOut.trim();
      // Push with --set-upstream for first push
      await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: dir, timeout: 60000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:pull', async (_event, appId: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    try {
      await execFileAsync('git', ['pull', '--rebase'], { cwd: dir, timeout: 60000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:branch', async (_event, appId: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { current: 'main', branches: [] };
    try {
      const { stdout: currentOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 10000 });
      const { stdout: branchOut } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: dir, timeout: 10000 });
      const branches = branchOut.trim().split('\n').filter(Boolean);
      return { current: currentOut.trim(), branches };
    } catch (err) { console.debug('Handled error:', err); return { current: 'main', branches: [] }; }
  });

  ipcMain.handle('git:branch-create', async (_event, appId: string, name: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) return { success: false, error: 'Invalid branch name' };
    try {
      await execFileAsync('git', ['checkout', '-b', name], { cwd: dir, timeout: 10000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('git:branch-switch', async (_event, appId: string, name: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(path.join(dir, '.git'))) return { success: false, error: 'No git repo' };
    if (!/^[a-zA-Z0-9._\-/]+$/.test(name)) return { success: false, error: 'Invalid branch name' };
    try {
      await execFileAsync('git', ['checkout', name], { cwd: dir, timeout: 10000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
