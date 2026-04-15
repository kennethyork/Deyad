/**
 * Tests for session module — recoverSession, interface shapes.
 * Session CRUD is comprehensively covered in session-memory.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { recoverSession } from '../src/session.js';
import type { SessionData, MemoryEntry } from '../src/session.js';

describe('recoverSession', () => {
  it('returns null for nonexistent file', () => {
    expect(recoverSession('/tmp/nonexistent-deyad-session.json')).toBeNull();
  });

  it('returns null for invalid path', () => {
    expect(recoverSession('')).toBeNull();
  });
});

describe('SessionData interface', () => {
  it('has expected fields', () => {
    const session: SessionData = {
      id: 'abc',
      model: 'llama3',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      totalTokens: 0,
      taskCount: 0,
    };
    expect(session.id).toBe('abc');
    expect(session.history).toEqual([]);
  });
});

describe('MemoryEntry interface', () => {
  it('has expected fields', () => {
    const entry: MemoryEntry = {
      key: 'test',
      value: 'val',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(entry.key).toBe('test');
  });
});
