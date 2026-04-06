import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseToolCalls, isDone, stripToolMarkup, executeTool } from './agentTools';

describe('parseToolCalls', () => {
  it('returns empty array when no tool calls present', () => {
    expect(parseToolCalls('Hello, I will help you build this.')).toEqual([]);
  });

  it('parses a single tool call with no params', () => {
    const text = `<tool_call>
<name>list_files</name>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('list_files');
    expect(calls[0].params).toEqual({});
  });

  it('parses a single tool call with params', () => {
    const text = `<tool_call>
<name>read_file</name>
<param name="path">src/App.tsx</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('read_file');
    expect(calls[0].params).toEqual({ path: 'src/App.tsx' });
  });

  it('parses multiple tool calls', () => {
    const text = `Let me read both files.

<tool_call>
<name>read_file</name>
<param name="path">src/App.tsx</param>
</tool_call>

<tool_call>
<name>read_file</name>
<param name="path">src/index.css</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].params.path).toBe('src/App.tsx');
    expect(calls[1].params.path).toBe('src/index.css');
  });

  it('parses write_files with multiple indexed params', () => {
    const text = `<tool_call>
<name>write_files</name>
<param name="file_0_path">src/App.tsx</param>
<param name="file_0_content">export default function App() {}</param>
<param name="file_1_path">src/index.css</param>
<param name="file_1_content">body { margin: 0; }</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('write_files');
    expect(calls[0].params.file_0_path).toBe('src/App.tsx');
    expect(calls[0].params.file_0_content).toBe('export default function App() {}');
    expect(calls[0].params.file_1_path).toBe('src/index.css');
  });

  it('handles multiline param content', () => {
    const text = `<tool_call>
<name>write_files</name>
<param name="path">src/App.tsx</param>
<param name="content">import React from 'react';

export default function App() {
  return <div>Hello</div>;
}</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.content).toContain('import React');
    expect(calls[0].params.content).toContain('return <div>Hello</div>');
  });

  it('parses edit_file with old_string and new_string', () => {
    const text = `<tool_call>
<name>edit_file</name>
<param name="path">src/App.tsx</param>
<param name="old_string">return <div>Hello</div>;</param>
<param name="new_string">return <div>World</div>;</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('edit_file');
    expect(calls[0].params.old_string).toBe('return <div>Hello</div>;');
    expect(calls[0].params.new_string).toBe('return <div>World</div>;');
  });

  it('ignores malformed tool_call blocks', () => {
    const text = `<tool_call>
This has no name tag
</tool_call>`;
    // Pattern requires <name>...</name>, so this won't match
    expect(parseToolCalls(text)).toEqual([]);
  });

  it('handles tool call with extra whitespace', () => {
    const text = `<tool_call>
  <name>  list_files  </name>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('list_files');
  });
});

describe('isDone', () => {
  it('returns false for regular text', () => {
    expect(isDone('I finished building the app.')).toBe(false);
  });

  it('detects <done/> self-closing tag', () => {
    expect(isDone('All tasks complete.\n<done/>')).toBe(true);
  });

  it('detects <done /> with space', () => {
    expect(isDone('Finished. <done />')).toBe(true);
  });

  it('detects <done> opening tag', () => {
    expect(isDone('Done! <done>')).toBe(true);
  });

  it('detects done tag in the middle of text', () => {
    expect(isDone('Some text <done/> more text')).toBe(true);
  });
});

describe('stripToolMarkup', () => {
  it('returns plain text unchanged', () => {
    expect(stripToolMarkup('Hello world')).toBe('Hello world');
  });

  it('removes tool_call blocks', () => {
    const text = `I'll read the file.

<tool_call>
<name>read_file</name>
<param name="path">src/App.tsx</param>
</tool_call>

Here is what I found.`;
    const result = stripToolMarkup(text);
    expect(result).not.toContain('tool_call');
    expect(result).not.toContain('read_file');
    expect(result).toContain("I'll read the file.");
    expect(result).toContain('Here is what I found.');
  });

  it('removes tool_result blocks', () => {
    const text = `Result:

<tool_result>
<name>list_files</name>
<status>success</status>
<output>src/App.tsx</output>
</tool_result>

Done.`;
    const result = stripToolMarkup(text);
    expect(result).not.toContain('tool_result');
    expect(result).toContain('Result:');
    expect(result).toContain('Done.');
  });

  it('removes done tags', () => {
    expect(stripToolMarkup('All done. <done/>')).toBe('All done.');
  });

  it('strips multiple different markup types', () => {
    const text = `Thinking...

<tool_call>
<name>list_files</name>
</tool_call>

<tool_result>
<output>files</output>
</tool_result>

Complete. <done/>`;
    const result = stripToolMarkup(text);
    expect(result).toContain('Thinking...');
    expect(result).toContain('Complete.');
    expect(result).not.toContain('tool_call');
    expect(result).not.toContain('tool_result');
    expect(result).not.toContain('done');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripToolMarkup('  <done/>  ')).toBe('');
  });

  it('returns empty string when text is only markup', () => {
    const text = `<tool_call>
<name>list_files</name>
</tool_call>
<done/>`;
    expect(stripToolMarkup(text)).toBe('');
  });
});

describe('executeTool (integration)', () => {
  const appId = 'test-app-123';
  let savedWindow: unknown;

  beforeEach(() => {
    savedWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      deyad: {
        readFiles: vi.fn().mockResolvedValue({
          'src/index.ts': 'console.log("hello");',
          'package.json': '{"name":"test"}',
        }),
        writeFiles: vi.fn().mockResolvedValue(undefined),
        terminalExec: vi.fn(),
        onTerminalData: vi.fn().mockReturnValue(vi.fn()),
        onTerminalExit: vi.fn().mockReturnValue(vi.fn()),
      },
    };
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).window = savedWindow;
  });

  it('list_files returns sorted file list', async () => {
    const result = await executeTool({ name: 'list_files', params: {} }, appId);
    expect(result.success).toBe(true);
    expect(result.output).toContain('package.json');
    expect(result.output).toContain('src/index.ts');
  });

  it('read_file returns file content', async () => {
    const result = await executeTool(
      { name: 'read_file', params: { path: 'src/index.ts' } },
      appId,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('console.log("hello");');
  });

  it('read_file fails for missing path param', async () => {
    const result = await executeTool({ name: 'read_file', params: {} }, appId);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing');
  });

  it('read_file fails for nonexistent file', async () => {
    const result = await executeTool(
      { name: 'read_file', params: { path: 'nope.ts' } },
      appId,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });

  it('write_files writes a single file', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: 'out.ts', content: 'code()' } },
      appId,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Wrote 1 file');
    expect((window as any).deyad.writeFiles).toHaveBeenCalledWith(appId, { 'out.ts': 'code()' });
  });

  it('write_files writes indexed files', async () => {
    const result = await executeTool(
      {
        name: 'write_files',
        params: {
          file_0_path: 'a.ts',
          file_0_content: 'aaa',
          file_1_path: 'b.ts',
          file_1_content: 'bbb',
        },
      },
      appId,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Wrote 2 file');
  });

  it('search_files finds matches', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'hello' } },
      appId,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('src/index.ts');
  });

  it('search_files reports no matches', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'zzzznotfound' } },
      appId,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches');
  });

  it('unknown tool returns failure', async () => {
    const result = await executeTool({ name: 'nonexistent', params: {} }, appId);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown tool');
  });

  it('audit log is emitted via console.info', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await executeTool({ name: 'list_files', params: {} }, appId);
    expect(spy).toHaveBeenCalledWith('[deyad:audit]', expect.any(String));
    const entry = JSON.parse(spy.mock.calls[0][1] as string);
    expect(entry.tool).toBe('list_files');
    expect(entry.appId).toBe(appId);
    expect(entry.success).toBe(true);
    spy.mockRestore();
  });
});
