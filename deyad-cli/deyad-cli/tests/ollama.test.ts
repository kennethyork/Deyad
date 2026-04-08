/**
 * Tests for ollama module — token estimation, calibration, stream parsing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens, DEFAULT_CHARS_PER_TOKEN } from '../src/ollama.js';

describe('estimateTokens', () => {
  it('estimates tokens using default ratio', () => {
    const chars = 350;
    const expected = Math.round(chars / DEFAULT_CHARS_PER_TOKEN);
    expect(estimateTokens(chars)).toBe(expected);
  });

  it('returns 0 for 0 characters', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('handles large character counts', () => {
    const result = estimateTokens(100_000);
    expect(result).toBeGreaterThan(10_000);
    expect(result).toBeLessThan(100_000);
  });
});

describe('streamChat', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws when Ollama is unreachable', async () => {
    const { streamChat } = await import('../src/ollama.js');
    // Point to a port that's definitely not running Ollama
    process.env['OLLAMA_HOST'] = 'http://127.0.0.1:1';
    try {
      await expect(
        streamChat('test-model', [{ role: 'user', content: 'hi' }], () => {}, {}, AbortSignal.timeout(2000)),
      ).rejects.toThrow();
    } finally {
      delete process.env['OLLAMA_HOST'];
    }
  });

  it('throws on non-200 response from health check', async () => {
    const { streamChat } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) as unknown as typeof fetch;

    await expect(
      streamChat('model', [{ role: 'user', content: 'test' }], () => {}),
    ).rejects.toThrow(/503/);
  });

  it('parses streaming response tokens', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const tokens: string[] = [];
    const lines = [
      JSON.stringify({ message: { content: 'Hello' } }),
      JSON.stringify({ message: { content: ' world' } }),
      JSON.stringify({ done: true, prompt_eval_count: 10, eval_count: 5 }),
    ].join('\n') + '\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true }) // health check
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const result = await streamChat(
      'model',
      [{ role: 'user', content: 'hi' }],
      (t) => tokens.push(t),
    );

    expect(tokens).toEqual(['Hello', ' world']);
    expect(result.content).toBe('Hello world');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
  });

  it('parses thinking tokens from reasoning models', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const thinkingTokens: string[] = [];
    const lines = [
      JSON.stringify({ message: { thinking: 'Let me think...' } }),
      JSON.stringify({ message: { content: 'Answer' } }),
      JSON.stringify({ done: true, prompt_eval_count: 5, eval_count: 3 }),
    ].join('\n') + '\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const result = await streamChat(
      'model',
      [{ role: 'user', content: 'think' }],
      () => {},
      {},
      undefined,
      (t) => thinkingTokens.push(t),
    );

    expect(thinkingTokens).toEqual(['Let me think...']);
    expect(result.thinking).toBe('Let me think...');
    expect(result.content).toBe('Answer');
  });

  it('parses native tool calls', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const lines = [
      JSON.stringify({
        message: {
          content: '',
          tool_calls: [{ function: { name: 'read_file', arguments: { path: 'test.txt' } } }],
        },
      }),
      JSON.stringify({ done: true, prompt_eval_count: 10, eval_count: 2 }),
    ].join('\n') + '\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const result = await streamChat(
      'model',
      [{ role: 'user', content: 'read file' }],
      () => {},
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe('read_file');
  });

  it('retries on 503 and succeeds eventually', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const tokens: string[] = [];
    const lines = [
      JSON.stringify({ message: { content: 'ok' } }),
      JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: 1 }),
    ].join('\n') + '\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true }) // health check
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'busy' }) // 1st attempt
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch; // retry succeeds

    const result = await streamChat(
      'model',
      [{ role: 'user', content: 'hi' }],
      (t) => tokens.push(t),
    );

    expect(tokens).toEqual(['ok']);
    expect(result.content).toBe('ok');
    // health check + 2 chat attempts = 3 fetch calls
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it('handles empty response body gracefully', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const result = await streamChat(
      'model',
      [{ role: 'user', content: 'hi' }],
      () => {},
    );

    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('uses tools parameter when provided', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ done: true, prompt_eval_count: 1, eval_count: 1 }) + '\n'));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const tools = [{
      type: 'function' as const,
      function: { name: 'test', description: 'A test tool', parameters: { type: 'object' as const, properties: {}, required: [] } },
    }];

    await streamChat('model', [{ role: 'user', content: 'hi' }], () => {}, {}, undefined, undefined, tools);

    const chatCall = vi.mocked(globalThis.fetch).mock.calls[1]!;
    const body = JSON.parse(chatCall[1]?.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('test');
  });

  it('estimates tokens when Ollama does not return counts', async () => {
    const { streamChat } = await import('../src/ollama.js');
    const encoder = new TextEncoder();
    const lines = [
      JSON.stringify({ message: { content: 'word' } }),
      JSON.stringify({ done: true }), // no prompt_eval_count
    ].join('\n') + '\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, body: stream }) as unknown as typeof fetch;

    const result = await streamChat('model', [{ role: 'user', content: 'hello' }], () => {});

    // Should estimate rather than return 0
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  });
});

describe('isRetryableStatus', () => {
  it('returns true for 429, 502, 503, 504', async () => {
    const { isRetryableStatus } = await import('../src/ollama.js');
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
  });

  it('returns false for non-retryable status codes', async () => {
    const { isRetryableStatus } = await import('../src/ollama.js');
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(500)).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('identifies retryable error messages', async () => {
    const { isRetryableError } = await import('../src/ollama.js');
    expect(isRetryableError('ETIMEDOUT')).toBe(true);
    expect(isRetryableError('ECONNRESET something')).toBe(true);
    expect(isRetryableError('socket hang up')).toBe(true);
    expect(isRetryableError('network error')).toBe(true);
    expect(isRetryableError('request timeout')).toBe(true);
    expect(isRetryableError('ECONNREFUSED')).toBe(true);
  });

  it('returns false for non-retryable errors', async () => {
    const { isRetryableError } = await import('../src/ollama.js');
    expect(isRetryableError('Invalid JSON')).toBe(false);
    expect(isRetryableError('Permission denied')).toBe(false);
  });
});

describe('listModels', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns model names excluding embedding models', async () => {
    const { listModels } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [
          { name: 'qwen3:8b' },
          { name: 'llama3.1:8b' },
          { name: 'nomic-embed-text' },
          { name: 'all-minilm:latest' },
        ],
      }),
    }) as unknown as typeof fetch;

    const models = await listModels();
    expect(models).toEqual(['qwen3:8b', 'llama3.1:8b']);
  });

  it('throws on non-200 response', async () => {
    const { listModels } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch;

    await expect(listModels()).rejects.toThrow(/500/);
  });

  it('returns empty array when no models', async () => {
    const { listModels } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    }) as unknown as typeof fetch;

    const models = await listModels();
    expect(models).toEqual([]);
  });
});

describe('checkOllama', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true when Ollama is reachable', async () => {
    const { checkOllama } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch;
    expect(await checkOllama()).toBe(true);
  });

  it('returns false when Ollama is unreachable', async () => {
    const { checkOllama } = await import('../src/ollama.js');
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    expect(await checkOllama()).toBe(false);
  });
});
