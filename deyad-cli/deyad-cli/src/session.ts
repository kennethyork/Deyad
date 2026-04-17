/**
 * Persistent session memory — save and restore conversation history across restarts.
 * Sessions stored in ~/.deyad/sessions/ as JSON files.
 * Uses atomic write (tmp + rename) and advisory file locking to prevent multi-instance corruption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { homedir } from 'node:os';
import type { OllamaMessage } from './ollama.js';
import { debugLog } from './debug.js';

const SESSIONS_DIR = path.join(homedir(), '.deyad', 'sessions');
const MEMORY_DIR = path.join(homedir(), '.deyad', 'memory');
const MAX_SESSIONS = 50;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

export interface SessionData {
  id: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  history: OllamaMessage[];
  /** Full uncompacted history — never loses detail. Used for session recovery. */
  fullHistory?: OllamaMessage[];
  totalTokens: number;
  taskCount: number;
}

export interface MemoryEntry {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Acquire an advisory file lock. Uses mkdir (atomic on POSIX) as a lock mechanism.
 * Returns true if lock acquired, false if timed out.
 */
function acquireLock(filePath: string): boolean {
  const lockPath = filePath + '.lock';
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath);
      // Write PID so stale locks can be detected
      fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid), 'utf-8');
      return true;
    } catch (e) {
      debugLog('lock contention on %s: %s', path.basename(filePath), (e as Error).message);
      // Lock exists — check if stale
      try {
        const pidFile = path.join(lockPath, 'pid');
        if (fs.existsSync(pidFile)) {
          const stat = fs.statSync(pidFile);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            // Stale lock — force remove and retry
            releaseLock(filePath);
            continue;
          }
        }
      } catch (e) { debugLog('session', 'lock stat failed', e); }

      // Wait 50ms before retrying (spinhalt avoids busy-wait via Atomics on shared buffer)
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } catch (e) { debugLog('session', 'Atomics.wait fallback', e); const s = Date.now(); while (Date.now() - s < 50) { /* fallback */ } }
    }
  }
  return false;
}

/**
 * Release an advisory file lock.
 */
function releaseLock(filePath: string): void {
  const lockPath = filePath + '.lock';
  try {
    const pidFile = path.join(lockPath, 'pid');
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    fs.rmdirSync(lockPath);
  } catch (e) { debugLog('session', 'releaseLock failed', e); }
}

/**
 * Recover a corrupt session from its backup file.
 * Returns the recovered session or null if unrecoverable.
 */
export function recoverSession(filePath: string): SessionData | null {
  const backupPath = filePath + '.bak';
  try {
    if (!fs.existsSync(backupPath)) return null;
    const raw = fs.readFileSync(backupPath, 'utf-8');
    const data = JSON.parse(raw) as SessionData;
    // Restore main file from backup
    fs.writeFileSync(filePath, raw, 'utf-8');
    if (process.env['DEYAD_DEBUG']) {
      console.error('[session] recovered from backup:', path.basename(filePath));
    }
    return data;
  } catch (e) {
    debugLog('session recovery failed for %s: %s', path.basename(filePath), (e as Error).message);
    return null;
  }
}

