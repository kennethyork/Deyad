import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentOptions, AgentCallbacks } from './agentLoop';

// ── Mock dependencies ───────────────────────────────────────────────────────

vi.mock('./agentTools', () => ({
  parseToolCalls: vi.fn(() => []),
  executeTool: vi.fn(async () => ({ tool: 'mock', success: true, output: 'ok' })),
  isDone: vi.fn(() => false),
  stripToolMarkup: vi.fn((s: string) => s),
  AGENT_TOOLS_DESCRIPTION: 'mock tools',
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

const fakeWindow = {
  deyad: {
    chatStream: vi.fn(async () => {}),
    readFiles: vi.fn(async () => ({})),
    dbDescribe: vi.fn(async () => ({ tables: [] })),
    onStreamToken: vi.fn((cb: (t: string) => void) => { streamTokenCb = cb; return () => { streamTokenCb = null; }; }),
    onStreamDone: vi.fn((cb: () => void) => { streamDoneCb = cb; return () => { streamDoneCb = null; }; }),
    onStreamError: vi.fn((cb: (e: string) => void) => { streamErrorCb = cb; return () => { streamErrorCb = null; }; }),
  },
};

Object.defineProperty(globalThis, 'window', { value: fakeWindow, writable: true });

// Re-establish all window.deyad mock implementations (called after resetAllMocks)
function resetWindowMocks() {
  fakeWindow.deyad.chatStream.mockImplementation(async () => {});
  fakeWindow.deyad.readFiles.mockImplementation(async () => ({}));
  fakeWindow.deyad.dbDescribe.mockImplementation(async () => ({ tables: [] }));
  fakeWindow.deyad.onStreamToken.mockImplementation((cb: (t: string) => void) => { streamTokenCb = cb; return () => { streamTokenCb = null; }; });
  fakeWindow.deyad.onStreamDone.mockImplementation((cb: () => void) => { streamDoneCb = cb; return () => { streamDoneCb = null; }; });
  fakeWindow.deyad.onStreamError.mockImplementation((cb: (e: string) => void) => { streamErrorCb = cb; return () => { streamErrorCb = null; }; });
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

  it('stops after MAX_ITERATIONS and fires onError', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, isDone: isDoneMock } = await import('./agentTools');

    // Make every turn return a tool call so the loop never self-terminates
    (parseMock as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'read_file', params: { path: 'src/App.tsx' } },
    ]);
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValue(false);

    // Set up 31 stream simulations (MAX_ITERATIONS = 30 + 1 safety)
    for (let i = 0; i < 31; i++) {
      simulateStream('<tool_call><name>read_file</name></tool_call>');
    }

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));

    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled(), { timeout: 15000 });
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.stringContaining('maximum iteration limit'),
    );
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

  it('MAX_ITERATIONS is capped at 30', async () => {
    const { runAgentLoop } = await import('./agentLoop');
    const { parseToolCalls: parseMock, isDone: isDoneMock } = await import('./agentTools');

    (parseMock as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: 'list_files', params: {} },
    ]);
    (isDoneMock as ReturnType<typeof vi.fn>).mockReturnValue(false);

    for (let i = 0; i < 31; i++) {
      simulateStream('tool iteration');
    }

    const callbacks = makeCallbacks();
    runAgentLoop(makeOptions({ callbacks }));

    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled(), { timeout: 15000 });
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.stringContaining('30'),
    );
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
