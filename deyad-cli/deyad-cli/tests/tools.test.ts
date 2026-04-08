/**
 * Tests for executeTool — path traversal guards, git command safety, and basic tool dispatch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeTool, parseToolCalls, isDone, stripToolMarkup, simpleDiff, walkDir, globFiles, resetRateLimit } from '../src/tools.js';

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
