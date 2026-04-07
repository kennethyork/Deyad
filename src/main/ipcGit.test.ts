import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { gitInit, gitCommit } from './ipcGit';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

let tmpDir: string;
const fakeAppDir = (_id: string) => tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-git-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Only run git tests if git is available
let gitAvailable = true;
try {
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['--version'], { timeout: 5000 });
} catch {
  gitAvailable = false;
}

const describeGit = gitAvailable ? describe : describe.skip;

describeGit('gitInit', () => {
  it('creates a git repo with .gitignore and initial commit', async () => {
    // Create a dummy file so git has something to commit
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'console.log("hi");');

    await gitInit(fakeAppDir, 'test-app');

    expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(true);
    const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('node_modules/');

    // Should have at least one commit
    const { stdout } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });
    expect(stdout.trim()).toContain('Initial scaffold');
  });

  it('is idempotent — does not re-init if .git already exists', async () => {
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'hi');
    await gitInit(fakeAppDir, 'test-app');
    const { stdout: log1 } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });

    // Run again — should not add another commit
    await gitInit(fakeAppDir, 'test-app');
    const { stdout: log2 } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });
    expect(log1.trim()).toBe(log2.trim());
  });
});

describeGit('gitCommit', () => {
  it('commits staged changes with the provided message', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'v1');
    await gitInit(fakeAppDir, 'app');

    // Make a change
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'v2');
    await gitCommit(fakeAppDir, 'app', 'Update to v2');

    const { stdout } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });
    expect(stdout).toContain('Update to v2');
  });

  it('does nothing when there are no changes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'v1');
    await gitInit(fakeAppDir, 'app');

    const { stdout: before } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });
    await gitCommit(fakeAppDir, 'app', 'No-op commit');
    const { stdout: after } = await execFileAsync('git', ['log', '--oneline'], { cwd: tmpDir });
    expect(before).toBe(after);
  });

  it('does nothing when .git does not exist', async () => {
    // No git init — should silently skip
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'v1');
    await gitCommit(fakeAppDir, 'app', 'Should be skipped');
    expect(fs.existsSync(path.join(tmpDir, '.git'))).toBe(false);
  });
});

// ── Handler registration tests ────────────────────────────────────────────

// Capture handlers registered via ipcMain.handle
const handlers = new Map<string, (...args: unknown[]) => unknown>();
import { ipcMain } from 'electron';

describeGit('registerGitHandlers', () => {
  beforeEach(async () => {
    handlers.clear();
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
      return undefined as ReturnType<typeof ipcMain.handle>;
    });
    const { registerGitHandlers } = await import('./ipcGit');
    registerGitHandlers(fakeAppDir);
  });

  it('registers all expected git IPC channels', () => {
    const expected = ['git:commit', 'git:log', 'git:show', 'git:diff-stat', 'git:checkout',
                      'git:remote-get', 'git:remote-set', 'git:push', 'git:pull',
                      'git:branch', 'git:branch-create', 'git:branch-switch'];
    for (const ch of expected) {
      expect(handlers.has(ch)).toBe(true);
    }
  });

  it('git:log returns empty for no .git', async () => {
    const h = handlers.get('git:log')!;
    const result = await h({}, 'noapp');
    expect(result).toEqual([]);
  });

  it('git:log returns commits after init', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:log')!;
    const result = await h({}, 'app');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].hash).toBeTruthy();
    expect(result[0].message).toContain('Initial scaffold');
  });

  it('git:show validates hash format', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:show')!;
    // Invalid hash
    expect(await h({}, 'app', '; rm -rf /', 'foo.ts')).toBeNull();
    // Path traversal
    expect(await h({}, 'app', 'abcdef', '../../etc/passwd')).toBeNull();
    // Absolute path
    expect(await h({}, 'app', 'abcdef', '/etc/passwd')).toBeNull();
  });

  it('git:diff-stat validates hash format', async () => {
    const h = handlers.get('git:diff-stat')!;
    // Invalid hash - should return empty
    expect(await h({}, 'app', 'not-a-hash!!')).toEqual([]);
  });

  it('git:checkout validates hash format', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:checkout')!;
    const result = await h({}, 'app', '; rm -rf /');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid hash');
  });

  it('git:remote-get returns null for no .git', async () => {
    const h = handlers.get('git:remote-get')!;
    expect(await h({}, 'noapp')).toBeNull();
  });

  it('git:remote-set validates URL format', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:remote-set')!;
    // Invalid URL
    const result = await h({}, 'app', 'ftp://not-valid');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid remote URL');
  });

  it('git:remote-set accepts valid HTTPS URL', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:remote-set')!;
    const result = await h({}, 'app', 'https://github.com/user/repo.git');
    expect(result.success).toBe(true);
  });

  it('git:remote-set accepts valid SSH URL', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:remote-set')!;
    const result = await h({}, 'app', 'git@github.com:user/repo.git');
    expect(result.success).toBe(true);
  });

  it('git:branch-create validates branch name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:branch-create')!;
    const result = await h({}, 'app', 'invalid name with spaces');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid branch name');
  });

  it('git:branch-create creates a new branch', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:branch-create')!;
    const result = await h({}, 'app', 'feature-test');
    expect(result.success).toBe(true);
  });

  it('git:branch-switch validates branch name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:branch-switch')!;
    const result = await h({}, 'app', '../../etc');
    expect(result.success).toBe(false);
  });

  it('git:branch returns current branch info', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'x');
    await gitInit(fakeAppDir, 'app');
    const h = handlers.get('git:branch')!;
    const result = await h({}, 'app');
    expect(result.current).toBeTruthy();
    expect(Array.isArray(result.branches)).toBe(true);
  });

  it('git:commit returns error for no .git', async () => {
    const h = handlers.get('git:commit')!;
    const result = await h({}, 'noapp', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No git repo');
  });
});
