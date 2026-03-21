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

vi.mock('node:net', () => ({
  default: { createConnection: vi.fn() },
  createConnection: vi.fn(),
}));

const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';

beforeEach(() => {
  handlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
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

  it('docker:db-start returns error when no docker-compose.yml', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-start')!;
    const event = { sender: { send: vi.fn() } };
    const result = await handler(event, 'app1');
    expect(result).toEqual({ success: false, error: 'No docker-compose.yml found in app directory' });
  });

  it('docker:db-status returns none when no docker-compose.yml', async () => {
    const { registerDockerHandlers } = await import('./ipcDocker');
    registerDockerHandlers((_id: string) => tmpDir);

    const handler = handlers.get('docker:db-status')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ status: 'none' });
  });
});
