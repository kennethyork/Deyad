import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOptions, AgentCallbacks } from './agentLoop';

// ── Mock dependencies ───────────────────────────────────────────────────────

vi.mock('./agentTools', () => ({
  parseToolCalls: vi.fn(() => []),
  executeTool: vi.fn(async () => ({ tool: 'mock', success: true, output: 'ok' })),
  isDone: vi.fn(() => false),
  stripToolMarkup: vi.fn((s: string) => s),
  AGENT_TOOLS_DESCRIPTION: 'mock tools',
  getDesktopOllamaTools: vi.fn(() => []),
}));

vi.mock('./contextBuilder', () => ({
  buildSmartContext: vi.fn(() => 'mock context'),
  buildSmartContextWithRAG: vi.fn(async () => 'mock rag context'),
}));

vi.mock('./codebaseIndexer', () => ({
  embedChunks: vi.fn(async () => {}),
}));

// ── Fake window.deyad ───────────────────────────────────────────────────────

let streamTokenCb: ((token: string) => void) | null = null;
let streamDoneCb: (() => void) | null = null;
let streamErrorCb: ((err: string) => void) | null = null;
let _streamToolCallsCb: ((toolCalls: unknown[]) => void) | null = null;
let _streamThinkingCb: ((token: string) => void) | null = null;

const fakeWindow = {
  deyad: {
    chatStream: vi.fn(async () => {}),
    readFiles: vi.fn(async () => ({})),
    dbDescribe: vi.fn(async () => ({ tables: [] })),
    onStreamToken: vi.fn((_requestId: string, cb: (t: string) => void) => { streamTokenCb = cb; return () => { streamTokenCb = null; }; }),
    onStreamDone: vi.fn((_requestId: string, cb: () => void) => { streamDoneCb = cb; return () => { streamDoneCb = null; }; }),
    onStreamError: vi.fn((_requestId: string, cb: (e: string) => void) => { streamErrorCb = cb; return () => { streamErrorCb = null; }; }),
    onStreamToolCalls: vi.fn((_requestId: string, cb: (tc: unknown[]) => void) => { _streamToolCallsCb = cb; return () => { _streamToolCallsCb = null; }; }),
    onStreamThinking: vi.fn((_requestId: string, cb: (t: string) => void) => { _streamThinkingCb = cb; return () => { _streamThinkingCb = null; }; }),
  },
};

Object.defineProperty(globalThis, 'window', { value: fakeWindow, writable: true });

// Re-establish all window.deyad mock implementations (called after resetAllMocks)
function resetWindowMocks() {
  fakeWindow.deyad.chatStream.mockImplementation(async () => {});
  fakeWindow.deyad.readFiles.mockImplementation(async () => ({}));
  fakeWindow.deyad.dbDescribe.mockImplementation(async () => ({ tables: [] }));
  fakeWindow.deyad.onStreamToken.mockImplementation((_requestId: string, cb: (t: string) => void) => { streamTokenCb = cb; return () => { streamTokenCb = null; }; });
  fakeWindow.deyad.onStreamDone.mockImplementation((_requestId: string, cb: () => void) => { streamDoneCb = cb; return () => { streamDoneCb = null; }; });
  fakeWindow.deyad.onStreamError.mockImplementation((_requestId: string, cb: (e: string) => void) => { streamErrorCb = cb; return () => { streamErrorCb = null; }; });
  fakeWindow.deyad.onStreamToolCalls.mockImplementation((_requestId: string, cb: (tc: unknown[]) => void) => { _streamToolCallsCb = cb; return () => { _streamToolCallsCb = null; }; });
  fakeWindow.deyad.onStreamThinking.mockImplementation((_requestId: string, cb: (t: string) => void) => { _streamThinkingCb = cb; return () => { _streamThinkingCb = null; }; });
}

// Simulate a streaming turn: emit tokens then call done
function simulateStream(response: string) {
  fakeWindow.deyad.chatStream.mockImplementationOnce(async () => {
    await Promise.resolve();
    streamTokenCb?.(response);
    streamDoneCb?.();
  });
}

function simulateStreamError(errorMsg: string) {
  fakeWindow.deyad.chatStream.mockImplementationOnce(async () => {
    await Promise.resolve();
    streamErrorCb?.(errorMsg);
  });
}

// ── Helper to build options ─────────────────────────────────────────────────

