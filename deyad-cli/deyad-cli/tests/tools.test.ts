/**
 * Tests for executeTool — path traversal guards, git command safety, and basic tool dispatch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeTool } from '../src/tools.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-tools-test-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'Hello, world!');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'nested.txt'), 'nested content');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('executeTool — path traversal guards', () => {
  it('blocks reading files outside project via ../', async () => {
    const result = await executeTool(
      { name: 'read_file', params: { path: '../../../etc/passwd' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/traversal/i);
  });

  it('blocks writing files outside project', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: '../../evil.txt', content: 'pwned' } },
      tmpDir,
    );
    // Even if the tool reports success, the file must NOT exist outside the project
    const evilPath = path.resolve(tmpDir, '../../evil.txt');
    expect(fs.existsSync(evilPath)).toBe(false);
  });

  it('blocks editing files outside project', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: '../../../etc/hosts', old_string: 'x', new_string: 'y' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/traversal/i);
  });

  it('blocks deleting files outside project', async () => {
    const result = await executeTool(
      { name: 'delete_file', params: { path: '../../outside.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
  });
});

describe('executeTool — basic operations', () => {
  it('lists files in project', async () => {
    const result = await executeTool({ name: 'list_files', params: {} }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
    expect(result.output).toContain(path.join('sub', 'nested.txt'));
  });

  it('reads a file', async () => {
    const result = await executeTool(
      { name: 'read_file', params: { path: 'hello.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello, world!');
  });

  it('returns error for missing file', async () => {
    const result = await executeTool(
      { name: 'read_file', params: { path: 'nope.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found/i);
  });

  it('writes a new file', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: 'new.txt', content: 'created' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf-8')).toBe('created');
  });

  it('edits a file with unique string', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'world', new_string: 'deyad' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8')).toBe('Hello, deyad!');
  });

  it('rejects edit with non-unique string', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dup.txt'), 'aaa bbb aaa');
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'dup.txt', old_string: 'aaa', new_string: 'ccc' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/2 times/);
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool({ name: 'hack_the_planet', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/unknown tool/i);
  });

  it('search_files finds matches', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'nested' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('nested.txt');
  });

  it('glob_files matches pattern', async () => {
    const result = await executeTool(
      { name: 'glob_files', params: { pattern: '**/*.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
  });
});
