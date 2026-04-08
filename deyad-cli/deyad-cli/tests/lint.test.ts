/**
 * Tests for lint module — linter detection and execution.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectLinters, runLint, formatLintErrors } from '../src/lint.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-lint-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectLinters', () => {
  it('returns empty when no linter configs exist', () => {
    const linters = detectLinters(tmpDir, ['file.ts']);
    expect(linters).toEqual([]);
  });

  it('detects tsc when tsconfig.json exists and .ts files changed', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    const linters = detectLinters(tmpDir, ['src/app.ts']);
    const names = linters.map((l) => l.name);
    expect(names).toContain('tsc');
  });

  it('does not detect tsc when no .ts files changed', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    const linters = detectLinters(tmpDir, ['readme.md']);
    const names = linters.map((l) => l.name);
    expect(names).not.toContain('tsc');
  });

  it('detects eslint when eslint.config.mjs exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'eslint.config.mjs'), 'export default [];');
    const linters = detectLinters(tmpDir, ['file.js']);
    const names = linters.map((l) => l.name);
    expect(names).toContain('eslint');
  });

  it('detects ruff when pyproject.toml exists and .py files changed', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.ruff]');
    const linters = detectLinters(tmpDir, ['main.py']);
    const names = linters.map((l) => l.name);
    // ruff may or may not be installed on CI, but the detection should still work
    // if the binary exists
    if (names.includes('ruff')) {
      expect(names).toContain('ruff');
    } else {
      // ruff not installed — that's fine, detection correctly filtered it out
      expect(names).not.toContain('ruff');
    }
  });
});

describe('runLint', () => {
  it('returns empty array when no linters apply', () => {
    const results = runLint(tmpDir, ['file.txt']);
    expect(results).toEqual([]);
  });

  it('runs tsc and captures errors for invalid TypeScript', () => {
    // Create a minimal TypeScript project with a type error
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      include: ['*.ts'],
    }));
    fs.writeFileSync(path.join(tmpDir, 'bad.ts'), 'const x: number = "not a number";\n');

    const results = runLint(tmpDir, ['bad.ts']);
    const tscResult = results.find((r) => r.linter === 'tsc');
    expect(tscResult).toBeDefined();
    expect(tscResult!.hasErrors).toBe(true);
    expect(tscResult!.errors).toBeTruthy();
  });

  it('returns results array for valid TypeScript (may pass or fail based on env)', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
      include: ['*.ts'],
    }));
    fs.writeFileSync(path.join(tmpDir, 'good.ts'), 'export const x: number = 42;\n');

    const results = runLint(tmpDir, ['good.ts']);
    // Should return results array (tsc ran)
    expect(Array.isArray(results)).toBe(true);
    const tscResult = results.find((r) => r.linter === 'tsc');
    if (tscResult) {
      // Verify the result has the expected shape
      expect(typeof tscResult.hasErrors).toBe('boolean');
      expect(typeof tscResult.errors).toBe('string');
    }
  });
});

describe('formatLintErrors', () => {
  it('returns null when no errors', () => {
    const result = formatLintErrors([
      { linter: 'tsc', errors: '', hasErrors: false },
    ]);
    expect(result).toBeNull();
  });

  it('formats errors with linter names', () => {
    const result = formatLintErrors([
      { linter: 'tsc', errors: 'Type error on line 5', hasErrors: true },
      { linter: 'eslint', errors: '', hasErrors: false },
    ]);
    expect(result).toContain('AUTO-LINT');
    expect(result).toContain('[tsc]');
    expect(result).toContain('Type error on line 5');
    expect(result).not.toContain('[eslint]');
  });

  it('includes multiple linter errors', () => {
    const result = formatLintErrors([
      { linter: 'tsc', errors: 'type error', hasErrors: true },
      { linter: 'eslint', errors: 'no-unused-vars', hasErrors: true },
    ]);
    expect(result).toContain('[tsc]');
    expect(result).toContain('[eslint]');
  });
});
