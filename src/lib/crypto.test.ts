import { describe, it, expect } from 'vitest';
import { generatePassword } from './crypto';

describe('generatePassword', () => {
  const URL_SAFE = /^[A-Za-z0-9\-_]+$/;

  it('returns a string of the default length (24)', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(24);
  });

  it('returns a string of a custom length', () => {
    expect(generatePassword(8)).toHaveLength(8);
    expect(generatePassword(64)).toHaveLength(64);
  });

  it('uses only URL-safe characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword(32)).toMatch(URL_SAFE);
    }
  });

  it('produces different passwords each call (not deterministic)', () => {
    const set = new Set(Array.from({ length: 50 }, () => generatePassword()));
    // With 24-char passwords from a 64-char alphabet, collisions are astronomically unlikely
    expect(set.size).toBe(50);
  });

  it('handles length of 1', () => {
    const pw = generatePassword(1);
    expect(pw).toHaveLength(1);
    expect(pw).toMatch(URL_SAFE);
  });
});
