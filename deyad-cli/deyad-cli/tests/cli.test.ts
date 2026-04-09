import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/agent.js', () => ({
  runAgentLoop: vi.fn(async (_model: string, _userMessage: string, _cwd: string, callbacks: any) => {
    callbacks.onToolResult?.({ tool: 'read_file', success: true, output: 'hello' });
    callbacks.onDone?.('');
  }),
}));

const { runOnce } = await import('../src/cli.js');

describe('CLI print mode', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints tool results in silent print mode', async () => {
    await runOnce('qwen3.5:27b', 'read README.md', '/tmp', true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });
});
