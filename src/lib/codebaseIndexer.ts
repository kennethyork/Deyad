/**
 * Codebase indexer for semantic file ranking.
 *
 * Uses TF-IDF as the primary ranking mechanism with optional Ollama
 * embeddings as a boost signal. Works entirely locally — no cloud APIs.
 *
 * The index is built per-project and cached in memory. It is invalidated
 * whenever files change (checked via a content hash).
 */

import { crc32 } from './crc32';

// ── TF-IDF index ──────────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  /** Lowercased token bag (words from path + content). */
  tokens: string[];
  /** Term frequency map: token → count/total. */
  tf: Map<string, number>;
}

interface CodebaseIndex {
  /** CRC32 hash of all file paths+sizes (used for invalidation). */
  hash: number;
  files: FileEntry[];
  /** Inverse document frequency: token → idf score. */
  idf: Map<string, number>;
  /** Optional: Ollama embedding vectors per file path. */
  embeddings: Map<string, number[]>;
}

const indexCache = new Map<string, CodebaseIndex>();

/** Tokenize code into meaningful words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // split on non-alphanumeric (keeps camelCase parts via second pass)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/** Compute a fast hash of the file map for cache invalidation. */
function computeHash(files: Record<string, string>): number {
  const keys = Object.keys(files).sort();
  const summary = keys.map((k) => `${k}:${files[k].length}`).join('|');
  return crc32(Buffer.from(summary));
}

/**
 * Build or retrieve the TF-IDF index for a project.
 */
export function getOrBuildIndex(appId: string, files: Record<string, string>): CodebaseIndex {
  const hash = computeHash(files);
  const cached = indexCache.get(appId);
  if (cached && cached.hash === hash) return cached;

  const entries: FileEntry[] = [];
  const docFreq = new Map<string, number>(); // token → doc count

  for (const [filePath, content] of Object.entries(files)) {
    // Combine path tokens + content tokens (first 5000 chars for speed)
    const raw = filePath + ' ' + content.slice(0, 5000);
    const tokens = tokenize(raw);
    const tfMap = new Map<string, number>();
    const seen = new Set<string>();

    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        docFreq.set(t, (docFreq.get(t) || 0) + 1);
      }
    }
    // Normalize TF by total tokens
    const total = tokens.length || 1;
    for (const [k, v] of tfMap) {
      tfMap.set(k, v / total);
    }

    entries.push({ path: filePath, tokens, tf: tfMap });
  }

  // Compute IDF
  const N = entries.length || 1;
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log(N / df));
  }

  const index: CodebaseIndex = { hash, files: entries, idf, embeddings: new Map() };
  indexCache.set(appId, index);
  return index;
}

/**
 * Rank files by TF-IDF relevance to a query string.
 * Returns a map of filePath → relevance score (0–100 scale).
 */
export function rankFilesByQuery(
  index: CodebaseIndex,
  query: string,
): Map<string, number> {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return new Map();

  const scores = new Map<string, number>();
  let maxScore = 0;

  for (const entry of index.files) {
    let score = 0;
    for (const qt of queryTokens) {
      const tf = entry.tf.get(qt) || 0;
      const idfVal = index.idf.get(qt) || 0;
      score += tf * idfVal;
    }
    if (score > 0) {
      scores.set(entry.path, score);
      if (score > maxScore) maxScore = score;
    }
  }

  // Normalize to 0–100
  if (maxScore > 0) {
    for (const [path, s] of scores) {
      scores.set(path, (s / maxScore) * 100);
    }
  }

  return scores;
}

/**
 * Update the index with Ollama embeddings for the top N files.
 * This is async and optional — the index works without embeddings.
 */
export async function enrichWithEmbeddings(
  appId: string,
  files: Record<string, string>,
  model: string,
  topN = 30,
): Promise<void> {
  const index = getOrBuildIndex(appId, files);
  
  // Pick the top N files by content length (most informative)
  const sorted = Object.entries(files)
    .filter(([p]) => !p.includes('node_modules') && !p.endsWith('.lock'))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN);

  // Skip files that already have embeddings
  const toEmbed = sorted.filter(([p]) => !index.embeddings.has(p));
  if (toEmbed.length === 0) return;

  // Batch embed (Ollama /api/embed supports string[] input)
  const inputs = toEmbed.map(([p, c]) => {
    // Use path + first 500 chars as the embedding input
    return `${p}\n${c.slice(0, 500)}`;
  });

  try {
    const result = await window.deyad.embed(model, inputs);
    if (result.embeddings.length === toEmbed.length) {
      for (let i = 0; i < toEmbed.length; i++) {
        index.embeddings.set(toEmbed[i][0], result.embeddings[i]);
      }
    }
  } catch {
    // Embeddings are optional — fail silently
  }
}

/**
 * Rank files by cosine similarity to a query embedding.
 * Returns a map of filePath → similarity score (0–100).
 */
export async function rankFilesBySemantic(
  appId: string,
  files: Record<string, string>,
  query: string,
  model: string,
): Promise<Map<string, number>> {
  const index = getOrBuildIndex(appId, files);
  if (index.embeddings.size === 0) return new Map();

  try {
    const { embeddings } = await window.deyad.embed(model, query);
    if (!embeddings[0]) return new Map();
    const queryVec = embeddings[0];

    const scores = new Map<string, number>();
    let maxScore = 0;

    for (const [path, fileVec] of index.embeddings) {
      const sim = cosineSimilarity(queryVec, fileVec);
      if (sim > 0) {
        scores.set(path, sim);
        if (sim > maxScore) maxScore = sim;
      }
    }

    // Normalize to 0–100
    if (maxScore > 0) {
      for (const [path, s] of scores) {
        scores.set(path, (s / maxScore) * 100);
      }
    }
    return scores;
  } catch {
    return new Map();
  }
}

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Clear the cached index for a project (e.g. when files change). */
export function clearIndex(appId: string): void {
  indexCache.delete(appId);
}
