import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Build a mock net.request that can simulate responses
const mockResponseHandlers = new Map<string, (...args: unknown[]) => void>();
const mockResponse = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    mockResponseHandlers.set(event, cb);
  }),
};
const mockRequest = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'response') {
      // Simulate calling response callback
      setTimeout(() => cb(mockResponse), 0);
    }
  }),
  setHeader: vi.fn(),
  write: vi.fn(),
  end: vi.fn(),
};

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  net: {
    request: vi.fn(() => mockRequest),
  },
}));

const handlers = new Map<string, (...args: unknown[]) => unknown>();

import { ipcMain } from 'electron';

beforeEach(() => {
  handlers.clear();
  mockResponseHandlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
    return undefined as ReturnType<typeof ipcMain.handle>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ipcOllama handler registration', () => {
  it('registers all 4 ollama handlers', async () => {
    const { registerOllamaHandlers } = await import('./ipcOllama');
    registerOllamaHandlers(() => 'http://localhost:11434');

    expect(handlers.has('ollama:list-models')).toBe(true);
    expect(handlers.has('ollama:chat-stream')).toBe(true);
    expect(handlers.has('ollama:fim-complete')).toBe(true);
    expect(handlers.has('ollama:embed')).toBe(true);
  });

  it('ollama:list-models calls net.request with /api/tags', async () => {
    const { net } = await import('electron');
    const { registerOllamaHandlers } = await import('./ipcOllama');
    registerOllamaHandlers(() => 'http://localhost:11434');

    const handler = handlers.get('ollama:list-models')!;

    // Start the handler; it will create a request
    const promise = handler({});

    // Wait for the mock response to be set up
    await new Promise((r) => setTimeout(r, 10));

    // Simulate response data
    const dataHandler = mockResponseHandlers.get('data');
    const endHandler = mockResponseHandlers.get('end');
    if (dataHandler) dataHandler(JSON.stringify({ models: [{ name: 'llama3' }] }));
    if (endHandler) endHandler();

    const result = await promise;
    expect(result).toEqual({ models: [{ name: 'llama3' }] });
    expect(vi.mocked(net.request)).toHaveBeenCalledWith('http://localhost:11434/api/tags');
  });

  it('ollama:chat-stream sends tokens to sender', async () => {
    const { registerOllamaHandlers } = await import('./ipcOllama');
    registerOllamaHandlers(() => 'http://localhost:11434');

    const handler = handlers.get('ollama:chat-stream')!;
    const event = {
      sender: {
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
      },
    };

    const promise = handler(event, { model: 'llama3', messages: [{ role: 'user', content: 'hi' }], requestId: 'test-req-1' });

    await new Promise((r) => setTimeout(r, 10));

    const dataHandler = mockResponseHandlers.get('data');
    const endHandler = mockResponseHandlers.get('end');
    if (dataHandler) {
      dataHandler(Buffer.from(JSON.stringify({ message: { content: 'Hello' } }) + '\n'));
      dataHandler(Buffer.from(JSON.stringify({ done: true }) + '\n'));
    }
    if (endHandler) endHandler();

    await promise;
    expect(event.sender.send).toHaveBeenCalledWith('ollama:stream-token', 'test-req-1', 'Hello');
  });
});
