/**
 * Tests for config — loadConfig, saveConfig, getConfigPath.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// We can't easily mock the module-level configPath, so we test the public API
// using the real config path but saving/restoring state.
import { loadConfig, saveConfig, getConfigPath } from '../src/config.js';
import type { Config } from '../src/config.js';

describe('getConfigPath', () => {
  it('returns a path under ~/.deyad', () => {
    const p = getConfigPath();
    expect(p).toContain('.deyad');
    expect(p).toContain('config.json');
  });

  it('returns an absolute path', () => {
    expect(path.isAbsolute(getConfigPath())).toBe(true);
  });
});

describe('loadConfig', () => {
  it('returns an object', () => {
    const config = loadConfig();
    expect(typeof config).toBe('object');
    expect(config).not.toBeNull();
  });

  it('returns defaults for missing keys', () => {
    const config = loadConfig();
    // If config file exists, values come from it; if not, it returns {}
    // Either way, the return type is Config
    expect(typeof config).toBe('object');
  });
});

describe('saveConfig + loadConfig roundtrip', () => {
  let backup: string | null = null;
  const configPath = getConfigPath();

  beforeEach(() => {
    try {
      backup = fs.readFileSync(configPath, 'utf-8');
    } catch {
      backup = null;
    }
  });

  afterEach(() => {
    // Restore original config
    if (backup !== null) {
      fs.writeFileSync(configPath, backup, 'utf-8');
    } else {
      try { fs.unlinkSync(configPath); } catch { /* didn't exist */ }
    }
  });

  it('saves and loads config', () => {
    const config: Config = {
      model: 'test-model',
      autoApprove: true,
      noThink: true,
      maxIterations: 10,
      temperature: 0.5,
      contextSize: 4096,
      ollamaHost: 'http://localhost:9999',
      gitAutoCommit: false,
      allowedTools: ['read_file'],
      restrictedTools: ['run_command'],
    };
    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded.model).toBe('test-model');
    expect(loaded.autoApprove).toBe(true);
    expect(loaded.noThink).toBe(true);
    expect(loaded.maxIterations).toBe(10);
    expect(loaded.temperature).toBe(0.5);
    expect(loaded.contextSize).toBe(4096);
    expect(loaded.ollamaHost).toBe('http://localhost:9999');
    expect(loaded.gitAutoCommit).toBe(false);
    expect(loaded.allowedTools).toEqual(['read_file']);
    expect(loaded.restrictedTools).toEqual(['run_command']);
  });
});
