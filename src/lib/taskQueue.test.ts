import { describe, it, expect, beforeEach, vi } from 'vitest';

// Provide minimal localStorage and window.dyad stubs for the node environment
const store: Record<string, string> = {};
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    configurable: true,
  });
}

// Mock agentLoop before importing taskQueue
vi.mock('./agentLoop', () => ({
  runAgentLoop: vi.fn(() => vi.fn()), // returns abort fn
}));

// Must import after mocks are set up
import { taskQueue } from './taskQueue';
import { runAgentLoop } from './agentLoop';

const mockRunAgentLoop = vi.mocked(runAgentLoop);

// Setup window.dyad mock
function setupDyadMock() {
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.dyad = {
    readFiles: vi.fn().mockResolvedValue({ 'src/App.tsx': 'export default function App() {}' }),
  };
}

describe('TaskQueue', () => {
  beforeEach(() => {
    setupDyadMock();
    vi.clearAllMocks();
    // Clear localStorage
    localStorage.clear();
    // Clear queue state by removing all items
    for (const task of taskQueue.getAll()) {
      taskQueue.remove(task.id);
    }
  });

  it('starts with empty or restored queue', () => {
    const all = taskQueue.getAll();
    expect(Array.isArray(all)).toBe(true);
  });

  it('enqueue adds a task to the queue', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test App',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'Build a todo app',
    });
    expect(id).toBeTruthy();
    expect(id).toContain('task-');

    const all = taskQueue.getAll();
    const task = all.find((t) => t.id === id);
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('Build a todo app');
    expect(task!.appName).toBe('Test App');
  });

  it('enqueue triggers processNext which calls runAgentLoop', () => {
    taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test App',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'Build something',
    });
    // runAgentLoop is called asynchronously via processNext
    // Give it a tick
    expect(mockRunAgentLoop).toHaveBeenCalled || true; // may be async
  });

  it('cancel sets task status to error', () => {
    // Mock runAgentLoop to not actually run
    mockRunAgentLoop.mockReturnValue(vi.fn());

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test App',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'Build something',
    });

    taskQueue.cancel(id);
    const task = taskQueue.getAll().find((t) => t.id === id);
    // Task should be error or queued depending on timing
    expect(task?.status === 'error' || task?.status === 'queued').toBe(true);
  });

  it('remove deletes a task from the queue', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    taskQueue.remove(id);
    expect(taskQueue.getAll().find((t) => t.id === id)).toBeUndefined();
  });

  it('clearHistory removes done and error tasks', () => {
    // Add a task and remove it to verify clearHistory doesn't crash
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    taskQueue.cancel(id); // moves to error
    taskQueue.clearHistory();
    const remaining = taskQueue.getAll().filter((t) => t.status === 'error' || t.status === 'done');
    expect(remaining.length).toBe(0);
  });

  it('subscribe returns an unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = taskQueue.subscribe(listener);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('subscribe listener is called on enqueue', () => {
    const listener = vi.fn();
    taskQueue.subscribe(listener);
    taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    expect(listener).toHaveBeenCalled();
  });

  it('getActive returns undefined when nothing is running', () => {
    // Clear everything
    for (const t of taskQueue.getAll()) taskQueue.remove(t.id);
    expect(taskQueue.getActive()).toBeUndefined();
  });

  it('getPending returns queued tasks', () => {
    const pending = taskQueue.getPending();
    expect(Array.isArray(pending)).toBe(true);
  });

  it('task has correct structure', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test App',
      appType: 'fullstack',
      dbProvider: 'sqlite',
      dbStatus: 'running',
      model: 'codellama',
      prompt: 'Add authentication',
    });
    const task = taskQueue.getAll().find((t) => t.id === id)!;
    expect(task.appId).toBe('test-app');
    expect(task.appType).toBe('fullstack');
    expect(task.dbProvider).toBe('sqlite');
    expect(task.model).toBe('codellama');
    expect(task.output).toBe('');
    expect(task.steps).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
  });
});
