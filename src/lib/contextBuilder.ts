/**
 * Smart context builder for large codebases.
 *
 * Instead of naively slicing the first N files, this module:
 * 1. Prioritizes files the user is currently viewing/editing
 * 2. Ranks files by relevance to the user's message
 * 3. Provides file summaries (path + first few lines) for files that don't fit
 * 4. Respects a total token budget
 */

import { getOrBuildIndex, rankFilesByQuery } from './codebaseIndexer';

/** Approximate tokens per character (conservative estimate for code). */
const CHARS_PER_TOKEN = 3.5;

/** Maximum total characters to include as context (≈ 8k tokens). */
const MAX_CONTEXT_CHARS = 60_000;

/** Maximum characters for a single file in full-content mode. */
const MAX_FILE_CHARS = 8_000;

/** Maximum files to include with full content. */
const MAX_FULL_FILES = 25;

/** Maximum files to include as summaries (path + first lines). */
const MAX_SUMMARY_FILES = 40;

/** Lines to include in a file summary. */
const SUMMARY_LINES = 5;

export interface ContextOptions {
  /** All project files. */
  files: Record<string, string>;
  /** The file currently open in the editor (highest priority). */
  selectedFile?: string | null;
  /** The user's current message (used for keyword matching). */
  userMessage?: string;
  /** App ID for TF-IDF index lookup. */
  appId?: string;
}

interface ScoredFile {
  path: string;
  content: string;
  score: number;
}

/**
 * Scores a file based on relevance to the user's message and editing context.
 */
function scoreFile(
  filePath: string,
  content: string,
  selectedFile: string | null | undefined,
  keywords: string[],
): number {
  let score = 0;

  // Currently selected file gets highest priority
  if (selectedFile && filePath === selectedFile) score += 100;

  // Entry points and key files
  const keyFiles = ['App.tsx', 'App.jsx', 'index.ts', 'index.tsx', 'index.js', 'main.tsx', 'main.ts'];
  const fileName = filePath.split('/').pop() || '';
  if (keyFiles.includes(fileName)) score += 20;

  // Schema / config files are important for full-stack
  if (filePath.includes('schema.prisma')) score += 25;
  if (filePath.includes('routes') || filePath.includes('api')) score += 15;
  if (fileName === 'package.json') score += 10;

  // Source files over config/generated files
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) score += 5;
  if (filePath.endsWith('.css')) score += 3;

  // Penalize large generated/config files
  if (filePath.includes('node_modules')) score -= 100;
  if (filePath.includes('.lock') || filePath.includes('lock.')) score -= 50;
  if (filePath.endsWith('.map')) score -= 50;

  // Keyword matching: boost files that mention terms from the user's message
  if (keywords.length > 0) {
    const lowerContent = content.toLowerCase();
    const lowerPath = filePath.toLowerCase();
    for (const kw of keywords) {
      if (lowerPath.includes(kw)) score += 15;
      // Check content for keyword matches (sample first 2000 chars for speed)
      if (lowerContent.slice(0, 2000).includes(kw)) score += 8;
    }
  }

  // Smaller files are easier to include fully
  if (content.length < 500) score += 3;
  if (content.length > 5000) score -= 2;

  return score;
}

/**
 * Extracts meaningful keywords from the user's message for relevance matching.
 */
function extractKeywords(message: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
    'about', 'up', 'out', 'it', 'its', 'this', 'that', 'these', 'those',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
    'them', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
    'add', 'create', 'make', 'build', 'update', 'change', 'modify',
    'please', 'want', 'need', 'like', 'app', 'file', 'code', 'page',
  ]);

  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Builds an optimized context string for the AI, prioritizing relevant files
 * and providing summaries for the rest.
 */
export function buildSmartContext(options: ContextOptions): string {
  const { files, selectedFile, userMessage, appId } = options;
  const entries = Object.entries(files);

  if (entries.length === 0) return '';

  const keywords = userMessage ? extractKeywords(userMessage) : [];

  // Build TF-IDF relevance scores if we have a query
  let tfidfScores = new Map<string, number>();
  if (userMessage && appId) {
    const index = getOrBuildIndex(appId, files);
    tfidfScores = rankFilesByQuery(index, userMessage);
  }

  // Score and sort all files
  const scored: ScoredFile[] = entries
    .map(([path, content]) => {
      let score = scoreFile(path, content, selectedFile, keywords);
      // Blend in TF-IDF score (up to +30 boost)
      const tfidf = tfidfScores.get(path) || 0;
      score += tfidf * 0.3;
      return { path, content, score };
    })
    .sort((a, b) => b.score - a.score);

  const parts: string[] = [];
  let totalChars = 0;
  let fullCount = 0;
  const includedFull = new Set<string>();

  // Phase 1: Include top-priority files with full content
  for (const file of scored) {
    if (fullCount >= MAX_FULL_FILES) break;
    if (totalChars >= MAX_CONTEXT_CHARS) break;

    const truncated = file.content.slice(0, MAX_FILE_CHARS);
    const wasTruncated = file.content.length > MAX_FILE_CHARS;
    const entry = `### FILE: ${file.path}\n\`\`\`\n${truncated}${wasTruncated ? '\n... (truncated)' : ''}\n\`\`\``;

    if (totalChars + entry.length > MAX_CONTEXT_CHARS && fullCount > 0) break;

    parts.push(entry);
    totalChars += entry.length;
    fullCount++;
    includedFull.add(file.path);
  }

  // Phase 2: Include remaining files as summaries (path + first N lines)
  const remaining = scored.filter((f) => !includedFull.has(f.path));
  if (remaining.length > 0) {
    const summaries: string[] = [];
    let summaryCount = 0;

    for (const file of remaining) {
      if (summaryCount >= MAX_SUMMARY_FILES) break;
      const firstLines = file.content.split('\n').slice(0, SUMMARY_LINES).join('\n');
      summaries.push(`- \`${file.path}\` (${file.content.length} chars): ${firstLines.slice(0, 120)}…`);
      summaryCount++;
    }

    if (summaries.length > 0) {
      parts.push(`\n### Other project files (${remaining.length} files, summaries only):\n${summaries.join('\n')}`);
    }
  }

  // Add file count header
  const header = `**Project: ${entries.length} files total, ${fullCount} shown in full, ${Math.min(remaining.length, MAX_SUMMARY_FILES)} summarized.**\n`;

  return header + '\n' + parts.join('\n\n');
}

/**
 * Returns stats about the project for display in the UI.
 */
export function getProjectStats(files: Record<string, string>): {
  fileCount: number;
  totalLines: number;
  totalChars: number;
  languages: string[];
} {
  const entries = Object.entries(files);
  let totalLines = 0;
  let totalChars = 0;
  const langSet = new Set<string>();

  for (const [path, content] of entries) {
    totalLines += content.split('\n').length;
    totalChars += content.length;
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext) {
      if (['ts', 'tsx'].includes(ext)) langSet.add('TypeScript');
      else if (['js', 'jsx', 'mjs'].includes(ext)) langSet.add('JavaScript');
      else if (ext === 'css') langSet.add('CSS');
      else if (ext === 'html') langSet.add('HTML');
      else if (ext === 'json') langSet.add('JSON');
      else if (ext === 'prisma') langSet.add('Prisma');
      else if (['yml', 'yaml'].includes(ext)) langSet.add('YAML');
      else if (ext === 'md') langSet.add('Markdown');
    }
  }

  return {
    fileCount: entries.length,
    totalLines,
    totalChars,
    languages: [...langSet],
  };
}
