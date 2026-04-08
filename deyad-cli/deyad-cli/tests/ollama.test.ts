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
});
