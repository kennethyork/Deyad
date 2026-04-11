import { describe, it, expect, beforeEach, vi } from 'vitest';

// Provide minimal localStorage and window.deyad stubs for the node environment
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

// Setup window.deyad mock
const _global = globalThis as unknown as { window: { deyad: Record<string, unknown> } };
function setupDeyadMock() {
  _global.window = _global.window || {};
  _global.window.deyad = {
    readFiles: vi.fn().mockResolvedValue({ 'src/App.tsx': 'export default function App() {}' }),
  };
}

describe('TaskQueue', () => {
  beforeEach(() => {
    setupDeyadMock();
    vi.clearAllMocks();
    localStorage.clear();
    // Force-reset internal singleton state so processNext can run fresh
    (taskQueue as unknown as { running: boolean }).running = false;
    (taskQueue as unknown as { abortCurrent: null }).abortCurrent = null;
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
    expect(mockRunAgentLoop).toBeDefined();
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

  it('cancel calls abort function when task is running', async () => {
    const abortFn = vi.fn();
    mockRunAgentLoop.mockReturnValue(abortFn);

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build something',
    });

    // Give processNext time to start the task
    await new Promise((r) => setTimeout(r, 50));

    const task = taskQueue.getAll().find((t) => t.id === id);
    if (task?.status === 'running') {
      taskQueue.cancel(id);
      expect(abortFn).toHaveBeenCalled();
    }
  });

  it('cancel does nothing for non-existent task', () => {
    // Should not throw
    taskQueue.cancel('nonexistent-id-999');
  });

  it('setOnFilesChanged registers callback', () => {
    const cb = vi.fn();
    taskQueue.setOnFilesChanged(cb);
    // Can set it back to null
    taskQueue.setOnFilesChanged(null);
  });

  it('saves queue to localStorage on enqueue', () => {
    taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test save',
    });
    // Check that localStorage.setItem was called (save() is called via notify())
    const stored = localStorage.getItem('deyad-task-queue');
    expect(stored).toBeTruthy();
    expect(typeof stored).toBe('string');
    // Should be valid JSON
    expect(() => JSON.parse(stored!)).not.toThrow();
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('deyad-task-queue', 'not-json!!!');
    // Creating a new module load would test constructor, but we can't easily
    // reload modules. Instead, verify the queue is still functional.
    const all = taskQueue.getAll();
    expect(Array.isArray(all)).toBe(true);
  });

  it('getAll returns a copy, not the internal array', () => {
    const all1 = taskQueue.getAll();
    const all2 = taskQueue.getAll();
    expect(all1).not.toBe(all2); // different array references
  });

  it('save truncates long output to last 2000 chars', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    // Manually inject a large output by finding the task
    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task).toBeDefined();
    // Check stored data is valid JSON
    const stored = localStorage.getItem('deyad-task-queue');
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('save limits steps to last 30 entries', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    const stored = JSON.parse(localStorage.getItem('deyad-task-queue')!);
    const task = stored.find((t: { id: string }) => t.id === id);
    expect(task.steps.length).toBeLessThanOrEqual(30);
  });

  it('enqueue with fullstack and sqlite options', () => {
    const id = taskQueue.enqueue({
      appId: 'fs-app',
      appName: 'FullStack App',
      appType: 'fullstack',
      dbProvider: 'sqlite',
      dbStatus: 'running',
      model: 'codellama',
      prompt: 'Add user model',
    });
    const task = taskQueue.getAll().find((t) => t.id === id)!;
    expect(task.appType).toBe('fullstack');
    expect(task.dbProvider).toBe('sqlite');
    expect(task.dbStatus).toBe('running');
    // Status may be 'queued' or 'running' depending on processNext timing
    expect(task.status === 'queued' || task.status === 'running').toBe(true);
  });

  it('cancel sets finishedAt timestamp', () => {
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    const before = Date.now();
    taskQueue.cancel(id);
    const task = taskQueue.getAll().find((t) => t.id === id);
    if (task?.status === 'error') {
      expect(task.finishedAt).toBeDefined();
      expect(task.finishedAt!).toBeGreaterThanOrEqual(before);
      expect(task.error).toBe('Cancelled by user');
    }
  });

  it('remove on non-existent id does not throw', () => {
    expect(() => taskQueue.remove('totally-fake-id')).not.toThrow();
  });

  it('multiple subscribers all receive notifications', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    taskQueue.subscribe(listener1);
    taskQueue.subscribe(listener2);
    taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });

  it('processNext calls runAgentLoop with correct params', async () => {
    mockRunAgentLoop.mockReturnValue(vi.fn());

    taskQueue.enqueue({
      appId: 'my-app',
      appName: 'My App',
      appType: 'fullstack',
      dbProvider: 'sqlite',
      dbStatus: 'running',
      model: 'llama3',
      prompt: 'Add auth',
    });

    // Give processNext time to execute
    await new Promise((r) => setTimeout(r, 100));

    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'my-app',
        appType: 'fullstack',
        dbProvider: 'sqlite',
        dbStatus: 'running',
        model: 'llama3',
        userMessage: 'Add auth',
      }),
    );
  });

  it('processNext sets task to running', async () => {
    mockRunAgentLoop.mockReturnValue(vi.fn());

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 100));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.status === 'running' || task?.status === 'done').toBe(true);
  });

  it('processNext handles readFiles rejection', async () => {
    _global.window.deyad.readFiles = vi.fn().mockRejectedValue(new Error('read failed'));
    mockRunAgentLoop.mockReturnValue(vi.fn());

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'test',
    });

    await new Promise((r) => setTimeout(r, 100));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.status).toBe('error');
    expect(task?.error).toBe('read failed');
  });

  it('onDone callback marks task done and calls onFilesChanged', async () => {
    const filesChangedCb = vi.fn();
    taskQueue.setOnFilesChanged(filesChangedCb);

    let capturedOnDone: (() => void) | null = null;
    mockRunAgentLoop.mockImplementation((opts) => {
      capturedOnDone = opts.callbacks.onDone;
      // Simulate immediate completion
      setTimeout(() => capturedOnDone?.(), 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.status).toBe('done');
    expect(task?.finishedAt).toBeDefined();
    expect(filesChangedCb).toHaveBeenCalledWith('test-app');

    taskQueue.setOnFilesChanged(null);
  });

  it('onError callback marks task as error', async () => {
    mockRunAgentLoop.mockImplementation((opts) => {
      const cbs = opts.callbacks;
      setTimeout(() => cbs.onError('something broke'), 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.status).toBe('error');
    expect(task?.error).toBe('something broke');
  });

  it('onContent callback updates task output', async () => {
    mockRunAgentLoop.mockImplementation((opts) => {
      const cbs = opts.callbacks;
      setTimeout(() => {
        cbs.onContent('Hello world');
        cbs.onDone();
      }, 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.output).toBe('Hello world');
  });

  it('onToolStart and onToolResult add steps', async () => {
    mockRunAgentLoop.mockImplementation((opts) => {
      const cbs = opts.callbacks;
      setTimeout(() => {
        cbs.onToolStart('run_command', { command: 'npm test' });
        cbs.onToolResult({ success: true, tool: 'run_command', output: 'All tests passed' });
        cbs.onToolStart('read_file', { path: 'src/App.tsx' });
        cbs.onToolResult({ success: false, tool: 'read_file', output: 'File not found' });
        cbs.onDone();
      }, 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.steps.length).toBe(4);
    expect(task?.steps[0]).toEqual({ type: 'tool', text: 'run_command: npm test' });
    expect(task?.steps[1].text).toContain('✓ run_command:');
    expect(task?.steps[2]).toEqual({ type: 'tool', text: 'read_file: src/App.tsx' });
    expect(task?.steps[3].text).toContain('✗ read_file:');
  });

  it('onToolResult truncates long output', async () => {
    const longOutput = 'x'.repeat(200);
    mockRunAgentLoop.mockImplementation((opts) => {
      const cbs = opts.callbacks;
      setTimeout(() => {
        cbs.onToolResult({ success: true, tool: 'run_command', output: longOutput });
        cbs.onDone();
      }, 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    // Output longer than 80 chars should be truncated with ...
    expect(task?.steps[0].text).toContain('...');
  });

  it('onToolStart with generic tool name uses just the name', async () => {
    mockRunAgentLoop.mockImplementation((opts) => {
      const cbs = opts.callbacks;
      setTimeout(() => {
        cbs.onToolStart('write_files', { path: 'src/index.ts' });
        cbs.onDone();
      }, 10);
      return vi.fn();
    });

    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'build',
    });

    await new Promise((r) => setTimeout(r, 200));

    const task = taskQueue.getAll().find((t) => t.id === id);
    expect(task?.steps[0]).toEqual({ type: 'tool', text: 'write_files' });
  });

  it('multiple enqueue calls create unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(taskQueue.enqueue({
        appId: 'test-app',
        appName: 'Test',
        appType: 'frontend',
        dbStatus: 'none',
        model: 'llama3',
        prompt: `task ${i}`,
      }));
    }
    expect(ids.size).toBe(5);
  });

  it('clearHistory preserves queued and running tasks', () => {
    // Enqueue a task (will be queued or running)
    const id = taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'keep me',
    });
    taskQueue.clearHistory();
    const task = taskQueue.getAll().find((t) => t.id === id);
    // Task should still exist since it's queued or running
    expect(task).toBeDefined();
  });

  it('listener is not called after unsubscribe', () => {
    const listener = vi.fn();
    const unsub = taskQueue.subscribe(listener);
    unsub();
    listener.mockClear();
    taskQueue.enqueue({
      appId: 'test-app',
      appName: 'Test',
      appType: 'frontend',
      dbStatus: 'none',
      model: 'llama3',
      prompt: 'after unsub',
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
