/**
 * Tests for ollama retry logic, rate limiting, and session corruption recovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRetryableStatus, isRetryableError, MAX_RETRIES, BACKOFF_BASE_MS } from '../src/ollama.js';
import { checkRateLimit, resetRateLimit } from '../src/tools.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Retry helper tests ───────────────────────────────────────────────────────

describe('isRetryableStatus', () => {
  it('retries 429 (rate limited)', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });
  it('retries 503 (service unavailable)', () => {
    expect(isRetryableStatus(503)).toBe(true);
  });
  it('retries 502 (bad gateway)', () => {
    expect(isRetryableStatus(502)).toBe(true);
  });
  it('retries 504 (gateway timeout)', () => {
    expect(isRetryableStatus(504)).toBe(true);
  });
  it('does not retry 400', () => {
    expect(isRetryableStatus(400)).toBe(false);
  });
  it('does not retry 404', () => {
    expect(isRetryableStatus(404)).toBe(false);
  });
  it('retries 500 (XML parse errors)', () => {
    expect(isRetryableStatus(500)).toBe(true);
  });
});

describe('isRetryableError', () => {
  it('retries ETIMEDOUT', () => {
    expect(isRetryableError('connect ETIMEDOUT 127.0.0.1:11434')).toBe(true);
  });
  it('retries ECONNRESET', () => {
    expect(isRetryableError('read ECONNRESET')).toBe(true);
  });
  it('retries ECONNREFUSED', () => {
    expect(isRetryableError('connect ECONNREFUSED 127.0.0.1:11434')).toBe(true);
  });
  it('retries socket hang up', () => {
    expect(isRetryableError('socket hang up')).toBe(true);
  });
  it('retries timeout', () => {
    expect(isRetryableError('The operation was aborted due to timeout')).toBe(true);
  });
  it('does not retry invalid model', () => {
    expect(isRetryableError('model "foo" not found')).toBe(false);
  });
  it('does not retry generic errors', () => {
    expect(isRetryableError('Something went wrong')).toBe(false);
  });
});

describe('retry constants', () => {
  it('MAX_RETRIES is 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });
  it('BACKOFF_BASE_MS is 1000', () => {
    expect(BACKOFF_BASE_MS).toBe(1_000);
  });
});

// ── Rate limiting tests ──────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('allows calls within the limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit()).toBe(true);
    }
  });

  it('blocks calls that exceed the limit', () => {
    // Default limit is 120/min
    for (let i = 0; i < 120; i++) {
      checkRateLimit();
    }
    expect(checkRateLimit()).toBe(false);
  });

  it('resetRateLimit clears state', () => {
    for (let i = 0; i < 120; i++) checkRateLimit();
    expect(checkRateLimit()).toBe(false);
    resetRateLimit();
    expect(checkRateLimit()).toBe(true);
  });
});

// ── Session corruption recovery tests ────────────────────────────────────────

describe('session corruption recovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recoverSession restores from backup', async () => {
    const { recoverSession } = await import('../src/session.js');
    const filePath = path.join(tmpDir, 'test-session.json');
    const backupPath = filePath + '.bak';
    const validSession = {
      id: 'test-id',
      model: 'llama3',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      history: [],
      totalTokens: 0,
      taskCount: 0,
    };

    // Write corrupt main file and valid backup
    fs.writeFileSync(filePath, '{corrupt json!!!', 'utf-8');
    fs.writeFileSync(backupPath, JSON.stringify(validSession), 'utf-8');

    const recovered = recoverSession(filePath);
    expect(recovered).not.toBeNull();
    expect(recovered!.id).toBe('test-id');
    expect(recovered!.model).toBe('llama3');

    // Main file should be restored
    const restored = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(restored.id).toBe('test-id');
  });

  it('recoverSession returns null when no backup exists', async () => {
    const { recoverSession } = await import('../src/session.js');
    const filePath = path.join(tmpDir, 'no-backup.json');
    fs.writeFileSync(filePath, '{corrupt}', 'utf-8');
    expect(recoverSession(filePath)).toBeNull();
  });

  it('recoverSession returns null when backup is also corrupt', async () => {
    const { recoverSession } = await import('../src/session.js');
    const filePath = path.join(tmpDir, 'double-corrupt.json');
    fs.writeFileSync(filePath, '{bad}', 'utf-8');
    fs.writeFileSync(filePath + '.bak', '{also bad}', 'utf-8');
    expect(recoverSession(filePath)).toBeNull();
  });
});
