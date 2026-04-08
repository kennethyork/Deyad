/**
 * Tests for RAG (Retrieval-Augmented Generation) module — BM25 codebase indexing.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildIndex, queryIndex, formatRAGContext, getIndexStats, invalidateIndex } from '../src/rag.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-rag-test-'));
  invalidateIndex();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string) {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('buildIndex', () => {
  test('indexes TypeScript files into chunks', () => {
    writeFile('src/hello.ts', 'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n');
    writeFile('src/math.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');

    const index = buildIndex(tmpDir, true);
    expect(index.fileCount).toBeGreaterThanOrEqual(2);
    expect(index.chunks.length).toBeGreaterThanOrEqual(2);
    expect(index.totalDocs).toBe(index.chunks.length);
    expect(index.avgDocLen).toBeGreaterThan(0);
    expect(index.indexedAt).toBeLessThanOrEqual(Date.now());
  });

  test('returns cached index within 60s', () => {
    writeFile('src/a.ts', 'const x = 1;');
    const index1 = buildIndex(tmpDir, true);
    const index2 = buildIndex(tmpDir); // should return cached
    expect(index1).toBe(index2); // same reference
  });

  test('force rebuild ignores cache', () => {
    writeFile('src/a.ts', 'const x = 1;');
    const index1 = buildIndex(tmpDir, true);
    const index2 = buildIndex(tmpDir, true); // forced rebuild
    expect(index1).not.toBe(index2); // different reference
  });

  test('skips files larger than 100KB', () => {
    writeFile('big.ts', 'x'.repeat(200_000));
    writeFile('small.ts', 'const y = 2;');
    const index = buildIndex(tmpDir, true);
    const bigChunks = index.chunks.filter(c => c.file.includes('big.ts'));
    expect(bigChunks.length).toBe(0);
  });

  test('chunks large files with overlap', () => {
    // Create a file with 100 lines
    const lines = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`);
    writeFile('large.ts', lines.join('\n'));
    const index = buildIndex(tmpDir, true);
    const chunks = index.chunks.filter(c => c.file.includes('large.ts'));
    expect(chunks.length).toBeGreaterThan(1); // should be chunked
    // Chunks should have overlap
    if (chunks.length >= 2) {
      expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine);
    }
  });

  test('handles empty directory', () => {
    const index = buildIndex(tmpDir, true);
    expect(index.chunks.length).toBe(0);
    expect(index.fileCount).toBe(0);
  });

  test('builds document frequency map', () => {
    writeFile('a.ts', 'function hello() { return "hello"; }');
    writeFile('b.ts', 'function world() { return "world"; }');
    const index = buildIndex(tmpDir, true);
    // "function" should appear in both docs
    const funcDf = index.docFreq.get('function');
    expect(funcDf).toBe(2);
  });
});

describe('queryIndex', () => {
  test('finds relevant chunks by BM25 scoring', () => {
    writeFile('src/auth.ts', 'export function authenticate(user: string, password: string) {\n  // Validate credentials\n  return true;\n}\n');
    writeFile('src/math.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    writeFile('src/utils.ts', 'export function formatDate(d: Date) {\n  return d.toISOString();\n}\n');

    const results = queryIndex('authenticate user password', tmpDir, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    // auth.ts should rank highest for authentication query
    expect(results[0].chunk.file).toContain('auth.ts');
  });

  test('returns empty for unrelated queries', () => {
    writeFile('src/math.ts', 'export function add(a: number, b: number) { return a + b; }');
    const results = queryIndex('kubernetes deployment yaml', tmpDir, 5);
    // Should return empty or very low-score results
    expect(results.every(r => r.score >= 0)).toBe(true);
  });

  test('respects topK parameter', () => {
    for (let i = 0; i < 10; i++) {
      writeFile(`src/file${i}.ts`, `export const value${i} = ${i}; // value constant`);
    }
    const results = queryIndex('value constant', tmpDir, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('returns results sorted by score descending', () => {
    writeFile('a.ts', 'database connection query select from table');
    writeFile('b.ts', 'database schema migration alter table add column');
    writeFile('c.ts', 'hello world greeting message');

    const results = queryIndex('database table query', tmpDir, 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  test('handles empty query', () => {
    writeFile('a.ts', 'const x = 1;');
    const results = queryIndex('', tmpDir, 5);
    expect(results.length).toBe(0);
  });
});

describe('formatRAGContext', () => {
  test('formats results with file locations and scores', () => {
    const results = [
      {
        chunk: { file: 'src/auth.ts', startLine: 1, endLine: 5, content: 'function auth() {}', tokens: ['function', 'auth'] },
        score: 3.14,
      },
    ];
    const formatted = formatRAGContext(results);
    expect(formatted).toContain('src/auth.ts:1-5');
    expect(formatted).toContain('3.14');
    expect(formatted).toContain('function auth() {}');
    expect(formatted).toContain('RAG');
  });

  test('returns empty string for no results', () => {
    expect(formatRAGContext([])).toBe('');
  });

  test('truncates very long chunk content', () => {
    const longContent = 'x'.repeat(2000);
    const results = [
      {
        chunk: { file: 'big.ts', startLine: 1, endLine: 50, content: longContent, tokens: ['x'] },
        score: 1.0,
      },
    ];
    const formatted = formatRAGContext(results);
    expect(formatted.length).toBeLessThan(longContent.length);
    expect(formatted).toContain('...');
  });
});

describe('getIndexStats', () => {
  test('returns null when no index built', () => {
    expect(getIndexStats(tmpDir)).toBeNull();
  });

  test('returns stats after building index', () => {
    writeFile('a.ts', 'const x = 1;');
    buildIndex(tmpDir, true);
    const stats = getIndexStats(tmpDir);
    expect(stats).not.toBeNull();
    expect(stats!.files).toBeGreaterThanOrEqual(1);
    expect(stats!.chunks).toBeGreaterThanOrEqual(1);
    expect(stats!.age).toMatch(/\d+s ago/);
  });

  test('returns null for different cwd', () => {
    writeFile('a.ts', 'const x = 1;');
    buildIndex(tmpDir, true);
    expect(getIndexStats('/nonexistent')).toBeNull();
  });
});

describe('invalidateIndex', () => {
  test('clears the cached index', () => {
    writeFile('a.ts', 'const x = 1;');
    buildIndex(tmpDir, true);
    expect(getIndexStats(tmpDir)).not.toBeNull();
    invalidateIndex();
    expect(getIndexStats(tmpDir)).toBeNull();
  });
});
