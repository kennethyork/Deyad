/// <reference path="./minimatch.d.ts" />
/**
 * Tool utilities — file walking, globbing, fuzzy matching, diff generation.
 *
 * Extracted from tools.ts for modularity.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

// ── Fuzzy edit matching ───────────────────────────────────────────────────────

/** Minimum similarity ratio (0–1) for fuzzy matching. */
const FUZZY_THRESHOLD = 0.6;

/**
 * Compute line-level similarity between two strings (Dice coefficient on trimmed lines).
 */
function lineSimilarity(a: string, b: string): number {
  const aLines = a.split('\n').map(l => l.trim()).filter(Boolean);
  const bLines = b.split('\n').map(l => l.trim()).filter(Boolean);
  if (aLines.length === 0 && bLines.length === 0) return 1;
  if (aLines.length === 0 || bLines.length === 0) return 0;
  const bSet = new Set(bLines);
  let matches = 0;
  for (const line of aLines) {
    if (bSet.has(line)) matches++;
  }
  return (2 * matches) / (aLines.length + bLines.length);
}

/**
 * Try to find the best fuzzy-matching block in `content` for `needle`.
 * Uses a sliding window of ±2 lines around the needle size.
 * Returns { text, similarity } or null if nothing meets the threshold.
 */
export function fuzzyFindBlock(content: string, needle: string): { text: string; similarity: number } | null {
  const contentLines = content.split('\n');
  const needleLines = needle.split('\n');
  const needleLen = needleLines.length;
  if (needleLen === 0 || contentLines.length === 0) return null;

  // For single-line needles, try trimmed matching first
  if (needleLen === 1) {
    const trimmed = needle.trim();
    if (!trimmed) return null;
    const candidates: Array<{ text: string; similarity: number }> = [];
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]!;
      if (line.trim() === trimmed) {
        candidates.push({ text: line, similarity: 1.0 });
      }
    }
    // Only return if exactly one match (must be unique)
    if (candidates.length === 1) return candidates[0]!;
    return null;
  }

  let best: { text: string; similarity: number; start: number } | null = null;

  // Slide window of sizes [needleLen-2 .. needleLen+2]
  const minWin = Math.max(1, needleLen - 2);
  const maxWin = Math.min(contentLines.length, needleLen + 2);

  for (let winSize = minWin; winSize <= maxWin; winSize++) {
    for (let start = 0; start <= contentLines.length - winSize; start++) {
      const block = contentLines.slice(start, start + winSize).join('\n');
      const sim = lineSimilarity(needle, block);
      if (sim >= FUZZY_THRESHOLD && (!best || sim > best.similarity)) {
        best = { text: block, similarity: sim, start };
      }
    }
  }

  if (!best) return null;

  // Ensure uniqueness — check no other block scores equally high
  let secondBest = 0;
  for (let winSize = minWin; winSize <= maxWin; winSize++) {
    for (let start = 0; start <= contentLines.length - winSize; start++) {
      if (best && Math.abs(start - best.start) < needleLen) continue; // skip overlap
      const block = contentLines.slice(start, start + winSize).join('\n');
      const sim = lineSimilarity(needle, block);
      if (sim > secondBest) secondBest = sim;
    }
  }

  // If the second-best is too close, the match isn't unique enough
  if (secondBest >= best.similarity * 0.95) return null;

  return { text: best.text, similarity: best.similarity };
}

export function simpleDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const hunks: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      removed.push(oldLines[i]!);
      i++;
    }
    while (j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i])) {
      added.push(newLines[j]!);
      j++;
    }
    for (const line of removed) hunks.push(`-${line}`);
    for (const line of added) hunks.push(`+${line}`);
  }
  return hunks.join('\n');
}

// ── Directory walking ─────────────────────────────────────────────────────────

const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', '.tox', 'target', '.gradle', 'vendor',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.zip',
  '.tar', '.gz', '.lock', '.pyc', '.class', '.o', '.so', '.dll',
]);

function parseGitignore(dir: string): string[] {
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  try {
    return fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function isGitignored(relPath: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (pat.startsWith('!')) continue;
    const p = pat.endsWith('/') ? `${pat}**` : pat;
    if (minimatch(relPath, p, { dot: true }) || minimatch(`**/${relPath}`, p, { dot: true })) {
      return true;
    }
  }
  return false;
}

export function walkDir(dir: string, root: string, results: string[] = [], gitignorePatterns?: string[]): string[] {
  if (!gitignorePatterns) {
    gitignorePatterns = parseGitignore(root);
  }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.gitignore') continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (isGitignored(rel, gitignorePatterns)) continue;
    if (entry.isDirectory()) {
      walkDir(full, root, results, gitignorePatterns);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      results.push(rel);
    }
  }
  return results;
}

export function globFiles(pattern: string, cwd: string): string[] {
  const allFiles = walkDir(cwd, cwd);
  return allFiles.filter((file) => minimatch(file, pattern, { dot: true }));
}
