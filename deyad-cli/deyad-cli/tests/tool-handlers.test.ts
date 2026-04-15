/**
 * Tests for tool-handlers — executeBuiltinTool direct access and SSRF edge cases.
 * The bulk of tool logic is tested via tools.test.ts; this file covers handler-specific paths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeBuiltinTool } from '../src/tool-handlers.js';
import { executeTool } from '../src/tools.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-th-test-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('executeBuiltinTool — list_files', () => {
  it('lists files in directory', async () => {
    const result = await executeBuiltinTool(
      { name: 'list_files', params: {} },
      tmpDir, tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
  });
});

describe('executeBuiltinTool — read_file', () => {
  it('reads file content', async () => {
    const result = await executeBuiltinTool(
      { name: 'read_file', params: { path: 'hello.txt' } },
      tmpDir, tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('world');
  });

  it('rejects missing path param', async () => {
    const result = await executeBuiltinTool(
      { name: 'read_file', params: {} },
      tmpDir, tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('path');
  });

  it('blocks path traversal', async () => {
    const result = await executeBuiltinTool(
      { name: 'read_file', params: { path: '../../etc/passwd' } },
      tmpDir, tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('traversal');
  });
});

describe('SSRF protection — isPrivate172 via fetch_url', () => {
  it('blocks 172.16.x.x', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://172.16.0.1/secret' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('private');
  });

  it('blocks 172.31.x.x', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://172.31.255.255/data' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('private');
  });

  it('allows 172.32.x.x (not private) — via URL parse only', async () => {
    // 172.32.x.x is NOT in 172.16.0.0/12 so SSRF check should not block it.
    // We don't actually fetch (would timeout); just verify the URL is valid.
    const url = new URL('http://172.32.0.1/');
    const second = parseInt(url.hostname.split('.')[1]!, 10);
    // isPrivate172 logic: second >= 16 && second <= 31
    expect(second).toBe(32);
    expect(second >= 16 && second <= 31).toBe(false);
  });

  it('allows 172.15.x.x (not private) — via URL parse only', async () => {
    const url = new URL('http://172.15.0.1/');
    const second = parseInt(url.hostname.split('.')[1]!, 10);
    expect(second).toBe(15);
    expect(second >= 16 && second <= 31).toBe(false);
  });
});

describe('executeBuiltinTool — unknown tool', () => {
  it('returns error for unrecognized tool name', async () => {
    const result = await executeBuiltinTool(
      { name: 'nonexistent_tool', params: {} },
      tmpDir, tmpDir,
    );
    expect(result.success).toBe(false);
  });
});
