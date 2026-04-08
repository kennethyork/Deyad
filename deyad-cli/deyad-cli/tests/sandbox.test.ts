/**
 * Tests for sandbox module — git branch isolation for safe agent work.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We need to reset module state between tests since sandbox uses module-level state
let sandboxModule: typeof import('../src/sandbox.js');

let tmpDir: string;

function git(cmd: string) {
  return execSync(`git ${cmd}`, { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function initRepo() {
  git('init');
  git('config user.email "test@test.com"');
  git('config user.name "Test"');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n', 'utf-8');
  git('add -A');
  git('commit -m "initial"');
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-sandbox-test-'));
  // Re-import to reset module-level sandbox state
  vi.resetModules();
  sandboxModule = await import('../src/sandbox.js');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('enterSandbox', () => {
  test('creates a sandbox branch in a git repo', () => {
    initRepo();
    const result = sandboxModule.enterSandbox(tmpDir);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Sandbox active');
    expect(result.message).toContain('deyad-sandbox-');

    const branch = git('branch --show-current');
    expect(branch).toMatch(/^deyad-sandbox-/);
    expect(sandboxModule.isSandboxed()).toBe(true);
  });

  test('fails if not a git repo', () => {
    const result = sandboxModule.enterSandbox(tmpDir);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not a git repository');
  });

  test('fails if already in sandbox', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);
    const result = sandboxModule.enterSandbox(tmpDir);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Already in sandbox');
  });

  test('stashes pending changes before branching', () => {
    initRepo();
    // Create uncommitted changes
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'uncommitted', 'utf-8');

    const result = sandboxModule.enterSandbox(tmpDir);
    expect(result.success).toBe(true);

    // The file should still be accessible (stash popped into sandbox)
    // or the branch should be active
    const branch = git('branch --show-current');
    expect(branch).toMatch(/^deyad-sandbox-/);
  });
});

describe('exitSandbox', () => {
  test('merges sandbox changes back to original branch', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);

    // Make changes in sandbox
    fs.writeFileSync(path.join(tmpDir, 'new-file.ts'), 'export const x = 1;', 'utf-8');
    git('add -A');
    git('commit -m "sandbox work"');

    const result = sandboxModule.exitSandbox(tmpDir, true);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Merged');
    expect(result.diff).toBeDefined();

    // Should be back on original branch
    const branch = git('branch --show-current');
    expect(branch).not.toMatch(/^deyad-sandbox-/);

    // Merged file should exist
    expect(fs.existsSync(path.join(tmpDir, 'new-file.ts'))).toBe(true);
    expect(sandboxModule.isSandboxed()).toBe(false);
  });

  test('discards sandbox changes when merge=false', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'discard-me.ts'), 'gone', 'utf-8');
    git('add -A');
    git('commit -m "will be discarded"');

    const result = sandboxModule.exitSandbox(tmpDir, false);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Discarded');

    // File should not exist on original branch
    expect(fs.existsSync(path.join(tmpDir, 'discard-me.ts'))).toBe(false);
    expect(sandboxModule.isSandboxed()).toBe(false);
  });

  test('fails if not in sandbox mode', () => {
    const result = sandboxModule.exitSandbox(tmpDir, true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not in sandbox');
  });

  test('commits uncommitted changes before exiting', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);

    // Leave changes uncommitted
    fs.writeFileSync(path.join(tmpDir, 'uncommitted.ts'), 'auto-committed', 'utf-8');

    const result = sandboxModule.exitSandbox(tmpDir, true);
    expect(result.success).toBe(true);

    // Should still have the file after merge
    expect(fs.existsSync(path.join(tmpDir, 'uncommitted.ts'))).toBe(true);
  });

  test('returns diff stats', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'stats.ts'), 'data', 'utf-8');
    git('add -A');
    git('commit -m "add stats"');

    const result = sandboxModule.exitSandbox(tmpDir, true);
    expect(result.success).toBe(true);
    expect(result.diff).toContain('stats.ts');
  });
});

describe('isSandboxed', () => {
  test('returns false initially', () => {
    expect(sandboxModule.isSandboxed()).toBe(false);
  });

  test('returns true after entering sandbox', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);
    expect(sandboxModule.isSandboxed()).toBe(true);
  });

  test('returns false after exiting sandbox', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);
    sandboxModule.exitSandbox(tmpDir, false);
    expect(sandboxModule.isSandboxed()).toBe(false);
  });
});

describe('getSandboxState', () => {
  test('returns null when not in sandbox', () => {
    expect(sandboxModule.getSandboxState()).toBeNull();
  });

  test('returns state with branch info when active', () => {
    initRepo();
    sandboxModule.enterSandbox(tmpDir);
    const state = sandboxModule.getSandboxState();
    expect(state).not.toBeNull();
    expect(state!.active).toBe(true);
    expect(state!.sandboxBranch).toMatch(/^deyad-sandbox-/);
    expect(state!.originalBranch).toBeTruthy();
    expect(state!.startRef).toMatch(/^[0-9a-f]{40}$/);
  });
});
