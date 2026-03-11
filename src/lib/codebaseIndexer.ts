/**
 * Codebase indexer with chunked vector embeddings (RAG pipeline).
 *
 * Splits files into overlapping chunks, embeds them via Ollama, and
 * retrieves the most relevant chunks for any query using cosine similarity.
 * Falls back to TF-IDF when embeddings are unavailable.
 *
 * Works entirely locally — no cloud APIs.
 */

import { crc32 } from './crc32';

// ── Chunk config ──────────────────────────────────────────────────────────────

/** Target chunk size in characters (~200 tokens). */
const CHUNK_SIZE = 700;
/** Overlap between consecutive chunks (helps preserve context at boundaries). */
const CHUNK_OVERLAP = 150;
/** Max chunks to embed per project (controls Ollama load). */
const MAX_CHUNKS_TO_EMBED = 500;
/** Batch size for Ollama embed calls. */
const EMBED_BATCH_SIZE = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chunk {
  /** Source file path. */
  path: string;
  /** Chunk content. */
  text: string;
  /** Start line in original file (1-based). */
  startLine: number;
  /** End line in original file (1-based). */
  endLine: number;
  /** Embedding vector (populated after embed pass). */
  embedding?: number[];
}

interface FileEntry {
  path: string;
  tokens: string[];
  tf: Map<string, number>;
}

interface CodebaseIndex {
  hash: number;
  /** TF-IDF file entries (fast fallback). */
  files: FileEntry[];
  idf: Map<string, number>;
  /** Chunked content for RAG. */
  chunks: Chunk[];
  /** Whether embeddings have been computed for chunks. */
  embeddingsReady: boolean;
  /** Query embedding cache: query text → vector. */
  queryCache: Map<string, number[]>;
}

const indexCache = new Map<string, CodebaseIndex>();

// ── Tokenization (TF-IDF fallback) ───────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function computeHash(files: Record<string, string>): number {
  const keys = Object.keys(files).sort();
  const summary = keys.map((k) => `${k}:${files[k].length}`).join('|');
  return crc32(new TextEncoder().encode(summary));
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split a file into overlapping chunks.
 * Chunks are split on line boundaries to preserve code structure.
 */
function chunkFile(filePath: string, content: string): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let i = 0;

  while (i < lines.length) {
    let chunkText = '';
    const startLine = i + 1;
    let endLine = startLine;

    // Build chunk up to CHUNK_SIZE chars
    while (i < lines.length && chunkText.length < CHUNK_SIZE) {
      chunkText += (chunkText ? '\n' : '') + lines[i];
      endLine = i + 1;
      i++;
    }

    if (chunkText.trim()) {
      // Prefix with file path for context
      chunks.push({
        path: filePath,
        text: `// ${filePath} (lines ${startLine}-${endLine})\n${chunkText}`,
        startLine,
        endLine,
      });
    }

    // Step back by overlap (in lines)
    const overlapLines = Math.ceil(CHUNK_OVERLAP / 40); // ~40 chars per line
    i = Math.max(i - overlapLines, i - 1);
    if (i <= startLine - 1 + 1) i = endLine; // prevent infinite loop
  }

  return chunks;
}

// ── Index building ────────────────────────────────────────────────────────────

export function getOrBuildIndex(appId: string, files: Record<string, string>): CodebaseIndex {
  const hash = computeHash(files);
  const cached = indexCache.get(appId);
  if (cached && cached.hash === hash) return cached;

  const entries: FileEntry[] = [];
  const docFreq = new Map<string, number>();
  const allChunks: Chunk[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    // Skip non-source files
    if (filePath.includes('node_modules') || filePath.endsWith('.lock') || filePath.endsWith('.map')) continue;

    // TF-IDF entry
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
    const total = tokens.length || 1;
    for (const [k, v] of tfMap) {
      tfMap.set(k, v / total);
    }
    entries.push({ path: filePath, tokens, tf: tfMap });

    // Chunk the file
    const fileChunks = chunkFile(filePath, content);
    allChunks.push(...fileChunks);
  }

  // Compute IDF
  const N = entries.length || 1;
  const idf = new Map<string, number>();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log(N / df));
  }

  // Limit chunk count
  const chunks = allChunks.slice(0, MAX_CHUNKS_TO_EMBED);

  const index: CodebaseIndex = {
    hash,
    files: entries,
    idf,
    chunks,
    embeddingsReady: false,
    queryCache: new Map(),
  };
  indexCache.set(appId, index);
  return index;
}

