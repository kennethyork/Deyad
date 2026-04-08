/**
 * Tests for session memory — encryption roundtrip, CRUD, key sanitization.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { memoryWrite, memoryRead, memoryList, memoryDelete, loadOrCreateSession, saveSession, listSessions, deleteSession, pruneSessions } from '../src/session.js';

// Use a unique prefix so tests don't collide with real memory
const PREFIX = `__test_${Date.now()}_`;

afterEach(() => {
  // Clean up test keys
  for (const entry of memoryList()) {
    if (entry.key.startsWith(PREFIX)) {
      memoryDelete(entry.key);
    }
  }
});

describe('session memory — encryption roundtrip', () => {
  it('writes and reads back the same value', () => {
    const key = `${PREFIX}hello`;
    memoryWrite(key, 'secret value 123');
    const value = memoryRead(key);
    expect(value).toBe('secret value 123');
  });

  it('handles unicode and special characters', () => {
    const key = `${PREFIX}unicode`;
    const text = 'こんにちは 🌍 "quotes" <tags> & newlines\nline2';
    memoryWrite(key, text);
    expect(memoryRead(key)).toBe(text);
  });

  it('handles empty string value', () => {
    const key = `${PREFIX}empty`;
    memoryWrite(key, '');
    expect(memoryRead(key)).toBe('');
  });

  it('overwrites existing value', () => {
    const key = `${PREFIX}overwrite`;
    memoryWrite(key, 'first');
    memoryWrite(key, 'second');
    expect(memoryRead(key)).toBe('second');
  });

  it('preserves createdAt on update', async () => {
    const key = `${PREFIX}timestamps`;
    memoryWrite(key, 'v1');
    // Re-read the raw file to check createdAt
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const filePath = path.join(os.homedir(), '.deyad', 'memory', `${key}.json`);
    const entry1 = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const createdAt1 = entry1.createdAt;

    // Small delay so updatedAt differs
    await new Promise((r) => setTimeout(r, 20));

    memoryWrite(key, 'v2');
    const entry2 = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(entry2.createdAt).toBe(createdAt1);
  });
});

describe('session memory — CRUD operations', () => {
  it('returns null for missing key', () => {
    expect(memoryRead(`${PREFIX}nonexistent_key_xyz`)).toBeNull();
  });

  it('deletes a key', () => {
    const key = `${PREFIX}deleteme`;
    memoryWrite(key, 'temp');
    expect(memoryDelete(key)).toBe(true);
    expect(memoryRead(key)).toBeNull();
  });

  it('delete returns false for missing key', () => {
    expect(memoryDelete(`${PREFIX}nokey`)).toBe(false);
  });

  it('lists entries including written ones', () => {
    const key = `${PREFIX}listed`;
    memoryWrite(key, 'find me');
    const entries = memoryList();
    const found = entries.find((e) => e.key === key);
    expect(found).toBeDefined();
  });
});

describe('session memory — key sanitization', () => {
  it('sanitizes special characters in keys', () => {
    const key = `${PREFIX}../../bad/key`;
    memoryWrite(key, 'safe');
    expect(memoryRead(key)).toBe('safe');
    memoryDelete(key);
  });
});

// ── Session persistence tests ─────────────────────────────────────────────

describe('session persistence — loadOrCreateSession', () => {
  const testCwd = `/tmp/deyad-session-test-${Date.now()}`;

  afterEach(() => {
    // Clean up sessions created during test
    for (const s of listSessions()) {
      if (s.cwd === testCwd) deleteSession(s.id);
    }
  });

  it('creates a new session when none exists', () => {
    const session = loadOrCreateSession(testCwd, 'llama3');
    expect(session).toBeDefined();
    expect(session.model).toBe('llama3');
    expect(session.cwd).toBe(testCwd);
    expect(session.history).toEqual([]);
    expect(session.totalTokens).toBe(0);
  });

  it('returns existing session on second call', () => {
    const s1 = loadOrCreateSession(testCwd, 'llama3');
    const s2 = loadOrCreateSession(testCwd, 'llama3');
    expect(s2.id).toBe(s1.id);
  });
});

describe('session persistence — saveSession + listSessions', () => {
  const testCwd = `/tmp/deyad-session-save-test-${Date.now()}`;
  let sessionId: string;

  afterEach(() => {
    if (sessionId) deleteSession(sessionId);
  });

  it('saves and lists sessions', () => {
    const session = loadOrCreateSession(testCwd, 'codellama');
    sessionId = session.id;
    session.totalTokens = 42;
    saveSession(session);

    const all = listSessions();
    const found = all.find((s) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found!.totalTokens).toBe(42);
  });
});

describe('session persistence — deleteSession', () => {
  it('deletes an existing session', () => {
    const testCwd = `/tmp/deyad-session-del-test-${Date.now()}`;
    const session = loadOrCreateSession(testCwd, 'llama3');
    expect(deleteSession(session.id)).toBe(true);
    expect(deleteSession(session.id)).toBe(false); // already deleted
  });
});

describe('session persistence — pruneSessions', () => {
  it('returns number of pruned sessions (0 when under limit)', () => {
    const count = pruneSessions();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
