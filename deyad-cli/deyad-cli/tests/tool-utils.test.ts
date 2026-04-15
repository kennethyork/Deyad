/**
 * Tests for tool-utils — fuzzy matching, simpleDiff, walkDir, globFiles.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fuzzyFindBlock, simpleDiff, walkDir, globFiles } from '../src/tool-utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── fuzzyFindBlock ────────────────────────────────────────────────────────────

describe('fuzzyFindBlock', () => {
  it('returns null for empty needle', () => {
    expect(fuzzyFindBlock('some content', '')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(fuzzyFindBlock('', 'needle')).toBeNull();
  });

  it('finds exact single-line match', () => {
    const content = 'line one\nline two\nline three';
    const result = fuzzyFindBlock(content, 'line two');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('line two');
    expect(result!.similarity).toBe(1.0);
  });

  it('returns null for ambiguous single-line match', () => {
    const content = 'foo bar\nfoo bar\nsomething else';
    // 'foo bar' appears twice — not unique
    expect(fuzzyFindBlock(content, 'foo bar')).toBeNull();
  });

  it('finds multi-line block with high similarity', () => {
    const content = 'function hello() {\n  console.log("hi");\n}\n\nfunction goodbye() {\n  console.log("bye");\n}';
    const needle = 'function hello() {\n  console.log("hi");\n}';
    const result = fuzzyFindBlock(content, needle);
    expect(result).not.toBeNull();
    expect(result!.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('returns null when no block meets threshold', () => {
    const content = 'alpha\nbeta\ngamma';
    const needle = 'completely\ndifferent\ntext\nhere';
    expect(fuzzyFindBlock(content, needle)).toBeNull();
  });

  it('returns null for blank needle', () => {
    expect(fuzzyFindBlock('content', '   ')).toBeNull();
  });
});

// ── simpleDiff ────────────────────────────────────────────────────────────────

describe('simpleDiff', () => {
  it('shows no changes for identical text', () => {
    const diff = simpleDiff('hello\nworld', 'hello\nworld', 'test.txt');
    expect(diff).toContain('--- a/test.txt');
    expect(diff).toContain('+++ b/test.txt');
    expect(diff).not.toContain('-hello');
    expect(diff).not.toContain('+hello');
  });

  it('shows additions', () => {
    const diff = simpleDiff('line1', 'line1\nline2', 'f.ts');
    expect(diff).toContain('+line2');
  });

  it('shows removals', () => {
    const diff = simpleDiff('line1\nline2', 'line1', 'f.ts');
    expect(diff).toContain('-line2');
  });

  it('shows modifications', () => {
    const diff = simpleDiff('old line', 'new line', 'f.ts');
    expect(diff).toContain('-old line');
    expect(diff).toContain('+new line');
  });

  it('handles empty old text', () => {
    const diff = simpleDiff('', 'new', 'f.ts');
    expect(diff).toContain('+new');
  });

  it('handles empty new text', () => {
    const diff = simpleDiff('old', '', 'f.ts');
    expect(diff).toContain('-old');
  });

  it('includes file path in header', () => {
    const diff = simpleDiff('a', 'b', 'src/app.ts');
    expect(diff).toContain('--- a/src/app.ts');
    expect(diff).toContain('+++ b/src/app.ts');
  });
});

// ── walkDir & globFiles ───────────────────────────────────────────────────────

describe('walkDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-walk-'));
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'code');
    fs.writeFileSync(path.join(tmpDir, 'b.js'), 'code');
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'code');
    // Ignored dirs
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), 'code');
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds source files recursively', () => {
    const files = walkDir(tmpDir, tmpDir);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.js');
    expect(files).toContain(path.join('sub', 'c.ts'));
  });

  it('excludes node_modules', () => {
    const files = walkDir(tmpDir, tmpDir);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });

  it('excludes .git', () => {
    const files = walkDir(tmpDir, tmpDir);
    expect(files.some(f => f.includes('.git'))).toBe(false);
  });

  it('excludes binary extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'img.png'), Buffer.from([0x89, 0x50]));
    fs.writeFileSync(path.join(tmpDir, 'font.woff2'), 'binary');
    const files = walkDir(tmpDir, tmpDir);
    expect(files).not.toContain('img.png');
    expect(files).not.toContain('font.woff2');
  });

  it('includes .env files', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=x');
    const files = walkDir(tmpDir, tmpDir);
    expect(files).toContain('.env');
  });

  it('respects .gitignore patterns', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'b.js\nsub/\n');
    const files = walkDir(tmpDir, tmpDir);
    expect(files).toContain('a.ts');
    expect(files).not.toContain('b.js');
    expect(files.some(f => f.startsWith('sub'))).toBe(false);
  });

  it('returns empty for nonexistent dir', () => {
    const files = walkDir('/nonexistent/path', '/nonexistent/path');
    expect(files).toEqual([]);
  });
});

describe('globFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-glob-'));
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'code');
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'code');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'text');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'code');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches *.ts files', () => {
    const files = globFiles('*.ts', tmpDir);
    expect(files).toContain('app.ts');
    expect(files).not.toContain('app.js');
    expect(files).not.toContain('readme.md');
  });

  it('matches **/*.ts recursively', () => {
    const files = globFiles('**/*.ts', tmpDir);
    expect(files).toContain('app.ts');
    expect(files).toContain(path.join('src', 'index.ts'));
  });

  it('returns empty for no matches', () => {
    const files = globFiles('*.py', tmpDir);
    expect(files).toHaveLength(0);
  });

  it('matches specific file', () => {
    const files = globFiles('readme.md', tmpDir);
    expect(files).toContain('readme.md');
  });
});
