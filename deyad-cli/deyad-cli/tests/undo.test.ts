/**
 * Tests for undo/rollback system — snapshot creation, rollback, and diff.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { rollbackTo, diffFromSnapshot, createSnapshot, undoLast, getSnapshots, createCheckpoint } from '../src/undo.js';

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

describe('createSnapshot', () => {
  it('returns null for a non-git directory', () => {
    expect(createSnapshot(tmpDir, 'test')).toBeNull();
  });

  it('creates a snapshot from a clean HEAD', () => {
    initRepo();
    const snap = createSnapshot(tmpDir, 'before changes');
    expect(snap).not.toBeNull();
    expect(snap!.description).toBe('before changes');
    expect(snap!.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(snap!.timestamp).toBeTruthy();
  });

  it('creates a snapshot with uncommitted changes', () => {
    initRepo();
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'dirty');
    const snap = createSnapshot(tmpDir, 'dirty state');
    expect(snap).not.toBeNull();
    // Working directory should still have the dirty file after snapshot
    expect(fs.existsSync(path.join(tmpDir, 'dirty.txt'))).toBe(true);
  });
});

describe('getSnapshots', () => {
  it('returns an array of snapshots', () => {
    const snaps = getSnapshots();
    expect(Array.isArray(snaps)).toBe(true);
  });
});

describe('createCheckpoint', () => {
  it('returns null for a non-git directory', () => {
    expect(createCheckpoint(tmpDir, 'test')).toBeNull();
  });

  it('returns HEAD ref when no changes to commit', () => {
    initRepo();
    const head = git(['rev-parse', 'HEAD'], tmpDir);
    const ref = createCheckpoint(tmpDir, 'no changes');
    expect(ref).toBe(head);
  });

  it('creates a commit checkpoint with uncommitted changes', () => {
    initRepo();
    fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'checkpoint content');
    const ref = createCheckpoint(tmpDir, 'my checkpoint');
    expect(ref).not.toBeNull();
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    // The commit message should contain the checkpoint tag
    const log = git(['log', '-1', '--format=%s'], tmpDir);
    expect(log).toContain('deyad-checkpoint');
  });
});

describe('undoLast', () => {
  it('returns failure for a non-git directory', () => {
    const result = undoLast(tmpDir);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not a git repository');
  });
});
