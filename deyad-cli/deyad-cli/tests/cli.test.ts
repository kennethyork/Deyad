import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── parseArgs tests (pure, no mocks) ──
import { parseArgs, generateCompletions, VERSION } from '../src/cli-args.js';

describe('parseArgs', () => {
  it('parses --help flag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('parses --version flag', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('parses --model with value', () => {
    expect(parseArgs(['--model', 'llama3']).model).toBe('llama3');
    expect(parseArgs(['-m', 'codestral']).model).toBe('codestral');
  });

  it('parses --print with value', () => {
    expect(parseArgs(['--print', 'explain this']).print).toBe('explain this');
    expect(parseArgs(['-p', 'hello']).print).toBe('hello');
  });

  it('parses --auto flag', () => {
    const args = parseArgs(['--auto', 'fix bug']);
    expect(args.auto).toBe(true);
    expect(args.prompt).toBe('fix bug');
  });

  it('parses --auto-approve', () => {
    expect(parseArgs(['--auto-approve']).autoApprove).toBe(true);
  });

  it('parses --no-think', () => {
    expect(parseArgs(['--no-think']).noThink).toBe(true);
  });

  it('parses --no-resume', () => {
    expect(parseArgs(['--no-resume']).resume).toBe(false);
  });

  it('defaults resume to true', () => {
    expect(parseArgs([]).resume).toBe(true);
  });

  it('parses --config', () => {
    expect(parseArgs(['--config']).showConfig).toBe(true);
  });

  it('parses --completions with shell', () => {
    expect(parseArgs(['--completions', 'bash']).completions).toBe('bash');
    expect(parseArgs(['--completions', 'zsh']).completions).toBe('zsh');
  });

  it('joins positional arguments as prompt', () => {
    expect(parseArgs(['add', 'a', 'login', 'page']).prompt).toBe('add a login page');
  });

  it('ignores unknown flags', () => {
    const args = parseArgs(['--unknown', 'fix bug']);
    expect(args.prompt).toBe('fix bug');
  });

  it('returns defaults for empty args', () => {
    const args = parseArgs([]);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.model).toBeUndefined();
    expect(args.print).toBeUndefined();
    expect(args.prompt).toBeUndefined();
    expect(args.auto).toBe(false);
    expect(args.autoApprove).toBeUndefined();
    expect(args.noThink).toBe(false);
    expect(args.showConfig).toBe(false);
  });

  it('combines model and prompt', () => {
    const args = parseArgs(['-m', 'qwen3:8b', 'refactor utils']);
    expect(args.model).toBe('qwen3:8b');
    expect(args.prompt).toBe('refactor utils');
  });
});

// ── generateCompletions tests ──
describe('generateCompletions', () => {
  it('generates bash completions', () => {
    const out = generateCompletions('bash');
    expect(out).toContain('_deyad_completions');
    expect(out).toContain('complete -F');
  });

  it('generates zsh completions', () => {
    const out = generateCompletions('zsh');
    expect(out).toContain('compdef _deyad');
  });

  it('generates fish completions', () => {
    const out = generateCompletions('fish');
    expect(out).toContain('complete -c deyad');
  });

  it('returns error for unknown shell', () => {
    const out = generateCompletions('powershell');
    expect(out).toContain('Unknown shell');
  });
});

