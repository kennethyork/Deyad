/**
 * Tests for CLI tool parsing utilities — parseToolCalls, isDone, stripToolMarkup, simpleDiff.
 */
import { describe, it, expect } from 'vitest';
import { parseToolCalls, isDone, stripToolMarkup, simpleDiff } from '../tools.js';

describe('parseToolCalls', () => {
  it('parses a single tool call', () => {
    const text = `<tool_call>
<name>read_file</name>
<param name="path">src/index.ts</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('read_file');
    expect(calls[0].params.path).toBe('src/index.ts');
  });

  it('parses multiple tool calls', () => {
    const text = `Let me read these files.
<tool_call>
<name>read_file</name>
<param name="path">a.ts</param>
</tool_call>
<tool_call>
<name>read_file</name>
<param name="path">b.ts</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0].params.path).toBe('a.ts');
    expect(calls[1].params.path).toBe('b.ts');
  });

  it('parses tool call with multiple params', () => {
    const text = `<tool_call>
<name>edit_file</name>
<param name="path">index.ts</param>
<param name="old_string">const x = 1;</param>
<param name="new_string">const x = 2;</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('edit_file');
    expect(calls[0].params.path).toBe('index.ts');
    expect(calls[0].params.old_string).toBe('const x = 1;');
    expect(calls[0].params.new_string).toBe('const x = 2;');
  });

  it('returns empty array for no tool calls', () => {
    expect(parseToolCalls('Just some prose response.')).toEqual([]);
    expect(parseToolCalls('')).toEqual([]);
  });

  it('handles multiline param content', () => {
    const text = `<tool_call>
<name>write_files</name>
<param name="path">test.ts</param>
<param name="content">function hello() {
  return 'world';
}</param>
</tool_call>`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.content).toContain('function hello()');
    expect(calls[0].params.content).toContain("return 'world'");
  });

  it('handles tool calls mixed with prose', () => {
    const text = `I'll create the file now.
<tool_call>
<name>write_files</name>
<param name="path">hello.txt</param>
<param name="content">Hello!</param>
</tool_call>
Done creating the file.`;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('write_files');
  });
});

describe('isDone', () => {
  it('detects <done/>', () => {
    expect(isDone('All done! <done/>')).toBe(true);
  });

  it('detects <done />', () => {
    expect(isDone('Finished. <done />')).toBe(true);
  });

  it('detects <done>', () => {
    expect(isDone('Complete. <done>')).toBe(true);
  });

  it('returns false when no done tag', () => {
    expect(isDone('Still working...')).toBe(false);
    expect(isDone('')).toBe(false);
  });

  it('returns false for done in prose (not a tag)', () => {
    expect(isDone('I am done with this task')).toBe(false);
  });
});

describe('stripToolMarkup', () => {
  it('strips tool_call tags', () => {
    const text = 'Prose <tool_call><name>x</name></tool_call> more.';
    expect(stripToolMarkup(text)).toBe('Prose  more.');
  });

  it('strips tool_result tags', () => {
    const text = 'Before <tool_result><name>x</name><output>y</output></tool_result> after.';
    expect(stripToolMarkup(text)).toBe('Before  after.');
  });

  it('strips think tags', () => {
    const text = '<think>internal thought</think>Visible text.';
    expect(stripToolMarkup(text)).toBe('Visible text.');
  });

  it('strips done tags', () => {
    const text = 'Summary of changes. <done/>';
    expect(stripToolMarkup(text)).toBe('Summary of changes.');
  });

  it('strips all markup types at once', () => {
    const text = '<think>hmm</think>Hello<tool_call><name>x</name></tool_call><done/>';
    expect(stripToolMarkup(text)).toBe('Hello');
  });

  it('returns empty string for all-markup content', () => {
    expect(stripToolMarkup('<done/>')).toBe('');
  });
});

describe('simpleDiff', () => {
  it('produces a diff for changed lines', () => {
    const old = 'line1\nline2\nline3';
    const neu = 'line1\nchanged\nline3';
    const diff = simpleDiff(old, neu, 'test.txt');
    expect(diff).toContain('--- a/test.txt');
    expect(diff).toContain('+++ b/test.txt');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+changed');
  });

  it('reports no changes for identical files', () => {
    const text = 'same\ncontent';
    expect(simpleDiff(text, text, 'test.txt')).toBe('(no changes)');
  });

  it('handles added lines', () => {
    const old = 'a\nb';
    const neu = 'a\nb\nc';
    const diff = simpleDiff(old, neu, 'f.txt');
    expect(diff).toContain('+c');
  });

  it('handles removed lines', () => {
    const old = 'a\nb\nc';
    const neu = 'a\nc';
    const diff = simpleDiff(old, neu, 'f.txt');
    expect(diff).toContain('-b');
  });

  it('handles empty old text (new file)', () => {
    const diff = simpleDiff('', 'new content', 'new.txt');
    expect(diff).toContain('+new content');
  });
});
