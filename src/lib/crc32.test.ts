import { describe, it, expect } from 'vitest';
import { crc32 } from './crc32';

describe('crc32', () => {
  const encode = (s: string) => new TextEncoder().encode(s);

  it('returns 0 for an empty buffer', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
  });

  it('computes the correct CRC-32 for a known string', () => {
    // CRC-32 of the ASCII string "123456789" is 0xCBF43926
    expect(crc32(encode('123456789'))).toBe(0xCBF43926);
  });

  it('computes a different CRC-32 for different content', () => {
    const a = crc32(encode('hello'));
    const b = crc32(encode('world'));
    expect(a).not.toBe(b);
  });

  it('returns a 32-bit unsigned integer', () => {
    const result = crc32(encode('test data'));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});
