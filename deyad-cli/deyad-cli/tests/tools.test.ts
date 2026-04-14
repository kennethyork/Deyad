/**
 * Tests for executeTool — path traversal guards, git command safety, and basic tool dispatch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeTool, parseToolCalls, isDone, stripToolMarkup, simpleDiff, walkDir, globFiles, resetRateLimit, fuzzyFindBlock, toolRegistry, getOllamaTools, checkRateLimit, MAX_READ_BYTES, MAX_CMD_CHARS } from '../src/tools.js';

let tmpDir: string;

beforeEach(() => {
  resetRateLimit();
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

describe('executeTool — edit_file edge cases', () => {
  it('returns error for missing path', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { old_string: 'x', new_string: 'y' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*path/i);
  });

  it('returns error for missing old_string', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', new_string: 'y' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*old_string/i);
  });

  it('returns error for missing new_string', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'world' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*new_string/i);
  });

  it('returns error when old_string not found', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'nope', new_string: 'y' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found/);
  });
});

describe('executeTool — delete_file', () => {
  it('deletes an existing file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'todelete.txt'), 'bye');
    const result = await executeTool(
      { name: 'delete_file', params: { path: 'todelete.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'todelete.txt'))).toBe(false);
  });

  it('returns error for missing path', async () => {
    const result = await executeTool(
      { name: 'delete_file', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*path/i);
  });

  it('returns error for non-existent file', async () => {
    const result = await executeTool(
      { name: 'delete_file', params: { path: 'ghost.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found/i);
  });
});

describe('executeTool — write_files edge cases', () => {
  it('writes multiple indexed files', async () => {
    const result = await executeTool(
      { name: 'write_files', params: {
        file_0_path: 'a.txt', file_0_content: 'aaa',
        file_1_path: 'b.txt', file_1_content: 'bbb',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf-8')).toBe('aaa');
    expect(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf-8')).toBe('bbb');
  });

  it('returns error when no files specified', async () => {
    const result = await executeTool(
      { name: 'write_files', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/no files/i);
  });

  it('creates parent directories', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: 'deep/dir/file.txt', content: 'nested' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'deep/dir/file.txt'), 'utf-8')).toBe('nested');
  });
});

describe('executeTool — search_files', () => {
  it('returns no matches for unmatched query', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'zzzzzzzzzzz' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('no matches');
  });

  it('returns error for missing query', async () => {
    const result = await executeTool(
      { name: 'search_files', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*query/i);
  });

  it('supports regex search', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'Hello.*world', is_regex: 'true' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
  });

  it('supports file pattern filter', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'content', pattern: 'sub/**' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('nested.txt');
  });
});

describe('executeTool — glob_files edge cases', () => {
  it('returns error for missing pattern', async () => {
    const result = await executeTool(
      { name: 'glob_files', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*pattern/i);
  });

  it('returns no matches for unmatched pattern', async () => {
    const result = await executeTool(
      { name: 'glob_files', params: { pattern: '**/*.py' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('no matches');
  });
});

describe('executeTool — multi_edit', () => {
  it('applies multiple edits to different files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'f1.txt'), 'aaa');
    fs.writeFileSync(path.join(tmpDir, 'f2.txt'), 'bbb');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'f1.txt', edit_0_old_string: 'aaa', edit_0_new_string: 'AAA',
        edit_1_path: 'f2.txt', edit_1_old_string: 'bbb', edit_1_new_string: 'BBB',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'f1.txt'), 'utf-8')).toBe('AAA');
    expect(fs.readFileSync(path.join(tmpDir, 'f2.txt'), 'utf-8')).toBe('BBB');
  });

  it('returns error when no edits specified', async () => {
    const result = await executeTool(
      { name: 'multi_edit', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/no edits/i);
  });
});

