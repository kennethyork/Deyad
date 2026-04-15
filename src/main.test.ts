/**
 * main.ts is the Electron entry point — it cannot be imported in a Vitest environment
 * because it depends on Electron APIs (app, BrowserWindow, etc.) that don't exist in Node.
 *
 * This test validates the main.ts file structurally rather than executing it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainSrc = fs.readFileSync(path.resolve(__dirname, 'main.ts'), 'utf-8');

describe('main.ts (structural)', () => {
  it('imports electron modules', () => {
    expect(mainSrc).toContain("from 'electron'");
  });

  it('sets up uncaughtException handler', () => {
    expect(mainSrc).toContain("process.on('uncaughtException'");
  });

  it('sets up unhandledRejection handler', () => {
    expect(mainSrc).toContain("process.on('unhandledRejection'");
  });

  it('initializes electron-log', () => {
    expect(mainSrc).toContain('log.initialize()');
  });

  it('calls fixPath for desktop launcher compatibility', () => {
    expect(mainSrc).toContain('fixPath()');
  });

  it('creates browser window', () => {
    expect(mainSrc).toContain('new BrowserWindow');
  });

  it('registers IPC handlers', () => {
    expect(mainSrc).toContain('registerTerminalHandlers');
    expect(mainSrc).toContain('registerDockerHandlers');
  });

  it('sets up CSP headers', () => {
    expect(mainSrc).toContain('Content-Security-Policy');
  });

  it('validates appId via appDir utility', () => {
    expect(mainSrc).toContain('appDirUtil');
  });

  it('has no bare catch blocks', () => {
    const bareCatches = (mainSrc.match(/catch\s*{/g) || []).length;
    expect(bareCatches).toBe(0);
  });
});
