/**
 * Integration tests for the agent loop — mocks Ollama streaming,
 * verifies tool dispatch, context refresh, conversation compaction, and done detection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentCallbacks } from '../agent.js';

// We mock the ollama module so no actual server is needed
vi.mock('../ollama.js', () => ({
  estimateTokens: (chars: number) => Math.round(chars / 4),
  streamChat: vi.fn(),
}));

import { streamChat } from '../ollama.js';
import { runAgentLoop } from '../agent.js';

const mockedStreamChat = vi.mocked(streamChat);

let tmpDir: string;

function makeCallbacks(overrides: Partial<AgentCallbacks> = {}): AgentCallbacks {
  return {
    onToken: vi.fn(),
    onToolStart: vi.fn(),
    onToolResult: vi.fn(),
    onDiff: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-agent-test-'));
  // Create a minimal project
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'console.log("hello");');
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runAgentLoop', () => {
  it('completes immediately when model responds with done', async () => {
    mockedStreamChat.mockResolvedValueOnce({
      content: 'All done! <done/>',
      usage: { promptTokens: 100, completionTokens: 20 },
    });

    const cb = makeCallbacks();
    const result = await runAgentLoop('test-model', 'say hi', tmpDir, cb);

    expect(result.history.length).toBeGreaterThan(0);
    expect(cb.onDone).toHaveBeenCalledOnce();
    expect(result.stats.totalTokens).toBeGreaterThan(0);
  });

  it('executes a read_file tool call and feeds result back', async () => {
    // Turn 1: model requests reading a file
    mockedStreamChat.mockResolvedValueOnce({
      content: `Let me read the file.
<tool_call>
<name>read_file</name>
<param name="path">index.ts</param>
</tool_call>`,
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    // Turn 2: model sees result and finishes
    mockedStreamChat.mockResolvedValueOnce({
      content: 'The file contains a hello world log. <done/>',
      usage: { promptTokens: 200, completionTokens: 30 },
    });

    const cb = makeCallbacks();
    const result = await runAgentLoop('test-model', 'read index.ts', tmpDir, cb);

    expect(cb.onToolStart).toHaveBeenCalledWith('read_file', expect.any(Object));
    expect(cb.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'read_file', success: true }),
    );
    expect(cb.onDone).toHaveBeenCalledOnce();
    expect(result.stats.promptTokens).toBe(300);
    expect(result.stats.completionTokens).toBe(80);
  });

  it('executes write_files and tracks changed files', async () => {
    // Turn 1: model writes a file
    mockedStreamChat.mockResolvedValueOnce({
      content: `Creating a new file.
<tool_call>
<name>write_files</name>
<param name="path">hello.txt</param>
<param name="content">Hello World!</param>
</tool_call>`,
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    // Turn 2: done
    mockedStreamChat.mockResolvedValueOnce({
      content: 'Created hello.txt. <done/>',
      usage: { promptTokens: 200, completionTokens: 20 },
    });

    const cb = makeCallbacks();
    const result = await runAgentLoop('test-model', 'create hello.txt', tmpDir, cb);

    expect(result.changedFiles).toContain('hello.txt');
    expect(fs.existsSync(path.join(tmpDir, 'hello.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'hello.txt'), 'utf-8')).toBe('Hello World!');
  });

  it('runs multiple read-only tools in parallel', async () => {
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'file A');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'file B');

    // Turn 1: model requests two read-only tools
    mockedStreamChat.mockResolvedValueOnce({
      content: `Reading both files.
<tool_call>
<name>read_file</name>
<param name="path">a.ts</param>
</tool_call>
<tool_call>
<name>read_file</name>
<param name="path">b.ts</param>
</tool_call>`,
      usage: { promptTokens: 100, completionTokens: 60 },
    });

    // Turn 2: done
    mockedStreamChat.mockResolvedValueOnce({
      content: 'Both files read. <done/>',
      usage: { promptTokens: 200, completionTokens: 20 },
    });

    const cb = makeCallbacks();
    await runAgentLoop('test-model', 'read both', tmpDir, cb);

    // Both tool results should be reported
    expect(cb.onToolResult).toHaveBeenCalledTimes(2);
  });

  it('handles tool errors gracefully and continues', async () => {
    // Turn 1: try to read non-existent file
    mockedStreamChat.mockResolvedValueOnce({
      content: `<tool_call>
<name>read_file</name>
<param name="path">does_not_exist.ts</param>
</tool_call>`,
      usage: { promptTokens: 100, completionTokens: 30 },
    });

    // Turn 2: model acknowledges error and finishes
    mockedStreamChat.mockResolvedValueOnce({
      content: 'File not found, nothing to do. <done/>',
      usage: { promptTokens: 200, completionTokens: 20 },
    });

    const cb = makeCallbacks();
    const result = await runAgentLoop('test-model', 'read it', tmpDir, cb);

    expect(cb.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(cb.onDone).toHaveBeenCalledOnce();
    expect(result.changedFiles).toEqual([]);
  });

  it('accumulates token stats across turns', async () => {
    mockedStreamChat.mockResolvedValueOnce({
      content: '<tool_call><name>list_files</name></tool_call>',
      usage: { promptTokens: 50, completionTokens: 10 },
    });
    mockedStreamChat.mockResolvedValueOnce({
      content: '<tool_call><name>list_files</name></tool_call>',
      usage: { promptTokens: 60, completionTokens: 15 },
    });
    mockedStreamChat.mockResolvedValueOnce({
      content: 'Done listing. <done/>',
      usage: { promptTokens: 70, completionTokens: 5 },
    });

    const cb = makeCallbacks();
    const result = await runAgentLoop('test-model', 'list', tmpDir, cb);

    expect(result.stats.promptTokens).toBe(180);
    expect(result.stats.completionTokens).toBe(30);
    expect(result.stats.totalTokens).toBe(210);
  });

  it('feeds tool results in correct XML format', async () => {
    mockedStreamChat
      .mockResolvedValueOnce({
        content: '<tool_call><name>list_files</name></tool_call>',
        usage: { promptTokens: 50, completionTokens: 10 },
      })
      .mockResolvedValueOnce({
        content: 'Got it. <done/>',
        usage: { promptTokens: 100, completionTokens: 10 },
      });

    const cb = makeCallbacks();
    await runAgentLoop('test-model', 'list files', tmpDir, cb);

    // Check that the second call to streamChat includes the tool result in correct format
    const secondCall = mockedStreamChat.mock.calls[1];
    const messages = secondCall[1] as Array<{ role: string; content: string }>; // messages array
    const userMessages = messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBeGreaterThan(0);
    const lastUserContent = userMessages[userMessages.length - 1]!.content;
    expect(lastUserContent).toContain('<tool_result>');
    expect(lastUserContent).toContain('<status>success</status>');
    expect(lastUserContent).toContain('<name>list_files</name>');
  });
});
