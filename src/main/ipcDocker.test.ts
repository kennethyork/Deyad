import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';

beforeEach(() => {
  handlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
  });
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-sqlite-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ipcDocker handler registration', () => {
  it('registers all 3 SQLite handlers', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    expect(handlers.has('db:describe')).toBe(true);
    expect(handlers.has('db:tables')).toBe(true);
    expect(handlers.has('db:query')).toBe(true);
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

  it('db:tables returns empty when no db file exists', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('db:tables')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual([]);
  });

  it('db:query returns empty when no db file exists', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('db:query')!;
    const result = await handler({}, { appId: 'app1', sql: 'SELECT 1' });
    expect(result).toEqual([]);
  });
});
