import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    removeListener: vi.fn(),
    kill: vi.fn(),
    exitCode: null,
    killed: false,
    stderr: { on: vi.fn() },
  })),
  execSync: vi.fn(() => ''),
}));

vi.mock('node:net', () => ({
  default: { createConnection: vi.fn() },
  createConnection: vi.fn(),
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-docker-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ipcDocker handler registration', () => {
  it('registers all 6 docker handlers', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    expect(handlers.has('db:describe')).toBe(true);
    expect(handlers.has('docker:check')).toBe(true);
    expect(handlers.has('docker:db-start')).toBe(true);
    expect(handlers.has('docker:db-stop')).toBe(true);
    expect(handlers.has('docker:db-status')).toBe(true);
    expect(handlers.has('docker:port-check')).toBe(true);
  });

  it('db:describe returns empty tables when no prisma schema', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('db:describe')!;
    const result = handler({}, 'app1');
    expect(result).toEqual({ tables: [] });
  });

  it('db:describe parses prisma schema', async () => {
    const prismaDir = path.join(tmpDir, 'backend', 'prisma');
    fs.mkdirSync(prismaDir, { recursive: true });
    fs.writeFileSync(path.join(prismaDir, 'schema.prisma'), `
model User {
  id    Int    @id
  name  String
}

model Post {
  id      Int    @id
  title   String
  userId  Int
}
`);

    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('db:describe')!;
    const result = handler({}, 'app1');
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].name).toBe('User');
    expect(result.tables[0].columns).toContain('id');
    expect(result.tables[0].columns).toContain('name');
    expect(result.tables[1].name).toBe('Post');
  });

  it('docker:check always returns true (no container engine needed for SQLite)', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:check')!;
    const result = await handler();
    expect(result).toBe(true);
  });

  it('docker:db-start returns error when no backend directory', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-start')!;
    const event = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } };
    const result = await handler(event, 'app1');
    expect(result).toEqual({ success: false, error: 'No backend directory found in app directory' });
  });

  it('docker:db-start returns error when no schema.prisma', async () => {
    const backendDir = path.join(tmpDir, 'backend');
    fs.mkdirSync(backendDir, { recursive: true });

    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-start')!;
    const event = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } };
    const result = await handler(event, 'app1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('schema.prisma');
  });

  it('docker:db-start returns error when prisma not installed', async () => {
    const backendDir = path.join(tmpDir, 'backend');
    fs.mkdirSync(path.join(backendDir, 'prisma'), { recursive: true });
    fs.writeFileSync(path.join(backendDir, 'prisma', 'schema.prisma'), 'model X { id Int @id }');

    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-start')!;
    const event = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } };
    const result = await handler(event, 'app1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('npm install');
  });

  it('docker:db-start succeeds when prerequisites are met', async () => {
    vi.useFakeTimers();
    const backendDir = path.join(tmpDir, 'backend');
    fs.mkdirSync(path.join(backendDir, 'prisma'), { recursive: true });
    fs.mkdirSync(path.join(backendDir, 'node_modules', 'prisma'), { recursive: true });
    fs.writeFileSync(path.join(backendDir, 'prisma', 'schema.prisma'), 'model X { id Int @id }');
    fs.writeFileSync(path.join(tmpDir, 'deyad.json'), JSON.stringify({ guiPort: 5555 }));

    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-start')!;
    const event = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } };
    const promise = handler(event, 'app1');
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result.success).toBe(true);
    vi.useRealTimers();
  });

  it('docker:db-status returns none when no backend directory', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-status')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ status: 'none' });
  });

  it('docker:db-status returns stopped when backend exists but no process running', async () => {
    const backendDir = path.join(tmpDir, 'backend');
    fs.mkdirSync(backendDir, { recursive: true });

    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-status')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ status: 'stopped' });
  });
});
