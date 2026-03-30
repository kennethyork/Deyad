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
