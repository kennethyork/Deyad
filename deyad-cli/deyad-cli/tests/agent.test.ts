/**
 * Tests for agent module — extracted helpers, conversation compaction, action detection, security.
 */
import { describe, it, expect } from 'vitest';

// Extracted helpers are now exported and directly testable
import {
  parseToolCallsFromTurn,
  dispatchTools,
  runAutoLint,
  formatToolResultMessages,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
} from '../src/agent.js';
import type { AgentCallbacks } from '../src/agent.js';

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

// ── Tests for extracted agent helpers ──────────────────────────────────────

describe('parseToolCallsFromTurn', () => {
  it('parses native tool calls when present', () => {
    const nativeCalls = [
      { function: { name: 'read_file', arguments: { path: 'foo.ts' } } },
    ];
    const { toolCalls, usedNativeTools } = parseToolCallsFromTurn(nativeCalls, '', '');
    expect(usedNativeTools).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('read_file');
    expect(toolCalls[0]!.params['path']).toBe('foo.ts');
  });

  it('converts numeric arguments to strings', () => {
    const nativeCalls = [
      { function: { name: 'run_command', arguments: { command: 'echo', timeout: 5000 } } },
    ];
    const { toolCalls } = parseToolCallsFromTurn(nativeCalls, '', '');
    expect(toolCalls[0]!.params['timeout']).toBe('5000');
  });

  it('falls back to XML parsing when no native calls', () => {
    const xmlContent = '<tool_call>\n<name>list_files</name>\n</tool_call>';
    const { toolCalls, usedNativeTools } = parseToolCallsFromTurn([], xmlContent, '');
    expect(usedNativeTools).toBe(false);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('list_files');
  });

  it('parses from thinking + response when no native calls', () => {
    const thinking = '<tool_call>\n<name>read_file</name>\n<param name="path">a.ts</param>\n</tool_call>';
    const { toolCalls } = parseToolCallsFromTurn([], '', thinking);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('read_file');
  });

  it('returns empty array for plain text response', () => {
    const { toolCalls } = parseToolCallsFromTurn([], 'Hello, I can help!', '');
    expect(toolCalls).toHaveLength(0);
  });
});

describe('formatToolResultMessages', () => {
  const results = [
    { tool: 'read_file', success: true, output: 'file contents' },
    { tool: 'edit_file', success: false, output: 'no match found' },
  ];

  it('formats native tool results as individual tool messages', () => {
    const msgs = formatToolResultMessages(results, true);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('tool');
    expect(msgs[0]!.content).toContain('[success]');
    expect(msgs[0]!.tool_name).toBe('read_file');
    expect(msgs[1]!.content).toContain('[error]');
    expect(msgs[1]!.tool_name).toBe('edit_file');
  });

  it('formats XML results as a single user message', () => {
    const msgs = formatToolResultMessages(results, false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toContain('<tool_result>');
    expect(msgs[0]!.content).toContain('<name>read_file</name>');
    expect(msgs[0]!.content).toContain('<status>success</status>');
    expect(msgs[0]!.content).toContain('<status>error</status>');
  });
});

describe('READ_ONLY_TOOLS / WRITE_TOOLS', () => {
  it('read-only and write sets are disjoint', () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(WRITE_TOOLS.has(tool)).toBe(false);
    }
  });

  it('read-only set contains expected tools', () => {
    expect(READ_ONLY_TOOLS.has('read_file')).toBe(true);
    expect(READ_ONLY_TOOLS.has('list_files')).toBe(true);
    expect(READ_ONLY_TOOLS.has('search_files')).toBe(true);
    expect(READ_ONLY_TOOLS.has('git_status')).toBe(true);
  });

  it('write set contains expected tools', () => {
    expect(WRITE_TOOLS.has('write_files')).toBe(true);
    expect(WRITE_TOOLS.has('edit_file')).toBe(true);
    expect(WRITE_TOOLS.has('run_command')).toBe(true);
  });
});

describe('dispatchTools', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-dispatch-'));
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatches read-only tools in parallel', async () => {
    const startOrder: string[] = [];
    const callbacks = {
      onToolStart: (name: string) => startOrder.push(name),
      onToolResult: () => {},
    };
    const calls = [
      { name: 'read_file', params: { path: 'hello.txt' } },
      { name: 'list_files', params: {} },
    ];
    const { results, filesChanged } = await dispatchTools(
      calls, tmpDir, {}, callbacks, [], new AbortController().signal,
    );
    expect(results).toHaveLength(2);
    expect(filesChanged).toBe(false);
    expect(startOrder).toEqual(['read_file', 'list_files']);
  });

  it('dispatches write tools sequentially', async () => {
    const calls = [
      { name: 'write_files', params: { path: 'new.txt', content: 'created' } },
    ];
    const callbacks = { onToolStart: () => {}, onToolResult: () => {} };
    const changedFiles: string[] = [];
    const { results, filesChanged } = await dispatchTools(
      calls, tmpDir, {}, callbacks, changedFiles, new AbortController().signal,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(filesChanged).toBe(true);
    expect(changedFiles).toContain('new.txt');
  });
});
