import { describe, it, expect } from 'vitest';
import { detectErrors, buildErrorFixPrompt } from './errorDetector';
import type { DetectedError } from './errorDetector';

describe('detectErrors', () => {
  it('returns empty array for clean output', () => {
    expect(detectErrors('Build succeeded.\nCompiled successfully.')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(detectErrors('')).toEqual([]);
  });

  it('detects TypeScript errors with TS code', () => {
    const errors = detectErrors('ERROR(TS2345): Argument of type string is not assignable to number');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('typescript');
    expect(errors[0].message).toContain('Argument of type string');
  });

  it('detects file-based TS errors with line and column', () => {
    const errors = detectErrors('src/App.tsx(12,5): error TS2322: Type string is not assignable');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('typescript');
    expect(errors[0].file).toBe('src/App.tsx');
    expect(errors[0].line).toBe(12);
    expect(errors[0].column).toBe(5);
    expect(errors[0].message).toContain('TS2322');
  });

  it('detects Vite errors', () => {
    const errors = detectErrors('✘ [ERROR] Could not resolve "missing-module"');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('build');
    expect(errors[0].message).toContain('Could not resolve');
  });

  it('detects Internal server error from Vite', () => {
    const errors = detectErrors('[vite] Internal server error: Transform failed');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('build');
    expect(errors[0].message).toContain('Transform failed');
  });

  it('detects module not found errors', () => {
    const errors = detectErrors("Module not found: Error: Can't resolve 'react-router'");
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('module');
    expect(errors[0].message).toContain("Can't resolve 'react-router'");
  });

  it('detects syntax errors', () => {
    const errors = detectErrors('SyntaxError: Unexpected token }');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('syntax');
    expect(errors[0].message).toContain('Unexpected token }');
  });

  it('detects generic file errors with path:line:col format', () => {
    const errors = detectErrors('src/utils/auth.ts:45:10: error Type is undefined');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('build');
    expect(errors[0].file).toBe('src/utils/auth.ts');
    expect(errors[0].line).toBe(45);
    expect(errors[0].column).toBe(10);
  });

  it('detects runtime errors', () => {
    const input = 'Uncaught TypeError: Cannot read properties of undefined';
    const errors = detectErrors(input);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('runtime');
  });

  it('detects ReferenceError', () => {
    const errors = detectErrors('ReferenceError: x is not defined');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('runtime');
  });

  it('detects multiple errors in one chunk', () => {
    const text = `src/App.tsx(5,3): error TS2345: Bad type
SyntaxError: Unexpected token
Module not found: Can't resolve 'lodash'`;
    const errors = detectErrors(text);
    expect(errors).toHaveLength(3);
    expect(errors[0].type).toBe('typescript');
    expect(errors[1].type).toBe('syntax');
    expect(errors[2].type).toBe('module');
  });

  it('preserves the raw line in every error', () => {
    const line = 'SyntaxError: Unexpected end of input';
    const errors = detectErrors(line);
    expect(errors[0].raw).toBe(line);
  });
});

describe('buildErrorFixPrompt', () => {
  const sampleErrors: DetectedError[] = [
    { type: 'typescript', message: 'TS2345: Bad type', raw: 'error TS2345: Bad type' },
    { type: 'module', message: "Can't resolve 'lodash'", file: 'src/App.tsx', raw: "Module not found: Can't resolve 'lodash'" },
  ];

  it('includes error type and message in prompt', () => {
    const prompt = buildErrorFixPrompt(sampleErrors);
    expect(prompt).toContain('[TYPESCRIPT]');
    expect(prompt).toContain('TS2345: Bad type');
    expect(prompt).toContain('[MODULE]');
    expect(prompt).toContain("Can't resolve 'lodash'");
  });

  it('includes file reference when available', () => {
    const prompt = buildErrorFixPrompt(sampleErrors);
    expect(prompt).toContain('(in src/App.tsx)');
  });

  it('includes affected file contents when provided', () => {
    const files = { 'src/App.tsx': 'import lodash from "lodash";\nexport default function App() {}' };
    const prompt = buildErrorFixPrompt(sampleErrors, files);
    expect(prompt).toContain('### src/App.tsx');
    expect(prompt).toContain('import lodash');
  });

  it('handles errors with no file reference', () => {
    const errors: DetectedError[] = [
      { type: 'syntax', message: 'Unexpected token', raw: 'SyntaxError: Unexpected token' },
    ];
    const prompt = buildErrorFixPrompt(errors);
    expect(prompt).toContain('[SYNTAX]');
    expect(prompt).toContain('Unexpected token');
    expect(prompt).not.toContain('(in ');
  });

  it('handles errors with line numbers in file reference', () => {
    const errors: DetectedError[] = [
      { type: 'typescript', message: 'TS2322: Bad type', file: 'src/App.tsx', line: 10, raw: 'error' },
    ];
    const prompt = buildErrorFixPrompt(errors);
    expect(prompt).toContain('(in src/App.tsx:10)');
  });
});
