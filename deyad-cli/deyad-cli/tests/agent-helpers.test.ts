/**
 * Tests for agent-helpers — tool dispatch classification, output formatting & truncation.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  MAX_TOOL_OUTPUT_CHARS,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  BROWSER_READ_ONLY_ACTIONS,
  parseToolCallsFromTurn,
  formatToolResultMessages,
  truncateOutput,
} from '../src/agent-helpers.js';
import type { ToolResult } from '../src/tools.js';
import type { OllamaToolCall } from '../src/ollama.js';

// ── Constants ─────────────────────────────────────────────────────────────────

describe('READ_ONLY_TOOLS', () => {
  it('contains expected read tools', () => {
    for (const t of ['list_files', 'read_file', 'search_files', 'glob_files', 'fetch_url', 'git_status', 'git_log', 'memory_read']) {
      expect(READ_ONLY_TOOLS.has(t)).toBe(true);
    }
  });

  it('does not contain write tools', () => {
    for (const t of ['write_files', 'edit_file', 'run_command', 'delete_file']) {
      expect(READ_ONLY_TOOLS.has(t)).toBe(false);
    }
  });
});

describe('WRITE_TOOLS', () => {
  it('contains expected write tools', () => {
    for (const t of ['write_files', 'edit_file', 'delete_file', 'multi_edit', 'run_command']) {
      expect(WRITE_TOOLS.has(t)).toBe(true);
    }
  });

  it('does not overlap with READ_ONLY_TOOLS', () => {
    for (const t of WRITE_TOOLS) {
      expect(READ_ONLY_TOOLS.has(t)).toBe(false);
    }
  });
});

describe('BROWSER_READ_ONLY_ACTIONS', () => {
  it('classifies navigate and screenshot as read-only', () => {
    expect(BROWSER_READ_ONLY_ACTIONS.has('navigate')).toBe(true);
    expect(BROWSER_READ_ONLY_ACTIONS.has('screenshot')).toBe(true);
    expect(BROWSER_READ_ONLY_ACTIONS.has('get_text')).toBe(true);
    expect(BROWSER_READ_ONLY_ACTIONS.has('console')).toBe(true);
    expect(BROWSER_READ_ONLY_ACTIONS.has('close')).toBe(true);
  });

  it('does not include click or type', () => {
    expect(BROWSER_READ_ONLY_ACTIONS.has('click')).toBe(false);
    expect(BROWSER_READ_ONLY_ACTIONS.has('type')).toBe(false);
  });
});

// ── parseToolCallsFromTurn ────────────────────────────────────────────────────

describe('parseToolCallsFromTurn', () => {
  it('parses native tool calls and sanitises names', () => {
    const native: OllamaToolCall[] = [
      { function: { name: 'read_file', arguments: { path: 'foo.ts' } } },
    ];
    const { toolCalls, usedNativeTools } = parseToolCallsFromTurn(native, '', '');
    expect(usedNativeTools).toBe(true);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('read_file');
    expect(toolCalls[0]!.params['path']).toBe('foo.ts');
  });

  it('strips HTML tags from native tool call names', () => {
    const native: OllamaToolCall[] = [
      { function: { name: '<b>read_file</b>', arguments: { path: 'a' } } },
    ];
    const { toolCalls } = parseToolCallsFromTurn(native, '', '');
    expect(toolCalls[0]!.name).toBe('read_file');
  });

  it('falls back to XML parsing when no native calls', () => {
    const xml = '<tool_call><name>write_files</name><param name="files">a.ts</param></tool_call>';
    const { toolCalls, usedNativeTools } = parseToolCallsFromTurn([], xml, '');
    expect(usedNativeTools).toBe(false);
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]!.name).toBe('write_files');
  });

  it('combines thinking + response for XML fallback', () => {
    const thinking = '<tool_call><name>list_files</name></tool_call>';
    const { toolCalls } = parseToolCallsFromTurn([], '', thinking);
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]!.name).toBe('list_files');
  });

  it('returns empty array when no tools detected', () => {
    const { toolCalls, usedNativeTools } = parseToolCallsFromTurn([], 'just text', '');
    expect(usedNativeTools).toBe(false);
    expect(toolCalls).toHaveLength(0);
  });

  it('converts non-string arguments to strings', () => {
    const native: OllamaToolCall[] = [
      { function: { name: 'write_files', arguments: { count: 42 as unknown as string } } },
    ];
    const { toolCalls } = parseToolCallsFromTurn(native, '', '');
    expect(toolCalls[0]!.params['count']).toBe('42');
  });
});

// ── truncateOutput ────────────────────────────────────────────────────────────

describe('truncateOutput', () => {
  it('returns short text unchanged', () => {
    expect(truncateOutput('hello')).toBe('hello');
  });

  it('returns text at exactly max length unchanged', () => {
    const text = 'a'.repeat(MAX_TOOL_OUTPUT_CHARS);
    expect(truncateOutput(text)).toBe(text);
  });

  it('truncates long text with head + tail', () => {
    const text = 'a'.repeat(MAX_TOOL_OUTPUT_CHARS + 1000);
    const result = truncateOutput(text);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('truncated');
  });

  it('preserves start and end of long output', () => {
    const head = 'START_MARKER_' + 'x'.repeat(500);
    const tail = 'y'.repeat(500) + '_END_MARKER';
    const middle = 'z'.repeat(MAX_TOOL_OUTPUT_CHARS);
    const text = head + middle + tail;
    const result = truncateOutput(text);
    expect(result).toContain('START_MARKER');
    expect(result).toContain('END_MARKER');
  });

  it('respects custom max parameter', () => {
    const text = 'a'.repeat(200);
    const result = truncateOutput(text, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
  });
});

// ── formatToolResultMessages ──────────────────────────────────────────────────

describe('formatToolResultMessages', () => {
  const results: ToolResult[] = [
    { tool: 'read_file', success: true, output: 'file contents' },
    { tool: 'write_files', success: false, output: 'permission denied' },
  ];

  it('formats as native tool messages when usedNativeTools=true', () => {
    const msgs = formatToolResultMessages(results, true);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('tool');
    expect(msgs[0]!.content).toContain('[success]');
    expect(msgs[0]!.content).toContain('file contents');
    expect(msgs[1]!.content).toContain('[error]');
    expect(msgs[1]!.content).toContain('permission denied');
  });

  it('formats as XML user message when usedNativeTools=false', () => {
    const msgs = formatToolResultMessages(results, false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
    expect(msgs[0]!.content).toContain('<tool_result>');
    expect(msgs[0]!.content).toContain('read_file');
    expect(msgs[0]!.content).toContain('success');
    expect(msgs[0]!.content).toContain('error');
  });

  it('truncates large tool output in formatted messages', () => {
    const bigResult: ToolResult[] = [
      { tool: 'read_file', success: true, output: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500) },
    ];
    const msgs = formatToolResultMessages(bigResult, true);
    expect(msgs[0]!.content).toContain('truncated');
    expect(msgs[0]!.content.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 200);
  });

  it('handles empty results array', () => {
    expect(formatToolResultMessages([], true)).toHaveLength(0);
    const xml = formatToolResultMessages([], false);
    expect(xml).toHaveLength(1);
    expect(xml[0]!.content).toBe('');
  });
});
