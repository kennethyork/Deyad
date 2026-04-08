/**
 * Tests for undo/rollback system — snapshot creation, rollback, and diff.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { rollbackTo, diffFromSnapshot } from '../src/undo.js';

let tmpDir: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8', timeout: 10000 }).toString().trim();
}

function initRepo(): void {
  git(['init'], tmpDir);
  git(['config', 'user.email', 'test@test.com'], tmpDir);
  git(['config', 'user.name', 'Test'], tmpDir);
  git(['config', 'commit.gpgSign', 'false'], tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'initial');
  git(['add', '-A'], tmpDir);
  git(['commit', '--no-gpg-sign', '-m', 'init'], tmpDir);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-undo-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('rollbackTo', () => {
  it('returns false when not a git repo', () => {
    expect(rollbackTo(tmpDir, 'abc1234')).toBe(false);
  });

  it('rejects invalid refs (prevents command injection)', () => {
    initRepo();
    expect(rollbackTo(tmpDir, 'not-a-hash')).toBe(false);
    expect(rollbackTo(tmpDir, '; rm -rf /')).toBe(false);
    expect(rollbackTo(tmpDir, 'abc$(evil)')).toBe(false);
  });

  it('resets to a valid ref', () => {
    initRepo();
    const head = git(['rev-parse', 'HEAD'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'extra.txt'), 'extra');
    git(['add', '-A'], tmpDir);
    git(['commit', '--no-gpg-sign', '-m', 'extra'], tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'extra.txt'))).toBe(true);

    const ok = rollbackTo(tmpDir, head);
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'extra.txt'))).toBe(false);
  });
});

describe('diffFromSnapshot', () => {
  it('returns error message when not a git repo', () => {
    expect(diffFromSnapshot(tmpDir, 'abc1234')).toMatch(/not a git repo/);
  });

  it('shows changes since a ref', () => {
    initRepo();
    const head = git(['rev-parse', 'HEAD'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'added.txt'), 'new content');
    git(['add', '-A'], tmpDir);
    git(['commit', '--no-gpg-sign', '-m', 'add'], tmpDir);
    const diff = diffFromSnapshot(tmpDir, head);
    expect(diff).toContain('added.txt');
  });

  it('returns no changes when ref matches HEAD', () => {
    initRepo();
    const head = git(['rev-parse', 'HEAD'], tmpDir);
    const diff = diffFromSnapshot(tmpDir, head);
    expect(diff).toMatch(/no changes/);
  });
});
