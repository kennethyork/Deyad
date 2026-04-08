/**
 * Tests for git-utils — shared git helpers used by sandbox and undo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { git, isGitRepo, hasChanges, getCurrentBranch } from '../src/git-utils.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-gitutils-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function initRepo(): void {
  execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'commit.gpgSign', 'false'], { cwd: tmpDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'initial');
  execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '--no-gpg-sign', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
}

describe('isGitRepo', () => {
  it('returns false for a non-git directory', () => {
    expect(isGitRepo(tmpDir)).toBe(false);
  });

  it('returns true for an initialized git repo', () => {
    initRepo();
    expect(isGitRepo(tmpDir)).toBe(true);
  });
});

describe('hasChanges', () => {
  it('returns false for a clean repo', () => {
    initRepo();
    expect(hasChanges(tmpDir)).toBe(false);
  });

  it('returns true when there are uncommitted changes', () => {
    initRepo();
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'change');
    expect(hasChanges(tmpDir)).toBe(true);
  });

  it('returns false for a non-git directory', () => {
    expect(hasChanges(tmpDir)).toBe(false);
  });
});

describe('getCurrentBranch', () => {
  it('returns the current branch name', () => {
    initRepo();
    const branch = getCurrentBranch(tmpDir);
    // Default branch can be "main" or "master"
    expect(['main', 'master']).toContain(branch);
  });
});

describe('git', () => {
  it('runs a git command and returns output', () => {
    initRepo();
    const out = git(['rev-parse', 'HEAD'], tmpDir);
    expect(out).toMatch(/^[0-9a-f]{40}$/);
  });

  it('throws on invalid command', () => {
    initRepo();
    expect(() => git(['invalid-command-xyz'], tmpDir)).toThrow();
  });
});
