/**
 * Tests for Ollama client utilities — estimateTokens, CHARS_PER_TOKEN.
 * Does NOT require a running Ollama instance.
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens, CHARS_PER_TOKEN } from '../ollama.js';

describe('estimateTokens', () => {
  it('returns 0 for 0 chars', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('estimates tokens at ~4 chars per token', () => {
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(1000)).toBe(250);
  });

  it('rounds to nearest integer', () => {
    expect(estimateTokens(5)).toBe(1); // 5/4 = 1.25 → 1
    expect(estimateTokens(6)).toBe(2); // 6/4 = 1.5 → 2
  });
});

describe('CHARS_PER_TOKEN', () => {
  it('is 4.0', () => {
    expect(CHARS_PER_TOKEN).toBe(4.0);
  });
});
