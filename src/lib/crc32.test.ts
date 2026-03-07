import { describe, it, expect } from 'vitest';
import { crc32 } from './crc32';

describe('crc32', () => {
  it('returns 0 for an empty buffer', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
  });

  it('computes the correct CRC-32 for a known string', () => {
    // CRC-32 of the ASCII string "123456789" is 0xCBF43926
    const buf = Buffer.from('123456789', 'ascii');
    expect(crc32(buf)).toBe(0xCBF43926);
  });

  it('computes a different CRC-32 for different content', () => {
    const a = crc32(Buffer.from('hello'));
    const b = crc32(Buffer.from('world'));
    expect(a).not.toBe(b);
  });

  it('returns a 32-bit unsigned integer', () => {
    const result = crc32(Buffer.from('test data'));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xFFFFFFFF);
  });
});
