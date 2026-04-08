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

const fakeWindow = {
  deyad: {
    chatStream: vi.fn(async () => {}),
    readFiles: vi.fn(async () => ({})),
    dbDescribe: vi.fn(async () => ({ tables: [] })),
    onStreamToken: vi.fn((_requestId: string, cb: (t: string) => void) => { streamTokenCb = cb; return () => { streamTokenCb = null; }; }),
    onStreamDone: vi.fn((_requestId: string, cb: () => void) => { streamDoneCb = cb; return () => { streamDoneCb = null; }; }),
    onStreamError: vi.fn((_requestId: string, cb: (e: string) => void) => { streamErrorCb = cb; return () => { streamErrorCb = null; }; }),
    onStreamToolCalls: vi.fn((_requestId: string, cb: (tc: unknown[]) => void) => { _streamToolCallsCb = cb; return () => { _streamToolCallsCb = null; }; }),
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
});
