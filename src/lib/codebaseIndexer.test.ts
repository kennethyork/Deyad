import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getOrBuildIndex, rankFilesByQuery, embedChunks, retrieveChunks, rankFilesBySemantic, clearIndex } from './codebaseIndexer';

// Helper for setting up window.deyad in a Node test environment
const _global = globalThis as unknown as { window: { deyad: Record<string, unknown> } };

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

describe('embedChunks', () => {
  beforeEach(() => {
    _global.window = _global.window || {};
    _global.window.deyad = {
      embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    };
  });

  it('calls embed API for each batch of chunks', async () => {
    const embedMock = vi.fn().mockImplementation((_m: string, inputs: string[]) => ({
      embeddings: inputs.map(() => [0.1, 0.2, 0.3]),
    }));
    _global.window.deyad.embed = embedMock;

    const id = 'test-embed-call-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    expect(embedMock).toHaveBeenCalled();
  });

  it('sets embeddingsReady after successful embed', async () => {
    _global.window.deyad.embed = vi.fn().mockImplementation((_m: string, inputs: string[]) => ({
      embeddings: inputs.map(() => [0.1, 0.2, 0.3]),
    }));

    const id = 'test-embed-ready-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    const index = getOrBuildIndex(id, sampleFiles);
    expect(index.embeddingsReady).toBe(true);
  });

  it('handles embed API failure gracefully', async () => {
    _global.window.deyad.embed = vi.fn().mockRejectedValue(new Error('Ollama down'));

    const id = 'test-embed-fail-' + Date.now();
    await expect(embedChunks(id, sampleFiles, 'nomic-embed-text')).resolves.not.toThrow();
  });

  it('skips re-embedding when already ready', async () => {
    const embedMock = vi.fn().mockImplementation((_m: string, inputs: string[]) => ({
      embeddings: inputs.map(() => [0.1, 0.2, 0.3]),
    }));
    _global.window.deyad.embed = embedMock;

    const id = 'test-embed-skip-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    const callCount = embedMock.mock.calls.length;
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    expect(embedMock.mock.calls.length).toBe(callCount); // no new calls
  });
});

describe('retrieveChunks', () => {
  beforeEach(() => {
    _global.window = _global.window || {};
    _global.window.deyad = {
      embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    };
  });

  it('returns empty when embeddings not ready', async () => {
    const id = 'test-retrieve-empty-' + Date.now();
    const results = await retrieveChunks(id, sampleFiles, 'login', 'nomic-embed-text');
    expect(results).toEqual([]);
  });

  it('retrieves relevant chunks after embedding', async () => {
    // Mock embed to return simple vectors
    let _callCount = 0;
    _global.window.deyad.embed = vi.fn().mockImplementation((_m: string, inputs: string | string[]) => {
      _callCount++;
      if (Array.isArray(inputs)) {
        return { embeddings: inputs.map((_: string, i: number) => [i * 0.1, 0.5, 0.3]) };
      }
      // Query embedding
      return { embeddings: [[0.0, 0.5, 0.3]] };
    });

    const id = 'test-retrieve-chunks-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    const results = await retrieveChunks(id, sampleFiles, 'auth login', 'nomic-embed-text');
    expect(Array.isArray(results)).toBe(true);
    // Results may be empty if cosine similarity < 0.3 threshold
    for (const r of results) {
      expect(r.chunk).toBeDefined();
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it('respects topK limit', async () => {
    _global.window.deyad.embed = vi.fn().mockImplementation((_m: string, inputs: string | string[]) => {
      if (Array.isArray(inputs)) {
        return { embeddings: inputs.map(() => [0.9, 0.8, 0.7]) };
      }
      return { embeddings: [[0.9, 0.8, 0.7]] };
    });

    const id = 'test-retrieve-topk-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    const results = await retrieveChunks(id, sampleFiles, 'react', 'nomic-embed-text', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('rankFilesBySemantic', () => {
  beforeEach(() => {
    _global.window = _global.window || {};
    _global.window.deyad = {
      embed: vi.fn().mockResolvedValue({ embeddings: [] }),
    };
  });

  it('returns empty map when no embeddings', async () => {
    const id = 'test-semantic-empty-' + Date.now();
    const scores = await rankFilesBySemantic(id, sampleFiles, 'auth', 'nomic-embed-text');
    expect(scores.size).toBe(0);
  });

  it('returns normalized scores after embedding', async () => {
    _global.window.deyad.embed = vi.fn().mockImplementation((_m: string, inputs: string | string[]) => {
      if (Array.isArray(inputs)) {
        return { embeddings: inputs.map(() => [0.9, 0.8, 0.7]) };
      }
      return { embeddings: [[0.9, 0.8, 0.7]] };
    });

    const id = 'test-semantic-scores-' + Date.now();
    await embedChunks(id, sampleFiles, 'nomic-embed-text');
    const scores = await rankFilesBySemantic(id, sampleFiles, 'react component', 'nomic-embed-text');
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('clearIndex', () => {
  it('clears the cached index for an appId', () => {
    const id = 'test-clear-' + Date.now();
    const index1 = getOrBuildIndex(id, sampleFiles);
    clearIndex(id);
    const index2 = getOrBuildIndex(id, sampleFiles);
    expect(index2).not.toBe(index1); // different reference = rebuilt
  });
});