// ── TF-IDF ranking (fast fallback) ───────────────────────────────────────────

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

  if (maxScore > 0) {
    for (const [path, s] of scores) {
      scores.set(path, (s / maxScore) * 100);
    }
  }

  return scores;
}

// ── Vector embedding pipeline ─────────────────────────────────────────────────

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

/**
 * Embed all chunks in the index using Ollama.
 * Processes in batches to avoid overloading the API.
 */
export async function embedChunks(
  appId: string,
  files: Record<string, string>,
  model: string,
): Promise<void> {
  const index = getOrBuildIndex(appId, files);
  if (index.embeddingsReady) return;

  const toEmbed = index.chunks.filter((c) => !c.embedding);
  if (toEmbed.length === 0) { index.embeddingsReady = true; return; }

  // Process in batches
  for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
    const inputs = batch.map((c) => c.text);
    try {
      const result = await window.deyad.embed(model, inputs);
      if (result.embeddings.length === batch.length) {
        for (let j = 0; j < batch.length; j++) {
          batch[j].embedding = result.embeddings[j];
        }
      }
    } catch {
      // Partial failure is OK — chunks without embeddings are skipped
      break;
    }
  }

  index.embeddingsReady = index.chunks.some((c) => c.embedding);
}

/**
 * RAG retrieval: find the top-k most relevant chunks for a query.
 * Returns chunks with their similarity scores, sorted by relevance.
 */
export async function retrieveChunks(
  appId: string,
  files: Record<string, string>,
  query: string,
  model: string,
  topK = 15,
): Promise<Array<{ chunk: Chunk; score: number }>> {
  const index = getOrBuildIndex(appId, files);
  if (!index.embeddingsReady || index.chunks.every((c) => !c.embedding)) {
    return [];
  }

  // Get or compute query embedding (cached)
  let queryVec = index.queryCache.get(query);
  if (!queryVec) {
    try {
      const result = await window.deyad.embed(model, query);
      if (result.embeddings[0]) {
        queryVec = result.embeddings[0];
        // Keep cache small
        if (index.queryCache.size > 50) index.queryCache.clear();
        index.queryCache.set(query, queryVec);
      }
    } catch {
      return [];
    }
  }
  if (!queryVec) return [];

  // Score all embedded chunks
  const scored: Array<{ chunk: Chunk; score: number }> = [];
  for (const chunk of index.chunks) {
    if (!chunk.embedding) continue;
    const sim = cosineSimilarity(queryVec, chunk.embedding);
    if (sim > 0.3) { // threshold to filter noise
      scored.push({ chunk, score: sim });
    }
  }

  // Sort by score descending, take topK
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate: if multiple chunks from the same file are adjacent, merge
  const seen = new Map<string, number>(); // path → count
  const results: Array<{ chunk: Chunk; score: number }> = [];
  for (const item of scored) {
    const count = seen.get(item.chunk.path) || 0;
    if (count >= 3) continue; // max 3 chunks per file
    seen.set(item.chunk.path, count + 1);
    results.push(item);
    if (results.length >= topK) break;
  }

  return results;
}

/**
 * Rank files by semantic similarity (aggregated chunk scores).
 * Returns a map of filePath → relevance score (0–100).
 */
export async function rankFilesBySemantic(
  appId: string,
  files: Record<string, string>,
  query: string,
  model: string,
): Promise<Map<string, number>> {
  const chunks = await retrieveChunks(appId, files, query, model, 30);
  if (chunks.length === 0) return new Map();

  // Aggregate scores by file
  const fileScores = new Map<string, number>();
  for (const { chunk, score } of chunks) {
    const current = fileScores.get(chunk.path) || 0;
    fileScores.set(chunk.path, current + score);
  }

  // Normalize to 0–100
  let maxScore = 0;
  for (const s of fileScores.values()) {
    if (s > maxScore) maxScore = s;
  }
  if (maxScore > 0) {
    for (const [path, s] of fileScores) {
      fileScores.set(path, (s / maxScore) * 100);
    }
  }

  return fileScores;
}

/** Clear the cached index for a project. */
export function clearIndex(appId: string): void {
  indexCache.delete(appId);
}
