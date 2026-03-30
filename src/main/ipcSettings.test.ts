import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/dyad-test-userdata'),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('./ipcApps', () => ({
  getViteRoot: vi.fn(() => null),
}));

const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';

let tmpDir: string;

beforeEach(() => {
  handlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
  });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyad-settings-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

import type { DyadSettings } from '../lib/mainUtils';

describe('ipcSettings handler registration', () => {
  const defaultSettings: DyadSettings = {
    ollamaHost: 'http://localhost:11434',
    defaultModel: '',
    autocompleteEnabled: false,
    completionModel: '',
    embedModel: '',
    hasCompletedWizard: false,
    theme: 'dark',
  };

  function setup() {
    let current: DyadSettings = { ...defaultSettings };
    return {
      getSettings: () => current,
      setSettings: (s: DyadSettings) => { current = s; },
    };
  }

  it('registers all 8 settings handlers', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    expect(handlers.has('settings:get')).toBe(true);
    expect(handlers.has('settings:set')).toBe(true);
    expect(handlers.has('plugins:list')).toBe(true);
    expect(handlers.has('npm:list')).toBe(true);
    expect(handlers.has('npm:install')).toBe(true);
    expect(handlers.has('npm:uninstall')).toBe(true);
    expect(handlers.has('env:read')).toBe(true);
    expect(handlers.has('env:write')).toBe(true);
  });

  it('settings:get returns current settings', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('settings:get')!;
    const result = handler();
    expect(result).toEqual(defaultSettings);
  });

  it('settings:set merges and persists settings', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('settings:set')!;
    const result = handler({}, { theme: 'light' });
    expect(result.theme).toBe('light');
    expect(result.ollamaHost).toBe('http://localhost:11434');
  });

  it('npm:list returns deps from package.json', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^3.0.0' },
    }));

    const handler = handlers.get('npm:list')!;
    const result = await handler({}, 'app1');
    expect(result.dependencies).toEqual({ react: '^18.0.0' });
    expect(result.devDependencies).toEqual({ vitest: '^3.0.0' });
  });

  it('npm:list returns empty when no package.json', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => path.join(tmpDir, 'nonexistent'), getSettings, setSettings);

    const handler = handlers.get('npm:list')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ dependencies: {}, devDependencies: {} });
  });

  it('npm:install rejects invalid package name', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('npm:install')!;
    const event = { sender: { isDestroyed: vi.fn(() => false), send: vi.fn() } };
    const result = await handler(event, 'app1', 'invalid name with spaces!', false);
    expect(result).toEqual({ success: false, error: 'Invalid package name' });
  });

  it('npm:uninstall rejects invalid package name', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('npm:uninstall')!;
    const result = await handler({}, 'app1', '../../etc/passwd');
    expect(result).toEqual({ success: false, error: 'Invalid package name' });
  });

  it('env:read returns parsed env vars', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    fs.writeFileSync(path.join(tmpDir, '.env'), 'DB_HOST=localhost\nDB_PORT=5432\n');

    const handler = handlers.get('env:read')!;
    const result = handler({}, 'app1');
    expect(result['.env']).toBeDefined();
    expect(result['.env'].DB_HOST).toBe('localhost');
    expect(result['.env'].DB_PORT).toBe('5432');
  });

  it('env:write creates env file and rejects path traversal', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('env:write')!;
    // Valid write
    const result = handler({}, 'app1', '.env', { KEY: 'value' });
    expect(result).toEqual({ success: true });
    expect(fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8')).toContain('KEY=value');

    // Path traversal
    const bad = handler({}, 'app1', '../../etc/shadow', { EVIL: 'hack' });
    expect(bad).toEqual({ success: false, error: 'Path traversal detected' });
  });

  it('plugins:list returns loaded plugins', async () => {
    const { getSettings, setSettings } = setup();
    const { registerSettingsHandlers } = await import('./ipcSettings');
    registerSettingsHandlers((_id: string) => tmpDir, getSettings, setSettings);

    const handler = handlers.get('plugins:list')!;
    const result = handler();
    expect(Array.isArray(result)).toBe(true);
  });
});
