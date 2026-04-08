import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<string, (...args: any[]) => any>();

import { ipcMain } from 'electron';

beforeEach(() => {
  handlers.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers.set(channel, handler);
    return undefined as ReturnType<typeof ipcMain.handle>;
  });
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-cap-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ipcCapacitor handler registration', () => {
  it('registers all 5 capacitor handlers', async () => {
    const { registerCapacitorHandlers } = await import('./ipcCapacitor');
    registerCapacitorHandlers((_id: string) => tmpDir);

    expect(handlers.has('apps:capacitor-init')).toBe(true);
    expect(handlers.has('apps:capacitor-open')).toBe(true);
    expect(handlers.has('apps:capacitor-list-devices')).toBe(true);
    expect(handlers.has('apps:capacitor-run')).toBe(true);
    expect(handlers.has('apps:capacitor-live-reload')).toBe(true);
  });

  it('capacitor-init returns error when app dir does not exist', async () => {
    const { registerCapacitorHandlers } = await import('./ipcCapacitor');
    registerCapacitorHandlers((_id: string) => path.join(tmpDir, 'nonexistent'));

    const handler = handlers.get('apps:capacitor-init')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });

  it('capacitor-init reports already initialized when capacitor.config.ts exists', async () => {
    // Create required files
    fs.writeFileSync(path.join(tmpDir, 'deyad.json'), JSON.stringify({ name: 'TestApp', appType: 'frontend' }));
    fs.writeFileSync(path.join(tmpDir, 'capacitor.config.ts'), 'export default {};');

    const { registerCapacitorHandlers } = await import('./ipcCapacitor');
    registerCapacitorHandlers((_id: string) => tmpDir);

    const handler = handlers.get('apps:capacitor-init')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ success: true, alreadyInitialized: true });
  });

  it('capacitor-live-reload returns error when not initialized', async () => {
    const { registerCapacitorHandlers } = await import('./ipcCapacitor');
    registerCapacitorHandlers((_id: string) => tmpDir);

    const handler = handlers.get('apps:capacitor-live-reload')!;
    const result = await handler({}, 'app1', 'android', true);
    expect(result).toEqual({ success: false, error: 'Capacitor not initialized. Run Initialize first.' });
  });
});
