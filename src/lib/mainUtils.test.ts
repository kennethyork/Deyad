import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  safeAppId,
  appDir,
  loadSettings,
  saveSettings,
  saveSnapshot,
  loadSnapshot,
  deleteSnapshot,
  DEFAULT_SETTINGS,
} from './mainUtils';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── safeAppId ─────────────────────────────────────────────────────────────────

describe('safeAppId', () => {
  it('accepts valid slugs', () => {
    expect(safeAppId('1234-my-app')).toBe('1234-my-app');
    expect(safeAppId('abc_123')).toBe('abc_123');
    expect(safeAppId('A')).toBe('A');
  });

  it('rejects empty / null / undefined', () => {
    expect(() => safeAppId('')).toThrow('Invalid app ID');
    expect(() => safeAppId(null as unknown as string)).toThrow('Invalid app ID');
    expect(() => safeAppId(undefined as unknown as string)).toThrow('Invalid app ID');
  });

  it('rejects path traversal attempts', () => {
    expect(() => safeAppId('../etc')).toThrow('Invalid app ID');
    expect(() => safeAppId('foo/bar')).toThrow('Invalid app ID');
    expect(() => safeAppId('foo\\bar')).toThrow('Invalid app ID');
    expect(() => safeAppId('..')).toThrow('Invalid app ID');
  });

  it('rejects special characters', () => {
    expect(() => safeAppId('hello world')).toThrow('Invalid app ID');
    expect(() => safeAppId('app!@#')).toThrow('Invalid app ID');
    expect(() => safeAppId('app.name')).toThrow('Invalid app ID');
  });
});

// ── appDir ────────────────────────────────────────────────────────────────────

describe('appDir', () => {
  it('joins appsDir with validated appId', () => {
    const result = appDir('/base/apps', 'my-app');
    expect(result).toBe(path.join('/base/apps', 'my-app'));
  });

  it('throws on invalid appId', () => {
    expect(() => appDir('/base', '../escape')).toThrow('Invalid app ID');
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

describe('loadSettings / saveSettings', () => {
  it('returns defaults when file does not exist', () => {
    const settings = loadSettings(path.join(tmpDir, 'missing.json'));
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings', () => {
    const p = path.join(tmpDir, 'settings.json');
    const custom = { ollamaHost: 'http://myhost:1234', defaultModel: 'llama3' };
    saveSettings(p, custom);
    const loaded = loadSettings(p);
    expect(loaded).toEqual(custom);
  });

  it('returns defaults for corrupt JSON', () => {
    const p = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(p, '{corrupt', 'utf-8');
    const loaded = loadSettings(p);
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });

  it('merges partial saved values with defaults', () => {
    const p = path.join(tmpDir, 'partial.json');
    fs.writeFileSync(p, JSON.stringify({ defaultModel: 'phi3' }), 'utf-8');
    const loaded = loadSettings(p);
    expect(loaded.ollamaHost).toBe(DEFAULT_SETTINGS.ollamaHost);
    expect(loaded.defaultModel).toBe('phi3');
  });
});

// ── Snapshots ─────────────────────────────────────────────────────────────────

describe('snapshot utilities', () => {
  it('saveSnapshot / loadSnapshot round-trip', () => {
    const files = { 'index.html': '<h1>Hi</h1>', 'style.css': 'body{}' };
    saveSnapshot(tmpDir, 'app-1', files);
    const loaded = loadSnapshot(tmpDir, 'app-1');
    expect(loaded).toEqual(files);
  });

  it('loadSnapshot returns null for non-existent snapshot', () => {
    expect(loadSnapshot(tmpDir, 'no-such-app')).toBeNull();
  });

  it('deleteSnapshot removes file', () => {
    saveSnapshot(tmpDir, 'app-2', { 'a.js': 'x' });
    expect(loadSnapshot(tmpDir, 'app-2')).not.toBeNull();
    deleteSnapshot(tmpDir, 'app-2');
    expect(loadSnapshot(tmpDir, 'app-2')).toBeNull();
  });

  it('deleteSnapshot does not throw for missing file', () => {
    expect(() => deleteSnapshot(tmpDir, 'nonexistent')).not.toThrow();
  });

  it('loadSnapshot returns null for corrupt JSON', () => {
    const filePath = path.join(tmpDir, 'bad-app.json');
    fs.writeFileSync(filePath, '{corrupt', 'utf-8');
    expect(loadSnapshot(tmpDir, 'bad-app')).toBeNull();
  });

  it('rejects path-traversal in snapshot appId', () => {
    expect(() => saveSnapshot(tmpDir, '../escape', {})).toThrow('Invalid app ID');
    expect(() => loadSnapshot(tmpDir, '../escape')).toThrow('Invalid app ID');
    expect(() => deleteSnapshot(tmpDir, '../escape')).toThrow('Invalid app ID');
  });
});
