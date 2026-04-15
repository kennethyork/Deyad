import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all heavy dependencies before importing commands ──

vi.mock('../src/agent.js', () => ({
  compactConversation: vi.fn((history: unknown[]) => { history.splice(0, Math.max(0, history.length - 2)); }),
}));

vi.mock('../src/session.js', () => ({
  memoryList: vi.fn(() => []),
  listSessions: vi.fn(() => []),
}));

vi.mock('../src/undo.js', () => ({
  undoLast: vi.fn(() => ({ success: true, message: 'Rolled back 1 commit.' })),
  getSnapshots: vi.fn(() => []),
}));

vi.mock('../src/sandbox.js', () => ({
  enterSandbox: vi.fn(() => ({ success: true, message: 'Sandbox started.' })),
  exitSandbox: vi.fn((_cwd: string, merge: boolean) => ({
    success: true,
    message: merge ? 'Sandbox merged.' : 'Sandbox discarded.',
    diff: 'diff --git ...',
  })),
  isSandboxed: vi.fn(() => false),
}));

vi.mock('../src/rag.js', () => ({
  buildIndex: vi.fn(),
  getIndexStats: vi.fn(() => ({ files: 42, chunks: 200 })),
}));

vi.mock('../src/tui.js', () => ({
  c: new Proxy({}, { get: () => (s: string) => s }),
  divider: vi.fn(() => '---'),
  Spinner: vi.fn().mockImplementation(() => ({ start: vi.fn(), stop: vi.fn() })),
  formatStatus: vi.fn((...args: unknown[]) => `status:${args[0]}`),
  formatHelp: vi.fn(() => 'HELP_TEXT'),
  formatError: vi.fn((msg: string) => `ERR:${msg}`),
  formatSuccess: vi.fn((msg: string) => `OK:${msg}`),
}));

const { handleSlashCommand } = await import('../src/commands.js');

// ── Helpers ──

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    cfg: {
      model: 'qwen3:8b',
      models: ['qwen3:8b', 'llama3.3:70b', 'codestral:latest'],
      cwd: '/tmp/test-project',
      autoApprove: false,
      noThink: false,
      temperature: 0.7,
      ollamaHost: 'http://127.0.0.1:11434',
      contextSize: 131072,
      maxIterations: 25,
      gitAutoCommit: false,
      allowedTools: [],
      restrictedTools: [],
      resume: true,
    },
    session: { id: 'test-session-123', history: [], totalTokens: 0, taskCount: 0, model: 'qwen3:8b', cwd: '/tmp/test-project', updatedAt: '' },
    history: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'fix the bug' },
      { role: 'assistant', content: 'done' },
    ],
    totalTokens: 5000,
    taskCount: 3,
    rl: { close: vi.fn(), question: vi.fn() },
    saveSession: vi.fn(),
    runGitCommitPush: vi.fn(async () => {}),
    ...overrides,
  } as any;
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

// ── Tests ──