function generateId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${rand}`;
}

/**
 * Create a new session or load the most recent one for the given cwd.
 */
export function loadOrCreateSession(cwd: string, model: string): SessionData {
  ensureDir(SESSIONS_DIR);

  // Try to find the most recent session for this cwd
  const sessions = listSessions();
  const recent = sessions.find((s) => s.cwd === cwd);
  if (recent) {
    return recent;
  }

  // Create new session
  const session: SessionData = {
    id: generateId(),
    model,
    cwd,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    totalTokens: 0,
    taskCount: 0,
  };
  saveSession(session);
  return session;
}

export function saveSession(session: SessionData): void {
  ensureDir(SESSIONS_DIR);
  session.updatedAt = new Date().toISOString();
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  const tmpPath = filePath + '.tmp';
  const backupPath = filePath + '.bak';

  if (!acquireLock(filePath)) {
    // Timeout — fall back to direct write rather than losing data
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    return;
  }
  try {
    // Create backup of existing file before overwriting
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, backupPath); } catch (e) { debugLog('session', 'backup copy failed', e); }
    }
    fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch (e) { debugLog('session', 'tmp cleanup failed', e); }
    throw err;
  } finally {
    releaseLock(filePath);
  }
}

export function listSessions(): SessionData[] {
  ensureDir(SESSIONS_DIR);
  try {
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // newest first

    const sessions: SessionData[] = [];
    for (const file of files.slice(0, MAX_SESSIONS)) {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        sessions.push(data);
      } catch (err) {
        // Corrupt session — attempt recovery from backup
        const filePath = path.join(SESSIONS_DIR, file);
        const recovered = recoverSession(filePath);
        if (recovered) {
          sessions.push(recovered);
        } else if (process.env['DEYAD_DEBUG']) {
          console.error('[session] corrupt file (unrecoverable):', file, err);
        }
      }
    }
    return sessions;
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[session] listSessions:', err);
    return [];
  }
}

export function deleteSession(id: string): boolean {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Prune old sessions beyond MAX_SESSIONS.
 */
export function pruneSessions(): number {
  ensureDir(SESSIONS_DIR);
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  let pruned = 0;
  for (const file of files.slice(MAX_SESSIONS)) {
    try {
      fs.unlinkSync(path.join(SESSIONS_DIR, file));
      pruned++;
    } catch (e) { debugLog('session', 'prune unlink failed', e); }
  }
  return pruned;
}

// ── Persistent Memory (key-value notes across sessions) ──

/**
 * Machine-local obfuscation for memory values at rest.
 * Uses AES-256-CBC with a key derived from machine identity (hostname + user).
 * Not meant as strong encryption — prevents plaintext exposure of secrets in ~/.deyad/memory/.
 */
const OBFUSCATION_ALGO = 'aes-256-cbc';
function getObfuscationKey(): Buffer {
  const seed = `deyad:${require('node:os').hostname()}:${require('node:os').userInfo().username}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function obfuscate(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(OBFUSCATION_ALGO, getObfuscationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function deobfuscate(encoded: string): string {
  const sep = encoded.indexOf(':');
  if (sep === -1) return encoded; // legacy plaintext value
  const iv = Buffer.from(encoded.slice(0, sep), 'hex');
  if (iv.length !== 16) return encoded; // not obfuscated
  try {
    const data = Buffer.from(encoded.slice(sep + 1), 'hex');
    const decipher = crypto.createDecipheriv(OBFUSCATION_ALGO, getObfuscationKey(), iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[session] deobfuscate:', err);
    return encoded; // fallback: return raw value (legacy or corrupted)
  }
}

export function memoryRead(key: string): string | null {
  ensureDir(MEMORY_DIR);
  const filePath = path.join(MEMORY_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const entry: MemoryEntry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return deobfuscate(entry.value);
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[session] memoryRead:', key, err);
    return null;
  }
}

export function memoryWrite(key: string, value: string): void {
  ensureDir(MEMORY_DIR);
  const sanitizedKey = sanitizeKey(key);
  const filePath = path.join(MEMORY_DIR, `${sanitizedKey}.json`);
  
  // Preserve original createdAt if file exists
  let existingCreatedAt: string | null = null;
  try {
    if (fs.existsSync(filePath)) {
      const prev: MemoryEntry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      existingCreatedAt = prev.createdAt;
    }
  } catch (e) { debugLog('memoryWrite read-prev failed for %s: %s', key, (e as Error).message); }
  
  const entry: MemoryEntry = {
    key,
    value: obfuscate(value),
    createdAt: existingCreatedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const tmpPath = filePath + '.tmp';
  if (!acquireLock(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    return;
  }
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (e) { debugLog('session', 'memory tmp cleanup failed', e); }
    throw err;
  } finally {
    releaseLock(filePath);
  }
}

export function memoryList(): MemoryEntry[] {
  ensureDir(MEMORY_DIR);
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, f), 'utf-8')) as MemoryEntry;
      } catch (err) {
        if (process.env['DEYAD_DEBUG']) console.error('[session] memoryList parse:', f, err);
        return null;
      }
    }).filter((e): e is MemoryEntry => e !== null);
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[session] memoryList:', err);
    return [];
  }
}

export function memoryDelete(key: string): boolean {
  const filePath = path.join(MEMORY_DIR, `${sanitizeKey(key)}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}