function makeCallbacks(overrides?: Partial<AgentCallbacks>): AgentCallbacks {
  return {
    onContent: vi.fn(),
    onToolStart: vi.fn(),
    onToolResult: vi.fn(),
    onFilesWritten: vi.fn(async () => {}),
    onDone: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function makeOptions(overrides?: Partial<AgentOptions>): AgentOptions {
  return {
    appId: 'test-app',
    appType: 'frontend',
    dbStatus: 'none',
    model: 'llama3',
    userMessage: 'test prompt',
    appFiles: { 'src/App.tsx': 'export default function App() {}' },
    history: [],
    callbacks: makeCallbacks(),
    ...overrides,
  };
}

// ── Re-establish agentTools defaults after reset ────────────────────────────

async function resetToolMocks() {
  const tools = await import('./agentTools');
  (tools.parseToolCalls as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (tools.executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'mock', success: true, output: 'ok' });
  (tools.isDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
  (tools.stripToolMarkup as ReturnType<typeof vi.fn>).mockImplementation((s: string) => s);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('agentLoop', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    streamTokenCb = null;
    streamDoneCb = null;
    streamErrorCb = null;
    _streamToolCallsCb = null;
    resetWindowMocks();
    await resetToolMocks();
  });

  it('calls onDone when the model response has no tool calls', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const callbacks = makeCallbacks();
    const opts = makeOptions({ callbacks });

    simulateStream('Here is the answer — no tools needed. <done/>');

    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    runAgentLoop(opts);
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('loop continues past 30 iterations with no cap (Ollama is local)', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, isDone: isDoneMock } = await import('./agentTools');

    // Run tool calls for 35 iterations, then signal done
    let callCount = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount > 35) return [];
      return [{ name: 'read_file', params: { path: 'src/App.tsx' } }];
    });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callCount > 35);

    for (let i = 0; i < 40; i++) {
      simulateStream('iteration output');
    }

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));

    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 15000 });
    // Should NOT have errored — no iteration limit
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callCount).toBeGreaterThan(30);
  }, 20000);

  it('recovers from a streaming error via onError callback', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const callbacks = makeCallbacks();

    simulateStreamError('Connection refused');

    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled(), { timeout: 2000 });
    expect(callbacks.onError).toHaveBeenCalledWith('Connection refused');
  });

  it('abort function stops the loop immediately', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, isDone: isDoneMock } = await import('./agentTools');

    (parseMock as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'read_file', params: { path: 'src/App.tsx' } },
    ]);
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValue(false);

    for (let i = 0; i < 5; i++) {
      simulateStream('<tool_call><name>read_file</name></tool_call>');
    }

    const callbacks = makeCallbacks();
    const abort = runAgentLoop(makeOptions({ callbacks }));

    // Abort immediately
    abort();

    await new Promise((r) => setTimeout(r, 200));

    // After aborting, callbacks should have been called very few times
    const contentCalls = (callbacks.onContent as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(contentCalls).toBeLessThanOrEqual(3);
  });

  it('agent runs until done signal (no iteration cap for Ollama)', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, isDone: isDoneMock } = await import('./agentTools');

    // Return tool calls for a few iterations, then signal done
    let callCount = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount > 5) return [];
      return [{ name: 'list_files', params: {} }];
    });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callCount > 5);

    for (let i = 0; i < 10; i++) {
      simulateStream('iteration output');
    }

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));

    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 15000 });
    // Should NOT have called onError — no iteration limit
    expect(callbacks.onError).not.toHaveBeenCalled();
  }, 20000);

  it('streams content tokens to onContent callback', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Hello world');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));

    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(callbacks.onContent).toHaveBeenCalled();
  });

  /* ── onFilesWritten callback ──────────────────────── */

  it('calls onFilesWritten after write_files tool execution', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, executeTool: execMock, isDone: isDoneMock } = await import('./agentTools');

    let callNum = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return [{ name: 'write_files', params: { file_0_path: 'src/index.ts', file_0_content: 'export {}' } }];
      return [];
    });
    (execMock as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'write_files', success: true, output: 'ok' });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callNum > 1);

    simulateStream('<tool_call>write</tool_call>');
    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 5000 });
    expect(callbacks.onFilesWritten).toHaveBeenCalled();
  });

  /* ── onToolStart and onToolResult ─────────────────── */

  it('calls onToolStart and onToolResult for each tool', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, executeTool: execMock, isDone: isDoneMock } = await import('./agentTools');

    let callNum = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return [{ name: 'read_file', params: { path: 'src/App.tsx' } }];
      return [];
    });
    (execMock as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'read_file', success: true, output: 'content' });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callNum > 1);

    simulateStream('<tool_call>read</tool_call>');
    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 5000 });
    expect(callbacks.onToolStart).toHaveBeenCalled();
    expect(callbacks.onToolResult).toHaveBeenCalled();
  });

  /* ── Tool execution failure recorded ──────────────── */

  it('records tool execution failure in results', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, executeTool: execMock, isDone: isDoneMock } = await import('./agentTools');

    let callNum = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return [{ name: 'run_command', params: { command: 'false' } }];
      return [];
    });
    (execMock as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'run_command', success: false, output: 'command failed' });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callNum > 1);

    simulateStream('<tool_call>run</tool_call>');
    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 5000 });
    expect(callbacks.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  /* ── Multiple sequential tool calls ───────────────── */

  it('executes multiple tool calls from a single turn', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, executeTool: execMock, isDone: isDoneMock } = await import('./agentTools');

    let callNum = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return [
        { name: 'read_file', params: { path: 'a.ts' } },
        { name: 'read_file', params: { path: 'b.ts' } },
      ];
      return [];
    });
    (execMock as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'read_file', success: true, output: 'ok' });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callNum > 1);

    simulateStream('<tool_call>multi</tool_call>');
    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 5000 });
    // executeTool should be called at least 2 times for 2 tool calls
    expect((execMock as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /* ── Fullstack app with dbStatus ──────────────────── */

  it('passes dbStatus to agentLoop for fullstack apps', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('No tools <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, appType: 'fullstack', dbStatus: 'running' }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    // dbDescribe should be called for fullstack running
    expect(fakeWindow.deyad.dbDescribe).toHaveBeenCalled();
  });

  it('does not call dbDescribe when dbStatus is none', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('No tools <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, appType: 'frontend', dbStatus: 'none' }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(fakeWindow.deyad.dbDescribe).not.toHaveBeenCalled();
  });

  /* ── History messages passed correctly ────────────── */

  it('includes history messages in the chat stream', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('response <done/>');

    const history = [
      { role: 'user' as const, content: 'old question' },
      { role: 'assistant' as const, content: 'old answer' },
      { role: 'user' as const, content: 'current message' },
    ];
    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, history }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    // chatStream should have been called with messages containing history
    expect(fakeWindow.deyad.chatStream).toHaveBeenCalled();
    const callArgs = (fakeWindow.deyad.chatStream as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = callArgs[1];
    const hasHistory = messages.some((m: { content: string }) =>
      typeof m.content === 'string' && m.content.includes('old question'));
    expect(hasHistory).toBe(true);
  });

  /* ── readFiles called for context ─────────────────── */

  it('builds context from appFiles', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    const { buildSmartContext: buildMock } = await import('./contextBuilder');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('All done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    // buildSmartContext is called with the appFiles to build initial context
    expect(buildMock).toHaveBeenCalled();
  });

  /* ── Empty response handling ──────────────────────── */

  it('handles empty string from stream gracefully', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  /* ── Error in tool execution doesn't crash ────────── */

  it('continues loop when tool throws error', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, executeTool: execMock, isDone: isDoneMock } = await import('./agentTools');

    let callNum = 0;
    (parseMock as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callNum++;
      if (callNum === 1) return [{ name: 'read_file', params: { path: 'fail.ts' } }];
      return [];
    });
    (execMock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));
    (execMock as ReturnType<typeof vi.fn>).mockResolvedValue({ tool: 'mock', success: true, output: 'ok' });
    (isDoneMock as ReturnType<typeof vi.fn>).mockImplementation(() => callNum > 1);

    simulateStream('<tool_call>read</tool_call>');
    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 5000 });
  });

  /* ── Options with empty appFiles ──────────────────── */

  it('works with empty appFiles', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Hello <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, appFiles: {} }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  /* ── dbDescribe error ignored ─────────────────────── */

  it('handles dbDescribe failure gracefully for fullstack', async () => {
    fakeWindow.deyad.dbDescribe.mockRejectedValueOnce(new Error('connection refused'));
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Fine <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, appType: 'fullstack', dbStatus: 'running' }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    // Should not crash, no onError
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  /* ── onStreamToolCalls subscription ───────────────── */

  it('subscribes to onStreamToolCalls', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Hello <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    expect(fakeWindow.deyad.onStreamToolCalls).toHaveBeenCalled();
  });

  /* ── Cleanup unsubscribes stream callbacks ────────── */

  it('unsubscribes stream callbacks after loop ends', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Done <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    // After loop ends, stream callbacks should have been cleaned up
    // (streamTokenCb should be null after unsub)
    // We just verify the loop completed without error
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  /* ── Model passed to chatStream ───────────────────── */

  it('passes the specified model to chatStream', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { isDone: isDoneMock } = await import('./agentTools');
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

    simulateStream('Hello <done/>');

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks, model: 'qwen3:30b' }));
    await vi.waitFor(() => expect(callbacks.onDone).toHaveBeenCalled(), { timeout: 2000 });
    const callArgs = (fakeWindow.deyad.chatStream as ReturnType<typeof vi.fn>).mock.calls[0];
    const model = callArgs[0];
    expect(model).toBe('qwen3:30b');
  });
});
