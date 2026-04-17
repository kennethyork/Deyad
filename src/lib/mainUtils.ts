import path from 'node:path';
import fs from 'node:fs';

// ── Advisory file locking ─────────────────────────────────────────────────────
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

/**
 * Acquire an advisory lock using mkdir (atomic on POSIX & Windows).
 * Returns true if acquired, false on timeout.
 */
export function acquireLock(filePath: string): boolean {
  const lockPath = filePath + '.lock';
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid), 'utf-8');
      return true;
    } catch (e) {
      console.debug('lock acquire retry:', e);
      // Lock exists — check if stale
      try {
        const pidFile = path.join(lockPath, 'pid');
        if (fs.existsSync(pidFile)) {
          const stat = fs.statSync(pidFile);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            releaseLock(filePath);
            continue;
          }
        }
      } catch (e) { console.debug('lock stat failed:', e); }
      // Brief spin-wait
      const start = Date.now();
      while (Date.now() - start < 50) { /* spin */ }
    }
  }
  return false;
}

/**
 * Release an advisory file lock.
 */
export function releaseLock(filePath: string): void {
  const lockPath = filePath + '.lock';
  try {
    const pidFile = path.join(lockPath, 'pid');
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    fs.rmdirSync(lockPath);
  } catch (e) { console.debug('releaseLock failed:', e); }
}

/**
 * Atomic write: write content to a temp file then rename into place.
 * With advisory locking to prevent multi-instance corruption.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + `.tmp-${process.pid}`;
  const locked = acquireLock(filePath);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (e) { console.debug('tmp cleanup failed:', e); }
    throw err;
  } finally {
    if (locked) releaseLock(filePath);
  }
}

/**
 * Validates and sanitizes an appId to prevent path-traversal attacks.
 * AppIds are generated as `{timestamp}-{slug}` — they must not contain
 * path separators, `..`, or any character outside `[a-zA-Z0-9_-]`.
 * Throws if the id is invalid.
 */
export function safeAppId(appId: string): string {
  if (!appId || typeof appId !== 'string') throw new Error('Invalid app ID');
  if (/[/\\]/.test(appId) || appId.includes('..')) throw new Error('Invalid app ID');
  if (!/^[a-zA-Z0-9_-]+$/.test(appId)) throw new Error('Invalid app ID');
  return appId;
}

/** Returns the verified absolute directory for an app. */
export function appDir(appsDir: string, appId: string): string {
  return path.join(appsDir, safeAppId(appId));
}

// ── Settings utility ──────────────────────────────────────────────────────────

export interface DeyadSettings {
  ollamaHost: string;
  defaultModel: string;
  autocompleteEnabled: boolean;
  completionModel: string;
  embedModel: string;
  hasCompletedWizard: boolean;
  theme: 'dark' | 'light';
  temperature: number;
  topP: number;
  repeatPenalty: number;
  contextSize: number;
  maxFullHistory: number;
}

export const DEFAULT_SETTINGS: DeyadSettings = {
  ollamaHost: 'http://localhost:11434',
  defaultModel: '',
  autocompleteEnabled: false,
  completionModel: '',
  embedModel: '',
  hasCompletedWizard: false,
  theme: 'dark',
  temperature: 0.7,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextSize: 32768,
  maxFullHistory: 500,
};

export function loadSettings(settingsPath: string): DeyadSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
    }
  } catch (err) { console.debug('ignore corrupt file:', err); }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settingsPath: string, settings: DeyadSettings): void {
  atomicWriteFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// ── Snapshot utility ──────────────────────────────────────────────────────────

export function saveSnapshot(snapshotsDir: string, appId: string, files: Record<string, string>): void {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  atomicWriteFileSync(filePath, JSON.stringify(files));
}

export function loadSnapshot(snapshotsDir: string, appId: string): Record<string, string> | null {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch (err) { console.debug('Handled error:', err); return null; }
}

export function deleteSnapshot(snapshotsDir: string, appId: string): void {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  try { fs.unlinkSync(filePath); } catch (err) { console.debug('ignore:', err); }
}