describe('handleSlashCommand', () => {
  it('returns false for non-commands', async () => {
    const state = makeState();
    expect(await handleSlashCommand('fix the login bug', state)).toBe(false);
    expect(await handleSlashCommand('hello world', state)).toBe(false);
  });

  it('/help prints help text', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/help', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('HELP_TEXT');
  });

  it('/clear empties history', async () => {
    const state = makeState();
    expect(state.history.length).toBe(4);
    expect(await handleSlashCommand('/clear', state)).toBe(true);
    expect(state.history.length).toBe(0);
  });

  it('/status shows session info', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/status', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('test-session-123'));
  });

  it('/models lists available models', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/models', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('qwen3:8b'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('llama3.3:70b'));
  });

  it('/compact compacts conversation history', async () => {
    const state = makeState();
    const before = state.history.length;
    expect(await handleSlashCommand('/compact', state)).toBe(true);
    expect(state.history.length).toBeLessThanOrEqual(before);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Compacted'));
  });

  it('/model switches to valid model', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/model llama3.3:70b', state)).toBe(true);
    expect(state.cfg.model).toBe('llama3.3:70b');
  });

  it('/model rejects unknown model', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/model nonexistent', state)).toBe(true);
    expect(state.cfg.model).toBe('qwen3:8b'); // unchanged
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('/undo calls undoLast', async () => {
    const { undoLast } = await import('../src/undo.js');
    const state = makeState();
    expect(await handleSlashCommand('/undo', state)).toBe(true);
    expect(undoLast).toHaveBeenCalledWith('/tmp/test-project');
  });

  it('/snapshots shows empty message when none', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/snapshots', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No snapshots'));
  });

  it('/snapshots lists snapshots when present', async () => {
    const { getSnapshots } = await import('../src/undo.js');
    vi.mocked(getSnapshots).mockReturnValueOnce([
      { ref: 'abc12345def', description: 'before task: fix bug', timestamp: '2026-01-01' },
    ]);
    const state = makeState();
    expect(await handleSlashCommand('/snapshots', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('abc12345'));
  });

  it('/sandbox starts sandbox', async () => {
    const { enterSandbox } = await import('../src/sandbox.js');
    const state = makeState();
    expect(await handleSlashCommand('/sandbox', state)).toBe(true);
    expect(enterSandbox).toHaveBeenCalledWith('/tmp/test-project');
  });

  it('/sandbox start is an alias', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/sandbox start', state)).toBe(true);
  });

  it('/sandbox merge exits with merge', async () => {
    const { exitSandbox } = await import('../src/sandbox.js');
    const state = makeState();
    expect(await handleSlashCommand('/sandbox merge', state)).toBe(true);
    expect(exitSandbox).toHaveBeenCalledWith('/tmp/test-project', true);
  });

  it('/sandbox discard exits without merge', async () => {
    const { exitSandbox } = await import('../src/sandbox.js');
    const state = makeState();
    expect(await handleSlashCommand('/sandbox discard', state)).toBe(true);
    expect(exitSandbox).toHaveBeenCalledWith('/tmp/test-project', false);
  });

  it('/sessions shows empty message', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/sessions', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No saved sessions'));
  });

  it('/memory shows empty message', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/memory', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No memory entries'));
  });

  it('/memory lists entries when present', async () => {
    const { memoryList } = await import('../src/session.js');
    vi.mocked(memoryList).mockReturnValueOnce([
      { key: 'project-notes', value: 'This is a TypeScript project using Vite' },
    ]);
    const state = makeState();
    expect(await handleSlashCommand('/memory', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('project-notes'));
  });

  it('/tokens shows token usage', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/tokens', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('5000'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
  });

  it('/tokens shows avg per task', async () => {
    const state = makeState({ totalTokens: 9000, taskCount: 3 });
    expect(await handleSlashCommand('/tokens', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('3000'));
  });

  it('/index builds index and shows stats', async () => {
    const { buildIndex, getIndexStats } = await import('../src/rag.js');
    const state = makeState();
    expect(await handleSlashCommand('/index', state)).toBe(true);
    expect(buildIndex).toHaveBeenCalledWith('/tmp/test-project', true);
    expect(getIndexStats).toHaveBeenCalledWith('/tmp/test-project');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
  });

  it('/index shows error when stats are null', async () => {
    const { getIndexStats } = await import('../src/rag.js');
    vi.mocked(getIndexStats).mockReturnValueOnce(null as any);
    const state = makeState();
    expect(await handleSlashCommand('/index', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed'));
  });

  it('/git delegates to state.runGitCommitPush', async () => {
    const state = makeState();
    expect(await handleSlashCommand('/git', state)).toBe(true);
    expect(state.runGitCommitPush).toHaveBeenCalled();
  });

  it('"git" bare command also triggers git flow', async () => {
    const state = makeState();
    expect(await handleSlashCommand('git', state)).toBe(true);
    expect(state.runGitCommitPush).toHaveBeenCalled();
  });

  it('/init creates DEYAD.md in the project cwd', async () => {
    // We can't spy on node:fs directly, so test with a temp dir
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-test-'));
    const state = makeState({ cfg: { ...makeState().cfg, cwd: tmpDir } });
    expect(await handleSlashCommand('/init', state)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'DEYAD.md'))).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, 'DEYAD.md'), 'utf-8');
    expect(content).toContain('Project Instructions');
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('/init skips when DEYAD.md exists', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-test-'));
    fs.writeFileSync(path.join(tmpDir, 'DEYAD.md'), 'existing', 'utf-8');
    const state = makeState({ cfg: { ...makeState().cfg, cwd: tmpDir } });
    expect(await handleSlashCommand('/init', state)).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    // Content unchanged
    expect(fs.readFileSync(path.join(tmpDir, 'DEYAD.md'), 'utf-8')).toBe('existing');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('exit calls saveSession and process.exit', async () => {
    const state = makeState();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await handleSlashCommand('exit', state);
    } catch { /* expected */ }
    expect(state.saveSession).toHaveBeenCalled();
    expect(state.rl.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('quit behaves same as exit', async () => {
    const state = makeState();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    try {
      await handleSlashCommand('quit', state);
    } catch { /* expected */ }
    expect(state.saveSession).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
