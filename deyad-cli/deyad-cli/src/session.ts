/**
 * Persistent session memory — save and restore conversation history across restarts.
 * Sessions stored in ~/.deyad/sessions/ as JSON files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import type { OllamaMessage } from './ollama.js';

const SESSIONS_DIR = path.join(homedir(), '.deyad', 'sessions');
const MEMORY_DIR = path.join(homedir(), '.deyad', 'memory');
const MAX_SESSIONS = 50;

export interface SessionData {
  id: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  history: OllamaMessage[];
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
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
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
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8'));
        sessions.push(data);
      } catch { /* skip corrupt files */ }
    }
    return sessions;
  } catch {
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
    } catch { /* ignore */ }
  }
  return pruned;
}

// ── Persistent Memory (key-value notes across sessions) ──

export function memoryRead(key: string): string | null {
  ensureDir(MEMORY_DIR);
  const filePath = path.join(MEMORY_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const entry: MemoryEntry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return entry.value;
  } catch {
    return null;
  }
}

export function memoryWrite(key: string, value: string): void {
  ensureDir(MEMORY_DIR);
  const sanitizedKey = sanitizeKey(key);
  const filePath = path.join(MEMORY_DIR, `${sanitizedKey}.json`);
  const existing = memoryRead(key);
  
  const entry: MemoryEntry = {
    key,
    value,
    createdAt: existing ? new Date().toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
}

export function memoryList(): MemoryEntry[] {
  ensureDir(MEMORY_DIR);
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, f), 'utf-8')) as MemoryEntry;
      } catch {
        return null;
      }
    }).filter((e): e is MemoryEntry => e !== null);
  } catch {
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
