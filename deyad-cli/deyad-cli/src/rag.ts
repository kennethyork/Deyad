/**
 * RAG (Retrieval-Augmented Generation) — codebase indexing with BM25 scoring.
 * Chunks source files, indexes them, and retrieves relevant context for queries.
 * No external dependencies — pure TypeScript BM25 implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { walkDir } from './tools.js';

// ── Types ──

export interface CodeChunk {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: string[];
}

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}

export interface CodebaseIndex {
  chunks: CodeChunk[];
  docFreq: Map<string, number>; // token → number of chunks containing it
  avgDocLen: number;
  totalDocs: number;
  indexedAt: number;
  fileCount: number;
}

// ── Tokenizer ──

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'not', 'no', 'nor', 'if', 'then', 'else',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

function tokenize(text: string): string[] {
  // Split on non-alphanumeric, camelCase boundaries, underscores
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTMLParser → HTML Parser
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

// ── Chunking ──

const CHUNK_SIZE = 40; // lines per chunk
const CHUNK_OVERLAP = 10; // overlap between chunks
const MAX_FILE_SIZE = 100_000; // skip files larger than 100KB
const MAX_FILES = 500; // limit indexing to 500 files

function chunkFile(filePath: string, cwd: string): CodeChunk[] {
  const absPath = path.resolve(cwd, filePath);
  let content: string;
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE) return [];
    content = fs.readFileSync(absPath, 'utf-8');
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error(`[rag] chunkFile ${filePath}:`, err);
    return [];
  }

  const lines = content.split('\n');
  const chunks: CodeChunk[] = [];

  if (lines.length <= CHUNK_SIZE) {
    // Small file — single chunk
    const tokens = tokenize(content);
    if (tokens.length > 0) {
      chunks.push({
        file: filePath,
        startLine: 1,
        endLine: lines.length,
        content,
        tokens,
      });
    }
    return chunks;
  }

  // Sliding window with overlap
  for (let start = 0; start < lines.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const chunkContent = lines.slice(start, end).join('\n');
    const tokens = tokenize(chunkContent);
    if (tokens.length > 0) {
      chunks.push({
        file: filePath,
        startLine: start + 1,
        endLine: end,
        content: chunkContent,
        tokens,
      });
    }
    if (end >= lines.length) break;
  }

  return chunks;
}

// ── Indexing ──

let cachedIndex: CodebaseIndex | null = null;
let cachedCwd: string | null = null;

/**
 * Build or return cached BM25 index of the codebase.
 */
export function buildIndex(cwd: string, force = false): CodebaseIndex {
  // Return cached if fresh (< 60s old) and same directory
  if (
    !force &&
    cachedIndex &&
    cachedCwd === cwd &&
    Date.now() - cachedIndex.indexedAt < 60_000
  ) {
    return cachedIndex;
  }

  const files = walkDir(cwd, cwd).slice(0, MAX_FILES);
  const allChunks: CodeChunk[] = [];

  for (const file of files) {
    const chunks = chunkFile(file, cwd);
    allChunks.push(...chunks);
  }

  // Build document frequency map
  const docFreq = new Map<string, number>();
  for (const chunk of allChunks) {
    const uniqueTokens = new Set(chunk.tokens);
    for (const token of uniqueTokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const avgDocLen = allChunks.length > 0
    ? allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / allChunks.length
    : 0;

  const index: CodebaseIndex = {
    chunks: allChunks,
    docFreq,
    avgDocLen,
    totalDocs: allChunks.length,
    indexedAt: Date.now(),
    fileCount: files.length,
  };

  cachedIndex = index;
  cachedCwd = cwd;
  return index;
}

// ── BM25 Search ──

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function bm25Score(
  queryTokens: string[],
  chunk: CodeChunk,
  index: CodebaseIndex,
): number {
  let score = 0;
  const docLen = chunk.tokens.length;
  const termFreqs = new Map<string, number>();

  for (const token of chunk.tokens) {
    termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
  }

  for (const qt of queryTokens) {
    const df = index.docFreq.get(qt) || 0;
    if (df === 0) continue;

    const tf = termFreqs.get(qt) || 0;
    if (tf === 0) continue;

    // IDF component
    const idf = Math.log((index.totalDocs - df + 0.5) / (df + 0.5) + 1);

    // TF component with length normalization
    const tfNorm = (tf * (BM25_K1 + 1)) /
      (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / index.avgDocLen)));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * Search the codebase index for chunks relevant to the query.
 */
export function queryIndex(
  query: string,
  cwd: string,
  topK = 5,
): SearchResult[] {
  const index = buildIndex(cwd);
  if (index.chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored: SearchResult[] = index.chunks.map((chunk) => ({
    chunk,
    score: bm25Score(queryTokens, chunk, index),
  }));

  // Sort by score descending, take top K
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((r) => r.score > 0)
    .slice(0, topK);
}

/**
 * Format search results into context for the agent.
 */
export function formatRAGContext(results: SearchResult[]): string {
  if (results.length === 0) return '';

  const parts = results.map((r, i) => {
    const loc = `${r.chunk.file}:${r.chunk.startLine}-${r.chunk.endLine}`;
    // Truncate very long chunks  
    const content = r.chunk.content.length > 1500
      ? r.chunk.content.slice(0, 1500) + '\n...'
      : r.chunk.content;
    return `[${i + 1}] ${loc} (score: ${r.score.toFixed(2)})\n${content}`;
  });

  return `\n--- Relevant codebase context (RAG) ---\n${parts.join('\n\n')}\n--- End RAG context ---\n`;
}

/**
 * Get index stats for display.
 */
export function getIndexStats(cwd: string): { files: number; chunks: number; age: string } | null {
  if (!cachedIndex || cachedCwd !== cwd) return null;
  const ageMs = Date.now() - cachedIndex.indexedAt;
  const ageSec = Math.round(ageMs / 1000);
  const age = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;
  return {
    files: cachedIndex.fileCount,
    chunks: cachedIndex.totalDocs,
    age,
  };
}

/**
 * Invalidate the cached index (e.g., after files change).
 */
export function invalidateIndex(): void {
  cachedIndex = null;
  cachedCwd = null;
}