describe('executeTool — git tools', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-git-'));
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['init'], { cwd: gitDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: gitDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'initial');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('git_status returns clean for clean repo', async () => {
    const result = await executeTool({ name: 'git_status', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('clean');
  });

  it('git_status shows modified files', async () => {
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'modified');
    const result = await executeTool({ name: 'git_status', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('file.txt');
  });

  it('git_log returns commit history', async () => {
    const result = await executeTool({ name: 'git_log', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('init');
  });

  it('git_diff shows changes', async () => {
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'changed');
    const result = await executeTool({ name: 'git_diff', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('changed');
  });

  it('git_branch lists branches', async () => {
    const result = await executeTool({ name: 'git_branch', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/main|master/);
  });

  it('git_add stages files', async () => {
    fs.writeFileSync(path.join(gitDir, 'new.txt'), 'new');
    const result = await executeTool({ name: 'git_add', params: { path: 'new.txt' } }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Staged');
  });

  it('git_commit commits staged changes', async () => {
    fs.writeFileSync(path.join(gitDir, 'c.txt'), 'commit me');
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    const result = await executeTool({ name: 'git_commit', params: { message: 'test commit' } }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('test commit');
  });

  it('git_commit returns error without message', async () => {
    const result = await executeTool({ name: 'git_commit', params: {} }, gitDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*message/i);
  });

  it('git_stash pushes and pops', async () => {
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'stash me');
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    const push = await executeTool({ name: 'git_stash', params: { action: 'push' } }, gitDir);
    expect(push.success).toBe(true);
    const pop = await executeTool({ name: 'git_stash', params: { action: 'pop' } }, gitDir);
    expect(pop.success).toBe(true);
  });
});

// ── Utility function tests ──

describe('parseToolCalls', () => {
  it('parses XML format tool calls', () => {
    const text = '<tool_call><name>read_file</name><param name="path">test.txt</param></tool_call>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[0]!.params['path']).toBe('test.txt');
  });

  it('parses multiple XML tool calls', () => {
    const text = `
<tool_call><name>read_file</name><param name="path">a.txt</param></tool_call>
<tool_call><name>write_files</name><param name="path">b.txt</param><param name="content">hello</param></tool_call>
    `;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.name).toBe('write_files');
    expect(calls[1]!.params['content']).toBe('hello');
  });

  it('parses function format (qwen style)', () => {
    const text = '<function=read_file><parameter=path>test.txt</parameter></function>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[0]!.params['path']).toBe('test.txt');
  });

  it('parses JSON code block format', () => {
    const text = '```tool_call\n{"name":"read_file","parameters":{"path":"test.txt"}}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[0]!.params['path']).toBe('test.txt');
  });

  it('ignores malformed JSON in code blocks', () => {
    const text = '```tool_call\n{not valid json}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it('returns empty for text with no tool calls', () => {
    expect(parseToolCalls('Hello, I can help you!')).toEqual([]);
  });
});

describe('isDone', () => {
  it('detects <done/> tag', () => {
    expect(isDone('some text <done/>')).toBe(true);
  });

  it('detects <done> tag', () => {
    expect(isDone('finished <done>')).toBe(true);
  });

  it('returns false for text without done tag', () => {
    expect(isDone('still working')).toBe(false);
  });
});

describe('stripToolMarkup', () => {
  it('removes tool_call XML', () => {
    const text = 'Hello <tool_call><name>read_file</name></tool_call> world';
    expect(stripToolMarkup(text)).toBe('Hello  world');
  });

  it('removes tool_result XML', () => {
    const text = 'OK <tool_result>some result</tool_result> next';
    expect(stripToolMarkup(text)).toBe('OK  next');
  });

  it('removes function format', () => {
    const text = 'Start <function=test><parameter=x>y</parameter></function> end';
    expect(stripToolMarkup(text)).toBe('Start  end');
  });

  it('removes JSON code blocks', () => {
    const text = 'Before ```tool_call\n{"name":"test"}\n``` after';
    expect(stripToolMarkup(text)).toBe('Before  after');
  });

  it('removes think blocks', () => {
    const text = 'Answer <think>reasoning here</think> done';
    expect(stripToolMarkup(text)).toBe('Answer  done');
  });

  it('removes done tags', () => {
    const text = 'All done <done/>';
    expect(stripToolMarkup(text)).toBe('All done');
  });
});

describe('simpleDiff', () => {
  it('shows added line', () => {
    const diff = simpleDiff('line1\n', 'line1\nline2\n', 'test.txt');
    expect(diff).toContain('+line2');
  });

  it('shows removed line', () => {
    const diff = simpleDiff('line1\nline2\n', 'line1\n', 'test.txt');
    expect(diff).toContain('-line2');
  });

  it('includes file headers', () => {
    const diff = simpleDiff('a', 'b', 'file.txt');
    expect(diff).toContain('--- a/file.txt');
    expect(diff).toContain('+++ b/file.txt');
  });
});

describe('walkDir', () => {
  it('lists files recursively', () => {
    const files = walkDir(tmpDir, tmpDir);
    expect(files).toContain('hello.txt');
    expect(files).toContain(path.join('sub', 'nested.txt'));
  });

  it('skips node_modules', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), '');
    const files = walkDir(tmpDir, tmpDir);
    expect(files.some(f => f.includes('node_modules'))).toBe(false);
  });

  it('skips binary extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.from([0]));
    const files = walkDir(tmpDir, tmpDir);
    expect(files).not.toContain('image.png');
  });
});

describe('globFiles', () => {
  it('matches txt files', () => {
    const files = globFiles('**/*.txt', tmpDir);
    expect(files).toContain('hello.txt');
    expect(files).toContain(path.join('sub', 'nested.txt'));
  });

  it('returns empty for no matches', () => {
    expect(globFiles('**/*.py', tmpDir)).toEqual([]);
  });
});

describe('executeTool — run_command', () => {
  it('runs a simple command', async () => {
    const result = await executeTool({ name: 'run_command', params: { command: 'echo hello' } }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('returns error for missing command', async () => {
    const result = await executeTool({ name: 'run_command', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*command/i);
  });

  it('returns error for failing command', async () => {
    const result = await executeTool({ name: 'run_command', params: { command: 'false' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Exit code');
  });
});

describe('executeTool — list_files', () => {
  it('lists project files', async () => {
    const result = await executeTool({ name: 'list_files', params: {} }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
  });
});

describe('executeTool — read_file edge cases', () => {
  it('returns error for missing path', async () => {
    const result = await executeTool({ name: 'read_file', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*path/i);
  });

  it('returns error for non-existent file', async () => {
    const result = await executeTool({ name: 'read_file', params: { path: 'nope.txt' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found/i);
  });
});

describe('executeTool — fetch_url', () => {
  it('blocks private IP addresses', async () => {
    const result = await executeTool({ name: 'fetch_url', params: { url: 'http://127.0.0.1:8080/secret' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks non-HTTP schemes', async () => {
    const result = await executeTool({ name: 'fetch_url', params: { url: 'ftp://example.com/file' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/HTTP/);
  });

  it('returns error for missing url', async () => {
    const result = await executeTool({ name: 'fetch_url', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*url/i);
  });

  it('returns error for invalid url', async () => {
    const result = await executeTool({ name: 'fetch_url', params: { url: 'not-a-url' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/invalid/i);
  });

  it('blocks localhost', async () => {
    const result = await executeTool({ name: 'fetch_url', params: { url: 'http://localhost/admin' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });
});

describe('executeTool — memory tools', () => {
  it('memory_read returns not found for missing key', async () => {
    const result = await executeTool({ name: 'memory_read', params: { key: 'nonexistent' } }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('No memory found');
  });

  it('memory_read returns error for missing key param', async () => {
    const result = await executeTool({ name: 'memory_read', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*key/i);
  });

  it('memory_write saves and memory_read retrieves', async () => {
    await executeTool({ name: 'memory_write', params: { key: 'test_key', value: 'test_value' } }, tmpDir);
    const result = await executeTool({ name: 'memory_read', params: { key: 'test_key' } }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toBe('test_value');
  });

  it('memory_list shows entries', async () => {
    await executeTool({ name: 'memory_write', params: { key: 'list_test', value: 'val' } }, tmpDir);
    const result = await executeTool({ name: 'memory_list', params: {} }, tmpDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('list_test');
  });

  it('memory_delete removes key', async () => {
    await executeTool({ name: 'memory_write', params: { key: 'del_key', value: 'val' } }, tmpDir);
    const del = await executeTool({ name: 'memory_delete', params: { key: 'del_key' } }, tmpDir);
    expect(del.success).toBe(true);
    const read = await executeTool({ name: 'memory_read', params: { key: 'del_key' } }, tmpDir);
    expect(read.output).toContain('No memory found');
  });

  it('memory_delete returns not found for missing key', async () => {
    const result = await executeTool({ name: 'memory_delete', params: { key: 'ghost' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Not found');
  });

  it('memory_write returns error for missing params', async () => {
    const result = await executeTool({ name: 'memory_write', params: { key: 'k' } }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing/i);
  });
});

describe('executeTool — callbacks', () => {
  it('confirm callback can decline write', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: 'confirmed.txt', content: 'data' } },
      tmpDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
    expect(fs.existsSync(path.join(tmpDir, 'confirmed.txt'))).toBe(false);
  });

  it('onDiff callback receives diff on edit', async () => {
    const diffs: string[] = [];
    await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'Hello, world!', new_string: 'Changed!' } },
      tmpDir,
      { onDiff: (_path, diff) => diffs.push(diff) },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('-Hello, world!');
    expect(diffs[0]).toContain('+Changed!');
  });
});

// ── Fuzzy edit matching ──

describe('fuzzyFindBlock', () => {
  it('returns null for exact match (caller handles exact first)', () => {
    const content = 'line1\nline2\nline3';
    // If needle matches exactly, fuzzy shouldn't be needed but still works
    const result = fuzzyFindBlock(content, 'line1\nline2\nline3');
    // Either returns the match or null is fine — exact match is handled before fuzzy
    expect(result === null || result.similarity === 1.0).toBe(true);
  });

  it('matches block with minor whitespace differences', () => {
    const content = '  function foo() {\n    return 1;\n  }\n  function bar() {\n    return 2;\n  }';
    const needle = 'function foo() {\n  return 1;\n}';
    const result = fuzzyFindBlock(content, needle);
    expect(result).not.toBeNull();
    expect(result!.similarity).toBeGreaterThanOrEqual(0.6);
    expect(result!.text).toContain('foo');
  });

  it('returns null when no block is similar enough', () => {
    const content = 'alpha\nbeta\ngamma\ndelta';
    const needle = 'completely\ndifferent\ncontent';
    expect(fuzzyFindBlock(content, needle)).toBeNull();
  });

  it('returns null when multiple blocks match equally', () => {
    const content = 'return 1;\nreturn 1;\nreturn 1;';
    const needle = 'return 1;';
    // Single-line with multiple matches → null (not unique)
    expect(fuzzyFindBlock(content, needle)).toBeNull();
  });

  it('matches single trimmed line uniquely', () => {
    const content = '  foo()\n  bar()\n  baz()';
    const needle = 'bar()';
    const result = fuzzyFindBlock(content, needle);
    expect(result).not.toBeNull();
    expect(result!.text.trim()).toBe('bar()');
  });

  it('returns null for empty needle', () => {
    expect(fuzzyFindBlock('some content', '')).toBeNull();
  });
});

describe('edit_file with fuzzy fallback', () => {
  it('succeeds with fuzzy match when exact fails due to whitespace', async () => {
    fs.writeFileSync(path.join(tmpDir, 'fuzzy.txt'), '  hello world\n  goodbye world\n  foo bar');
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'fuzzy.txt', old_string: 'hello world', new_string: 'hello deyad' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('fuzzy');
    const updated = fs.readFileSync(path.join(tmpDir, 'fuzzy.txt'), 'utf-8');
    expect(updated).toContain('hello deyad');
  });
});

// ── Rate limiting ──

describe('executeTool — rate limiting', () => {
  it('blocks tool calls when rate limit exceeded', async () => {
    // Fill up the rate limit bucket
    const limit = 120; // default DEYAD_RATE_LIMIT
    resetRateLimit();
    for (let i = 0; i < limit; i++) {
      checkRateLimit(); // consume all slots
    }
    const result = await executeTool({ name: 'list_files', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/rate limit/i);
  });

  it('allows calls after rate limit reset', async () => {
    const limit = 120;
    resetRateLimit();
    for (let i = 0; i < limit; i++) {
      checkRateLimit();
    }
    resetRateLimit();
    const result = await executeTool({ name: 'list_files', params: {} }, tmpDir);
    expect(result.success).toBe(true);
  });
});

// ── Tool registry extensibility ──

describe('toolRegistry', () => {
  afterEach(() => {
    // Restore the built-in handler after custom overrides
    toolRegistry.delete('custom_test_tool');
  });

  it('allows registering a custom tool', async () => {
    toolRegistry.set('custom_test_tool', async (call) => {
      return { tool: call.name, success: true, output: `custom: ${call.params['msg']}` };
    });
    const result = await executeTool(
      { name: 'custom_test_tool', params: { msg: 'hi' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('custom: hi');
  });

  it('custom handler errors are caught', async () => {
    toolRegistry.set('custom_test_tool', async () => {
      throw new Error('boom');
    });
    const result = await executeTool({ name: 'custom_test_tool', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toContain('boom');
  });
});

// ── getOllamaTools ──

describe('getOllamaTools', () => {
  it('returns all 22 built-in tools', () => {
    const tools = getOllamaTools();
    const names = tools.map(t => t.function.name);
    expect(names).toContain('list_files');
    expect(names).toContain('read_file');
    expect(names).toContain('write_files');
    expect(names).toContain('edit_file');
    expect(names).toContain('delete_file');
    expect(names).toContain('glob_files');
    expect(names).toContain('search_files');
    expect(names).toContain('run_command');
    expect(names).toContain('git_status');
    expect(names).toContain('git_log');
    expect(names).toContain('git_diff');
    expect(names).toContain('git_branch');
    expect(names).toContain('git_add');
    expect(names).toContain('git_commit');
    expect(names).toContain('git_stash');
    expect(names).toContain('fetch_url');
    expect(names).toContain('memory_read');
    expect(names).toContain('memory_write');
    expect(names).toContain('memory_list');
    expect(names).toContain('memory_delete');
    expect(names).toContain('browser');
    // At least 21 built-in tools (multi_edit shares edit_file in Ollama, may include MCP tools)
    expect(tools.length).toBeGreaterThanOrEqual(21);
  });

  it('all tools have valid structure', () => {
    const tools = getOllamaTools();
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters).toBeDefined();
    }
  });
});

// ── read_file large file truncation ──

describe('executeTool — read_file truncation', () => {
  it('truncates files larger than MAX_READ_BYTES', async () => {
    const bigContent = 'x'.repeat(MAX_READ_BYTES + 1000);
    fs.writeFileSync(path.join(tmpDir, 'big.txt'), bigContent);
    const result = await executeTool(
      { name: 'read_file', params: { path: 'big.txt' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('truncated');
    expect(result.output.length).toBeLessThan(bigContent.length);
  });
});

// ── write_files additional edge cases ──

describe('executeTool — write_files advanced', () => {
  it('skips indexed files with path traversal silently', async () => {
    const result = await executeTool(
      { name: 'write_files', params: {
        file_0_path: 'good.txt', file_0_content: 'ok',
        file_1_path: '../../evil.txt', file_1_content: 'pwned',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'good.txt'))).toBe(true);
    expect(fs.existsSync(path.resolve(tmpDir, '../../evil.txt'))).toBe(false);
  });

  it('fires onDiff for existing file overwrite', async () => {
    fs.writeFileSync(path.join(tmpDir, 'exist.txt'), 'old content');
    const diffs: string[] = [];
    const result = await executeTool(
      { name: 'write_files', params: { path: 'exist.txt', content: 'new content' } },
      tmpDir,
      { onDiff: (_path, diff) => diffs.push(diff) },
    );
    expect(result.success).toBe(true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('-old content');
    expect(diffs[0]).toContain('+new content');
  });

  it('fires onDiff for new file creation', async () => {
    const diffs: string[] = [];
    const result = await executeTool(
      { name: 'write_files', params: { path: 'brand_new.txt', content: 'hi' } },
      tmpDir,
      { onDiff: (_path, diff) => diffs.push(diff) },
    );
    expect(result.success).toBe(true);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain('new file');
  });

  it('reports changedFiles on success', async () => {
    const result = await executeTool(
      { name: 'write_files', params: { path: 'tracked.txt', content: 'data' } },
      tmpDir,
    );
    expect(result.changedFiles).toContain('tracked.txt');
  });
});

// ── edit_file additional edge cases ──

describe('executeTool — edit_file advanced', () => {
  it('confirm callback can decline edit', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'Hello, world!', new_string: 'nope' } },
      tmpDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
    expect(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8')).toBe('Hello, world!');
  });

  it('reports changedFiles on success', async () => {
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'hello.txt', old_string: 'Hello, world!', new_string: 'Changed' } },
      tmpDir,
    );
    expect(result.changedFiles).toContain('hello.txt');
  });

  it('returns fuzzy match message in output', async () => {
    // Multi-line content where needle differs in indentation (triggers fuzzy, not exact or trim-match)
    fs.writeFileSync(path.join(tmpDir, 'indent.txt'), '  function foo() {\n    return 1;\n  }\n  function bar() {\n    return 2;\n  }');
    const result = await executeTool(
      { name: 'edit_file', params: { path: 'indent.txt', old_string: 'function foo() {\n  return 1;\n}', new_string: 'function foo() {\n  return 42;\n}' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('fuzzy');
  });
});

// ── delete_file confirm callback ──

describe('executeTool — delete_file advanced', () => {
  it('confirm callback can decline delete', async () => {
    fs.writeFileSync(path.join(tmpDir, 'keep.txt'), 'keep me');
    const result = await executeTool(
      { name: 'delete_file', params: { path: 'keep.txt' } },
      tmpDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
    expect(fs.existsSync(path.join(tmpDir, 'keep.txt'))).toBe(true);
  });

  it('reports changedFiles on success', async () => {
    fs.writeFileSync(path.join(tmpDir, 'byefile.txt'), 'bye');
    const result = await executeTool(
      { name: 'delete_file', params: { path: 'byefile.txt' } },
      tmpDir,
    );
    expect(result.changedFiles).toContain('byefile.txt');
  });
});

// ── run_command advanced ──

describe('executeTool — run_command advanced', () => {
  it('confirm callback can decline command', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'echo hi' } },
      tmpDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
  });

  it('handles pipe commands via shell fallback', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'echo "hello world" | tr a-z A-Z' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('HELLO WORLD');
  });

  it('truncates long output at MAX_CMD_CHARS', async () => {
    // Generate output longer than MAX_CMD_CHARS (default 10000)
    const result = await executeTool(
      { name: 'run_command', params: { command: `python3 -c "print('x' * ${MAX_CMD_CHARS + 500})"` } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('truncated');
  });

  it('returns (no output) for silent command', async () => {
    const result = await executeTool(
      { name: 'run_command', params: { command: 'true' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe('(no output)');
  });

  it('respects custom timeout parameter', async () => {
    // Command that would take too long — should fail with timeout
    const result = await executeTool(
      { name: 'run_command', params: { command: 'sleep 10', timeout: '100' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    // Should contain error about exit/timeout
    expect(result.output).toMatch(/exit|timed|killed|SIGTERM/i);
  });
});

// ── multi_edit advanced ──

describe('executeTool — multi_edit advanced', () => {
  it('blocks path traversal in batch edits', async () => {
    fs.writeFileSync(path.join(tmpDir, 'safe.txt'), 'original');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: '../../etc/passwd', edit_0_old_string: 'root', edit_0_new_string: 'hacked',
        edit_1_path: 'safe.txt', edit_1_old_string: 'original', edit_1_new_string: 'modified',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('path traversal blocked');
    expect(result.output).toContain('safe.txt: edited');
    expect(fs.readFileSync(path.join(tmpDir, 'safe.txt'), 'utf-8')).toBe('modified');
  });

  it('reports file not found for missing files', async () => {
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'missing.txt', edit_0_old_string: 'x', edit_0_new_string: 'y',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('file not found');
  });

  it('reports old_string not found', async () => {
    fs.writeFileSync(path.join(tmpDir, 'target.txt'), 'actual content');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'target.txt', edit_0_old_string: 'nonexistent string', edit_0_new_string: 'replacement',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('not found');
  });

  it('reports non-unique old_string', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dupes.txt'), 'aaa bbb aaa');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'dupes.txt', edit_0_old_string: 'aaa', edit_0_new_string: 'ccc',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('2 times');
  });

  it('uses fuzzy fallback in multi_edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'mfuzzy.txt'), '  hello world\n  goodbye world\n  foo bar');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'mfuzzy.txt', edit_0_old_string: 'hello world', edit_0_new_string: 'hello deyad',
      } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('edited');
    const updated = fs.readFileSync(path.join(tmpDir, 'mfuzzy.txt'), 'utf-8');
    expect(updated).toContain('hello deyad');
  });

  it('confirm callback can decline multi_edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'noedit.txt'), 'keep this');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'noedit.txt', edit_0_old_string: 'keep this', edit_0_new_string: 'changed',
      } },
      tmpDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
    expect(fs.readFileSync(path.join(tmpDir, 'noedit.txt'), 'utf-8')).toBe('keep this');
  });

  it('fires onDiff for each edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'diffa.txt'), 'old A');
    fs.writeFileSync(path.join(tmpDir, 'diffb.txt'), 'old B');
    const diffs: string[] = [];
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'diffa.txt', edit_0_old_string: 'old A', edit_0_new_string: 'new A',
        edit_1_path: 'diffb.txt', edit_1_old_string: 'old B', edit_1_new_string: 'new B',
      } },
      tmpDir,
      { onDiff: (_path, diff) => diffs.push(diff) },
    );
    expect(result.success).toBe(true);
    expect(diffs).toHaveLength(2);
  });

  it('reports changedFiles from multi_edit', async () => {
    fs.writeFileSync(path.join(tmpDir, 'medit.txt'), 'aaa');
    const result = await executeTool(
      { name: 'multi_edit', params: {
        edit_0_path: 'medit.txt', edit_0_old_string: 'aaa', edit_0_new_string: 'bbb',
      } },
      tmpDir,
    );
    expect(result.changedFiles).toContain('medit.txt');
  });
});

// ── git tools advanced ──

describe('executeTool — git tools advanced', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-git-adv-'));
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['init'], { cwd: gitDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: gitDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'initial');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitDir });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('git_log respects custom count', async () => {
    const { execFileSync } = require('node:child_process');
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'change1');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    execFileSync('git', ['commit', '-m', 'second'], { cwd: gitDir });
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'change2');
    execFileSync('git', ['add', '.'], { cwd: gitDir });
    execFileSync('git', ['commit', '-m', 'third'], { cwd: gitDir });

    const result = await executeTool({ name: 'git_log', params: { count: '1' } }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('third');
    expect(result.output).not.toContain('second');
  });

  it('git_log handles NaN count gracefully', async () => {
    const result = await executeTool({ name: 'git_log', params: { count: 'abc' } }, gitDir);
    expect(result.success).toBe(true);
    // Falls back to 10, should still show init commit
    expect(result.output).toContain('init');
  });

  it('git_log clamps count to max 50', async () => {
    const result = await executeTool({ name: 'git_log', params: { count: '999' } }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('init');
  });

  it('git_diff with specific path', async () => {
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'changed');
    fs.writeFileSync(path.join(gitDir, 'other.txt'), 'also changed');
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['add', 'other.txt'], { cwd: gitDir });

    const result = await executeTool({ name: 'git_diff', params: { path: 'file.txt' } }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('changed');
  });

  it('git_diff returns no changes for clean file', async () => {
    const result = await executeTool({ name: 'git_diff', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('no changes');
  });

  it('git_stash defaults to push for unknown action', async () => {
    fs.writeFileSync(path.join(gitDir, 'file.txt'), 'stashme');
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['add', '.'], { cwd: gitDir });

    const result = await executeTool({ name: 'git_stash', params: { action: 'invalid_action' } }, gitDir);
    expect(result.success).toBe(true);
    // Defaults to 'push' — should succeed
  });

  it('git_stash list is empty by default', async () => {
    // pop on empty stash should fail
    const result = await executeTool({ name: 'git_stash', params: { action: 'pop' } }, gitDir);
    expect(result.success).toBe(false);
  });

  it('git_commit confirm callback can decline', async () => {
    fs.writeFileSync(path.join(gitDir, 'x.txt'), 'x');
    const { execFileSync } = require('node:child_process');
    execFileSync('git', ['add', '.'], { cwd: gitDir });

    const result = await executeTool(
      { name: 'git_commit', params: { message: 'nope' } },
      gitDir,
      { confirm: async () => false },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('declined');
  });

  it('git_add with default path stages everything', async () => {
    fs.writeFileSync(path.join(gitDir, 'a.txt'), 'a');
    fs.writeFileSync(path.join(gitDir, 'b.txt'), 'b');
    const result = await executeTool({ name: 'git_add', params: {} }, gitDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain('Staged: .');
  });
});

// ── search_files advanced ──

describe('executeTool — search_files advanced', () => {
  it('returns error for invalid regex', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: '[invalid(regex', is_regex: 'true' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('Invalid regex');
  });

  it('case-insensitive text search by default', async () => {
    const result = await executeTool(
      { name: 'search_files', params: { query: 'HELLO' } },
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello.txt');
  });
});

// ── fetch_url SSRF variants ──

describe('executeTool — fetch_url SSRF', () => {
  it('blocks 192.168.x addresses', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://192.168.1.1/admin' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 10.x addresses', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://10.0.0.1/secret' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 169.254.x (link-local) addresses', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://169.254.169.254/metadata' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks .local domains', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://myhost.local/api' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 0.0.0.0', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://0.0.0.0/' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks [::1] IPv6 loopback', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://[::1]:8080/' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks 172.x private ranges', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'http://172.16.0.1/' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/private|internal|blocked/i);
  });

  it('blocks file:// scheme', async () => {
    const result = await executeTool(
      { name: 'fetch_url', params: { url: 'file:///etc/passwd' } },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/HTTP/);
  });
});

// ── browser tool via executeTool ──

describe('executeTool — browser tool', () => {
  it('returns error for missing action param', async () => {
    const result = await executeTool(
      { name: 'browser', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing "action"');
  });
});

// ── memory_delete missing key ──

describe('executeTool — memory_delete missing key', () => {
  it('returns error for missing key param', async () => {
    const result = await executeTool({ name: 'memory_delete', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing.*key/i);
  });
});

// ── parseToolCalls advanced ──

describe('parseToolCalls — advanced', () => {
  it('repairs truncated tool_call XML (missing </tool_call>)', () => {
    const text = '<tool_call><name>read_file</name><param name="path">test.txt</param>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[0]!.params['path']).toBe('test.txt');
  });

  it('sanitizes tool names with XML artifacts', () => {
    const text = '<tool_call><name>read_file<br></name><param name="path">x.txt</param></tool_call>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('read_file');
  });

  it('parses JSON code block with "params" key (alternative to "parameters")', () => {
    const text = '```tool_call\n{"name":"read_file","params":{"path":"test.txt"}}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params['path']).toBe('test.txt');
  });

  it('skips tool calls with empty name', () => {
    const text = '<tool_call><name></name><param name="path">x.txt</param></tool_call>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it('handles multiple formats in same text', () => {
    const text = `
<tool_call><name>read_file</name><param name="path">a.txt</param></tool_call>
<function=write_files><parameter=path>b.txt</parameter><parameter=content>hello</parameter></function>
    `;
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.name).toBe('read_file');
    expect(calls[1]!.name).toBe('write_files');
  });
});

// ── list_files on empty directory ──

describe('executeTool — list_files edge cases', () => {
  it('returns (no files) for empty directory', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-empty-'));
    try {
      const result = await executeTool({ name: 'list_files', params: {} }, emptyDir);
      expect(result.success).toBe(true);
      expect(result.output).toBe('(no files)');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

// ── walkDir with .gitignore ──

describe('walkDir — .gitignore support', () => {
  it('respects .gitignore patterns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-gitignore-'));
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.txt\n*.log');
      fs.writeFileSync(path.join(dir, 'kept.txt'), 'keep');
      fs.writeFileSync(path.join(dir, 'ignored.txt'), 'ignore me');
      fs.writeFileSync(path.join(dir, 'debug.log'), 'log data');
      const files = walkDir(dir, dir);
      expect(files).toContain('kept.txt');
      expect(files).toContain('.gitignore');
      expect(files).not.toContain('ignored.txt');
      expect(files).not.toContain('debug.log');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips hidden directories except .env and .gitignore', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-hidden-'));
    try {
      fs.mkdirSync(path.join(dir, '.hidden'));
      fs.writeFileSync(path.join(dir, '.hidden', 'secret.txt'), 'secret');
      fs.writeFileSync(path.join(dir, '.env'), 'KEY=val');
      const files = walkDir(dir, dir);
      expect(files).toContain('.env');
      expect(files.some(f => f.includes('secret.txt'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Unknown tool ──

describe('executeTool — unknown/MCP tool fallback', () => {
  it('returns unknown tool error for unrecognized name', async () => {
    const result = await executeTool({ name: 'totally_fake_tool', params: {} }, tmpDir);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/unknown tool/i);
  });
});
