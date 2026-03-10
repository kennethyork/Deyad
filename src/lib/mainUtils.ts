import path from 'node:path';
import fs from 'node:fs';

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
}

export const DEFAULT_SETTINGS: DeyadSettings = {
  ollamaHost: 'http://localhost:11434',
  defaultModel: '',
  autocompleteEnabled: false,
  completionModel: '',
};

export function loadSettings(settingsPath: string): DeyadSettings {
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
    }
  } catch { /* ignore corrupt file */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settingsPath: string, settings: DeyadSettings): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// ── Snapshot utility ──────────────────────────────────────────────────────────

export function saveSnapshot(snapshotsDir: string, appId: string, files: Record<string, string>): void {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(files), 'utf-8');
}

export function loadSnapshot(snapshotsDir: string, appId: string): Record<string, string> | null {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return null; }
}

export function deleteSnapshot(snapshotsDir: string, appId: string): void {
  const filePath = path.join(snapshotsDir, `${safeAppId(appId)}.json`);
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}
