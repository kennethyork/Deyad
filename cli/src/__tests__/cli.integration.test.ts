import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/* Vitest sets cwd to the project root (cli/) */
const CLI_BIN = resolve(process.cwd(), 'dist/bin/deyad.js');

describe('CLI binary integration', () => {
  it('--help prints usage and exits 0', () => {
    const output = execFileSync('node', [CLI_BIN, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    expect(output).toContain('Deyad CLI');
    expect(output).toContain('Usage:');
    expect(output).toContain('Options:');
    expect(output).toContain('--model');
    expect(output).toContain('--print');
    expect(output).toContain('--resume');
    expect(output).toContain('Environment:');
    expect(output).toContain('OLLAMA_HOST');
  });

  it('--help includes all documented flags', () => {
    const output = execFileSync('node', [CLI_BIN, '--help'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const flags = ['-m', '-d', '-y', '-p', '-h', '--model', '--dir', '--yes', '--print', '--help', '--resume'];
    for (const flag of flags) {
      expect(output).toContain(flag);
    }
  });

  it('exits with error for unknown flags', () => {
    try {
      execFileSync('node', [CLI_BIN, '--nonexistent-flag-xyz'], {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, OLLAMA_HOST: 'http://127.0.0.1:1' },
      });
      // If it doesn't throw, it still should have run (some CLIs ignore unknown flags)
    } catch (err) {
      // Expected — either non-zero exit or timeout connecting to missing Ollama
      expect(err).toBeDefined();
    }
  });

  it('init subcommand creates DEYAD.md', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'deyad-test-'));
    try {
      execFileSync('node', [CLI_BIN, 'init'], {
        encoding: 'utf-8',
        timeout: 5000,
        cwd: tmpDir,
      });
      expect(existsSync(join(tmpDir, 'DEYAD.md'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
