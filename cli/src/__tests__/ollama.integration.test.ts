import { describe, it, expect, beforeAll } from 'vitest';
import { streamChat } from '../ollama.js';
import type { OllamaMessage } from '../ollama.js';

/**
 * Integration tests that hit a real Ollama instance.
 *
 * These are **opt-in only** — they never run during normal `npm test`.
 * To run them:   TEST_OLLAMA=1 npx vitest run src/__tests__/ollama.integration.test.ts
 */

const ENABLED = process.env.TEST_OLLAMA === '1';

let ollamaModel = '';

const TIMEOUT = 60_000;

beforeAll(async () => {
  if (!ENABLED) return;
  const baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    if (data.models && data.models.length > 0) {
      const sorted = [...data.models].sort((a, b) => a.name.length - b.name.length);
      ollamaModel = sorted[0]!.name;
    }
  }
});

describe.skipIf(!ENABLED)('Ollama integration (real server)', () => {
  it('streamChat returns a non-empty response', async () => {
    const messages: OllamaMessage[] = [
      { role: 'user', content: 'Reply with exactly one word: hello' },
    ];
    const tokens: string[] = [];
    const result = await streamChat(ollamaModel, messages, (t) => tokens.push(t), {
      temperature: 0,
      num_ctx: 512,
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(result.content).toBe(tokens.join(''));
  }, TIMEOUT);

  it('reports token usage', async () => {
    const messages: OllamaMessage[] = [
      { role: 'user', content: 'Say yes' },
    ];
    const result = await streamChat(ollamaModel, messages, () => {}, {
      temperature: 0,
      num_ctx: 512,
    });

    expect(result.usage.promptTokens).toBeGreaterThan(0);
    expect(result.usage.completionTokens).toBeGreaterThan(0);
  }, TIMEOUT);

  it('supports abort signal', async () => {
    const controller = new AbortController();
    const messages: OllamaMessage[] = [
      { role: 'user', content: 'Write a 500-word essay about trees' },
    ];

    let tokenCount = 0;
    const promise = streamChat(ollamaModel, messages, () => {
      tokenCount++;
      if (tokenCount >= 2) controller.abort();
    }, { num_ctx: 512 }, controller.signal);

    await expect(promise).rejects.toThrow();
  }, TIMEOUT);

  it('handles multi-turn conversation', async () => {
    const messages: OllamaMessage[] = [
      { role: 'user', content: 'My name is TestBot42' },
      { role: 'assistant', content: 'Hello TestBot42!' },
      { role: 'user', content: 'What is my name? Reply with just the name.' },
    ];
    const result = await streamChat(ollamaModel, messages, () => {}, {
      temperature: 0,
      num_ctx: 1024,
    });

    expect(result.content.toLowerCase()).toContain('testbot42');
  }, TIMEOUT);

  it('handles system message', async () => {
    const messages: OllamaMessage[] = [
      { role: 'system', content: 'You are a calculator. Only output numbers.' },
      { role: 'user', content: 'What is 2+2?' },
    ];
    const result = await streamChat(ollamaModel, messages, () => {}, {
      temperature: 0,
      num_ctx: 512,
    });

    expect(result.content).toContain('4');
  }, TIMEOUT);
});
