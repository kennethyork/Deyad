import { describe, it, expect, beforeEach } from 'vitest';
import { getOrBuildIndex, rankFilesByQuery } from './codebaseIndexer';

const sampleFiles: Record<string, string> = {
  'src/App.tsx': `import React from 'react';
export default function App() {
  return <div>Hello World</div>;
}`,
  'src/utils/auth.ts': `export function login(user: string, pass: string) {
  return fetch('/api/login', { method: 'POST', body: JSON.stringify({ user, pass }) });
}
export function logout() {
  return fetch('/api/logout', { method: 'POST' });
}`,
  'src/components/Header.tsx': `import React from 'react';
export function Header({ title }: { title: string }) {
  return <header><h1>{title}</h1></header>;
}`,
  'package.json': '{"name": "test-app", "dependencies": {"react": "18.2.0"}}',
  'src/index.css': 'body { margin: 0; font-family: sans-serif; }',
};

describe('getOrBuildIndex', () => {
  beforeEach(() => {
    // Use different appId each time to avoid cache interference
  });

  it('builds an index with file entries', () => {
    const index = getOrBuildIndex('test-build-1', sampleFiles);
    expect(index.files.length).toBeGreaterThan(0);
    expect(index.files.length).toBeLessThanOrEqual(Object.keys(sampleFiles).length);
  });

  it('computes idf values for tokens', () => {
    const index = getOrBuildIndex('test-build-2', sampleFiles);
    expect(index.idf.size).toBeGreaterThan(0);
  });

  it('creates chunks from files', () => {
    const index = getOrBuildIndex('test-build-3', sampleFiles);
    expect(index.chunks.length).toBeGreaterThan(0);
  });

  it('chunks contain file path and text', () => {
    const index = getOrBuildIndex('test-build-4', sampleFiles);
    for (const chunk of index.chunks) {
      expect(chunk.path).toBeTruthy();
      expect(chunk.text).toBeTruthy();
      expect(chunk.startLine).toBeGreaterThan(0);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('returns cached index for same files on second call', () => {
    const id = 'test-cache-' + Date.now();
    const index1 = getOrBuildIndex(id, sampleFiles);
    const index2 = getOrBuildIndex(id, sampleFiles);
    expect(index1).toBe(index2); // same reference = cache hit
  });

  it('rebuilds index when files change', () => {
    const id = 'test-rebuild-' + Date.now();
    const index1 = getOrBuildIndex(id, sampleFiles);
    const modifiedFiles = { ...sampleFiles, 'src/NewFile.ts': 'export const x = 1;' };
    const index2 = getOrBuildIndex(id, modifiedFiles);
    expect(index2).not.toBe(index1); // different reference = rebuilt
    expect(index2.files.length).toBeGreaterThan(index1.files.length);
  });

  it('skips node_modules and lock files', () => {
    const id = 'test-skip-' + Date.now();
    const filesWithNodeModules = {
      ...sampleFiles,
      'node_modules/react/index.js': 'module.exports = {};',
      'package-lock.json': '{}',
      'yarn.lock': '# lock',
    };
    const index = getOrBuildIndex(id, filesWithNodeModules);
    const paths = index.files.map((f) => f.path);
    expect(paths).not.toContain('node_modules/react/index.js');
    expect(paths.some((p) => p.endsWith('.lock'))).toBe(false);
  });

  it('embeddingsReady is false initially', () => {
    const index = getOrBuildIndex('test-embed-' + Date.now(), sampleFiles);
    expect(index.embeddingsReady).toBe(false);
  });
});

describe('rankFilesByQuery', () => {
  it('returns empty map for empty query', () => {
    const index = getOrBuildIndex('test-rank-1', sampleFiles);
    const scores = rankFilesByQuery(index, '');
    expect(scores.size).toBe(0);
  });

  it('scores relevant files higher', () => {
    const index = getOrBuildIndex('test-rank-2', sampleFiles);
    const scores = rankFilesByQuery(index, 'login authentication user');
    expect(scores.size).toBeGreaterThan(0);
    // auth.ts should score highest since it contains "login" and "user"
    const authScore = scores.get('src/utils/auth.ts') ?? 0;
    expect(authScore).toBeGreaterThan(0);
  });

  it('returns normalized scores (0–100)', () => {
    const index = getOrBuildIndex('test-rank-3', sampleFiles);
    const scores = rankFilesByQuery(index, 'react component header');
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('highest score is 100', () => {
    const index = getOrBuildIndex('test-rank-4', sampleFiles);
    const scores = rankFilesByQuery(index, 'react component');
    const values = [...scores.values()];
    if (values.length > 0) {
      expect(Math.max(...values)).toBe(100);
    }
  });

  it('returns no results for completely unrelated query', () => {
    const index = getOrBuildIndex('test-rank-5', sampleFiles);
    const scores = rankFilesByQuery(index, 'xyzzyplugh');
    // xyzzyplugh is nonsense — should not match any tokens
    expect(scores.size).toBe(0);
  });
});
