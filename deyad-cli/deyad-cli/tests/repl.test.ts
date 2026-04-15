/**
 * Tests for REPL types and configuration interface.
 * The REPL itself is interactive and tested via E2E; these cover the exported types/interfaces.
 */
import { describe, it, expect } from 'vitest';
import type { ReplConfig, ReplState } from '../src/repl.js';

describe('ReplConfig interface', () => {
  it('accepts a valid config object', () => {
    const cfg: ReplConfig = {
      model: 'test',
      models: ['test'],
      cwd: '/tmp',
      autoApprove: false,
      noThink: false,
      temperature: 0.3,
      ollamaHost: 'http://localhost:11434',
      contextSize: 8192,
      maxIterations: 30,
      gitAutoCommit: true,
      allowedTools: [],
      restrictedTools: [],
      resume: true,
    };
    expect(cfg.model).toBe('test');
    expect(cfg.cwd).toBe('/tmp');
    expect(cfg.allowedTools).toEqual([]);
  });

  it('enforces all required fields at type level', () => {
    // This test verifies the interface shape — if a field is removed from ReplConfig,
    // TypeScript compilation will fail here.
    const fields: (keyof ReplConfig)[] = [
      'model', 'models', 'cwd', 'autoApprove', 'noThink',
      'temperature', 'ollamaHost', 'contextSize', 'maxIterations',
      'gitAutoCommit', 'allowedTools', 'restrictedTools', 'resume',
    ];
    expect(fields).toHaveLength(13);
  });
});

describe('ReplState interface', () => {
  it('has the expected method signatures', () => {
    // Verify the interface shape at the type level
    const fields: (keyof ReplState)[] = [
      'cfg', 'session', 'history', 'totalTokens', 'taskCount',
      'rl', 'saveSession', 'runGitCommitPush',
    ];
    expect(fields).toHaveLength(8);
  });
});