// ── VERSION test ──
describe('VERSION', () => {
  it('is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ── ThinkFilter tests ──
import { ThinkFilter } from '../src/cli.js';

describe('ThinkFilter', () => {
  let output: string;
  let filter: InstanceType<typeof ThinkFilter>;

  beforeEach(() => {
    output = '';
    filter = new ThinkFilter((s) => { output += s; });
  });

  it('passes through normal text', () => {
    filter.write('hello world');
    filter.flush();
    expect(output).toBe('hello world');
  });

  it('strips <think>...</think> blocks', () => {
    filter.write('before<think>reasoning here</think>after');
    filter.flush();
    expect(output).toBe('beforeafter');
  });

  it('handles multi-chunk think blocks', () => {
    filter.write('start<thi');
    filter.write('nk>internal</');
    filter.write('think>end');
    filter.flush();
    expect(output).toBe('startend');
  });

  it('handles nested-looking content inside think', () => {
    filter.write('<think>some <b>html</b> inside</think>visible');
    filter.flush();
    expect(output).toBe('visible');
  });

  it('handles empty think blocks', () => {
    filter.write('a<think></think>b');
    filter.flush();
    expect(output).toBe('ab');
  });

  it('handles multiple think blocks', () => {
    filter.write('one<think>x</think>two<think>y</think>three');
    filter.flush();
    expect(output).toBe('onetwothree');
  });

  it('flush does not emit buffered thinking content', () => {
    filter.write('<think>still thinking...');
    filter.flush();
    expect(output).toBe('');
  });

  it('handles partial open tag at end of chunk', () => {
    filter.write('hello<thi');
    // The partial tag is buffered
    filter.write('nk>hidden</think>world');
    filter.flush();
    expect(output).toBe('helloworld');
  });
});

// ── createCallbacks tests ──
import { createCallbacks } from '../src/cli.js';

describe('createCallbacks', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('returns all required callback methods', () => {
    const cb = createCallbacks();
    expect(cb.onToken).toBeTypeOf('function');
    expect(cb.onThinkingToken).toBeTypeOf('function');
    expect(cb.onToolStart).toBeTypeOf('function');
    expect(cb.onToolResult).toBeTypeOf('function');
    expect(cb.onDiff).toBeTypeOf('function');
    expect(cb.onDone).toBeTypeOf('function');
    expect(cb.onError).toBeTypeOf('function');
    expect(cb.confirm).toBeTypeOf('function');
  });

  it('onToken writes to stdout when not silent', () => {
    const cb = createCallbacks({ silent: false });
    cb.onToken('hello');
    expect(writeSpy).toHaveBeenCalled();
  });

  it('onToken does not write to stdout when silent', () => {
    const cb = createCallbacks({ silent: true });
    cb.onToken('hello');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('onToolResult logs tool output', () => {
    const cb = createCallbacks();
    cb.onToolResult({ tool: 'read_file', success: true, output: 'content' });
    expect(logSpy).toHaveBeenCalled();
  });

  it('onError logs to stderr', () => {
    const cb = createCallbacks();
    cb.onError('something broke');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('confirm auto-approves when autoApprove is true', async () => {
    const cb = createCallbacks({ autoApprove: true });
    expect(await cb.confirm('delete file?')).toBe(true);
  });

  it('confirm rejects when autoApprove is false and no askConfirm', async () => {
    const cb = createCallbacks({ autoApprove: false });
    expect(await cb.confirm('delete file?')).toBe(false);
  });

  it('confirm delegates to custom askConfirm', async () => {
    const cb = createCallbacks({ askConfirm: async () => true });
    expect(await cb.confirm('allow?')).toBe(true);
  });

  it('onDone in silent mode prints summary', () => {
    const cb = createCallbacks({ silent: true });
    cb.onDone('task complete');
    expect(logSpy).toHaveBeenCalledWith('task complete');
  });
});

// ── runOnce test (with mock) ──

vi.mock('../src/agent.js', () => ({
  runAgentLoop: vi.fn(async (_model: string, _userMessage: string, _cwd: string, callbacks: any) => {
    callbacks.onToolResult?.({ tool: 'read_file', success: true, output: 'hello' });
    callbacks.onDone?.('');
  }),
  compactConversation: vi.fn(),
}));

const { runOnce } = await import('../src/cli.js');

describe('CLI print mode', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints tool results in silent print mode', async () => {
    await runOnce('qwen3.5:27b', 'read README.md', '/tmp', true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
  });

  it('runs non-silent mode without error', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runOnce('qwen3.5:27b', 'explain code', '/tmp', false);
    writeSpy.mockRestore();
    // Should complete without throwing
  });
});
