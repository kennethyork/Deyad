/**
 * Background autonomous task queue.
 *
 * Runs agent tasks sequentially in the background, persisting the queue
 * so tasks survive panel switches. Provides callbacks for progress and
 * completion notifications.
 */

import { runAgentLoop } from './agentLoop';
import type { AgentCallbacks } from './agentLoop';
import { stripToolMarkup } from './agentTools';
import type { ToolResult } from './agentTools';

export interface TaskQueueItem {
  id: string;
  appId: string;
  appName: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'sqlite';
  dbStatus: 'none' | 'running' | 'stopped';
  model: string;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'error';
  output: string;
  steps: Array<{ type: 'tool' | 'result'; text: string }>;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

type Listener = () => void;
type FilesChangedCallback = (appId: string) => void;

const STORAGE_KEY = 'deyad-task-queue';
const MAX_HISTORY = 50;

class TaskQueue {
  private queue: TaskQueueItem[] = [];
  private listeners: Set<Listener> = new Set();
  private running = false;
  private abortCurrent: (() => void) | null = null;
  private onFilesChanged: FilesChangedCallback | null = null;

  constructor() {
    this.load();
    // Reset any tasks that were "running" (interrupted by restart) back to queued
    for (const t of this.queue) {
      if (t.status === 'running') t.status = 'queued';
    }
    // Defer auto-resume until the Electron bridge is ready (window.deyad)
    // On fresh load, processNext() needs window.deyad.readFiles which isn't
    // available until the preload bridge mounts.
    const hasQueued = this.queue.some((t) => t.status === 'queued');
    if (hasQueued) {
      const tryResume = () => {
        if (typeof window !== 'undefined' && window.deyad) {
          this.processNext();
        } else {
          setTimeout(tryResume, 500);
        }
      };
      // Use requestIdleCallback if available, otherwise setTimeout
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => tryResume());
      } else {
        setTimeout(tryResume, 500);
      }
    }
    this.save();
  }

  /** Subscribe to queue changes. Returns unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Register a callback invoked when a task finishes and files may have changed. */
  setOnFilesChanged(fn: FilesChangedCallback | null) {
    this.onFilesChanged = fn;
  }

  private notify() {
    this.save();
    for (const fn of this.listeners) fn();
  }

  private save() {
    try {
      // Only persist essential data, not huge outputs
      const serializable = this.queue.map((t) => ({
        ...t,
        output: t.output.length > 2000 ? t.output.slice(-2000) : t.output,
        steps: t.steps.slice(-30),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (err) { console.debug('storage full — ignore:', err); }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.queue = JSON.parse(raw);
      }
    } catch (err) {
      console.debug('Handled error:', err);
      this.queue = [];
    }
  }

  getAll(): TaskQueueItem[] {
    return [...this.queue];
  }

  getActive(): TaskQueueItem | undefined {
    return this.queue.find((t) => t.status === 'running');
  }

  getPending(): TaskQueueItem[] {
    return this.queue.filter((t) => t.status === 'queued');
  }

  /** Add a new task to the queue. */
  enqueue(opts: {
    appId: string;
    appName: string;
    appType: 'frontend' | 'fullstack';
    dbProvider?: 'sqlite';
    dbStatus: 'none' | 'running' | 'stopped';
    model: string;
    prompt: string;
  }): string {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: TaskQueueItem = {
      id,
      ...opts,
      status: 'queued',
      output: '',
      steps: [],
      createdAt: Date.now(),
    };
    this.queue.push(task);
    this.notify();
    if (!this.running) this.processNext();
    return id;
  }

  /** Cancel a queued or running task. */
  cancel(taskId: string) {
    const task = this.queue.find((t) => t.id === taskId);
    if (!task) return;
    if (task.status === 'running' && this.abortCurrent) {
      this.abortCurrent();
      this.abortCurrent = null;
    }
    if (task.status === 'queued' || task.status === 'running') {
      task.status = 'error';
      task.error = 'Cancelled by user';
      task.finishedAt = Date.now();
      this.notify();
    }
  }

  /** Remove a completed/errored task from history. */
  remove(taskId: string) {
    this.queue = this.queue.filter((t) => t.id !== taskId);
    this.notify();
  }

  /** Clear all completed/errored tasks. */
  clearHistory() {
    this.queue = this.queue.filter((t) => t.status === 'queued' || t.status === 'running');
    this.notify();
  }

  private async processNext() {
    const next = this.queue.find((t) => t.status === 'queued');
    if (!next || this.running) return;

    this.running = true;
    next.status = 'running';
    this.notify();

    try {
      // Get current files for context
      const appFiles = await window.deyad.readFiles(next.appId);

      const callbacks: AgentCallbacks = {
        onContent: (text: string) => {
          next.output = stripToolMarkup(text);
          this.notify();
        },
        onToolStart: (toolName: string, params: Record<string, string>) => {
          const summary = toolName === 'run_command' ? `${toolName}: ${params.command ?? ''}` :
                          toolName === 'read_file' ? `${toolName}: ${params.path ?? ''}` :
                          toolName;
          next.steps.push({ type: 'tool', text: summary });
          this.notify();
        },
        onToolResult: (result: ToolResult) => {
          const icon = result.success ? '\u2713' : '\u2717';
          const preview = result.output.length > 80 ? result.output.slice(0, 80) + '...' : result.output;
          next.steps.push({ type: 'result', text: `${icon} ${result.tool}: ${preview}` });
          this.notify();
        },
        onFilesWritten: async () => {
          // No-op for background — files are written directly by agentTools
        },
        onDone: () => {
          next.status = 'done';
          next.finishedAt = Date.now();
          this.running = false;
          this.abortCurrent = null;
          this.trimHistory();
          this.notify();
          if (this.onFilesChanged) this.onFilesChanged(next.appId);
          this.processNext();
        },
        onError: (error: string) => {
          next.status = 'error';
          next.error = error;
          next.finishedAt = Date.now();
          this.running = false;
          this.abortCurrent = null;
          this.notify();
          this.processNext();
        },
      };

      this.abortCurrent = runAgentLoop({
        appId: next.appId,
        appType: next.appType,
        dbProvider: next.dbProvider,
        dbStatus: next.dbStatus,
        model: next.model,
        userMessage: next.prompt,
        appFiles,
        history: [],
        callbacks,
      });
    } catch (err) {
      next.status = 'error';
      next.error = err instanceof Error ? err.message : String(err);
      next.finishedAt = Date.now();
      this.running = false;
      this.abortCurrent = null;
      this.notify();
      this.processNext();
    }
  }

  private trimHistory() {
    const done = this.queue.filter((t) => t.status === 'done' || t.status === 'error');
    if (done.length > MAX_HISTORY) {
      const toRemove = done.slice(0, done.length - MAX_HISTORY).map((t) => t.id);
      this.queue = this.queue.filter((t) => !toRemove.includes(t.id));
    }
  }
}

// Singleton — shared across all components
export const taskQueue = new TaskQueue();
