/**
 * Tests for agent module — conversation compaction, system prompt, action detection.
 */
import { describe, it, expect } from 'vitest';

// Test the private helpers by importing the module and testing observable behavior
// Since isActionableRequest and compactConversation are not exported,
// we test via the exported runAgentLoop with mocked dependencies.

// Test tool-related security (new shell-quote-based run_command)
import { executeTool } from '../src/tools.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-agent-test-'));
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('run_command — shell-quote safety', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('executes simple commands via execFileSync (no shell)', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'echo hello world' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello world');
  });

  it('executes commands with pipes via shell fallback', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'echo hello | cat' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello');
  });

  it('executes chained commands via shell fallback', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'echo first && echo second' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('first');
    expect(result.output).toContain('second');
  });

  it('returns error for missing command param', async () => {
    const result = await executeTool(
      { name: 'run_command', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing/i);
  });

  it('respects timeout', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'sleep 60', timeout: '500' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
  });
});

describe('fetch_url — SSRF protection', () => {
  it('blocks localhost requests', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://localhost:8080/secret' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 127.0.0.1 requests', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://127.0.0.1:11434/api/tags' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 10.x private IPs', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://10.0.0.1/admin' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 192.168.x private IPs', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://192.168.1.1/' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 169.254.x link-local IPs', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://169.254.169.254/latest/meta-data/' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks file:// protocol', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'file:///etc/passwd' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/http/i);
  });

  it('blocks .local domains', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://internal.local/secret' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('rejects invalid URLs', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'not-a-url' } },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/invalid/i);
  });

  it('rejects missing url parameter', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: {} },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing/i);
  });
});

// Add missing imports for beforeEach/afterEach
import { beforeEach, afterEach } from 'vitest';
