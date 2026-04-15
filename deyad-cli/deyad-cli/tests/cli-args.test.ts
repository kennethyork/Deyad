/**
 * Tests for CLI argument parsing and shell completions.
 */
import { describe, it, expect } from 'vitest';
import { parseArgs, generateCompletions, VERSION } from '../src/cli-args.js';

describe('VERSION', () => {
  it('is a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('parseArgs', () => {
  it('returns defaults for empty argv', () => {
    const args = parseArgs([]);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.auto).toBe(false);
    expect(args.resume).toBe(true);
    expect(args.noThink).toBe(false);
    expect(args.model).toBeUndefined();
    expect(args.print).toBeUndefined();
    expect(args.prompt).toBeUndefined();
    expect(args.completions).toBeUndefined();
    expect(args.showConfig).toBe(false);
  });

  it('parses -h and --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('parses -v and --version', () => {
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('parses -m and --model with value', () => {
    expect(parseArgs(['-m', 'llama3']).model).toBe('llama3');
    expect(parseArgs(['--model', 'qwen']).model).toBe('qwen');
  });

  it('parses -p and --print with value', () => {
    expect(parseArgs(['-p', 'explain this']).print).toBe('explain this');
    expect(parseArgs(['--print', 'hello']).print).toBe('hello');
  });

  it('parses -a and --auto', () => {
    expect(parseArgs(['-a']).auto).toBe(true);
    expect(parseArgs(['--auto']).auto).toBe(true);
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

  it('parses --resume', () => {
    expect(parseArgs(['--no-resume', '--resume']).resume).toBe(true);
  });

  it('parses --config', () => {
    expect(parseArgs(['--config']).showConfig).toBe(true);
  });

  it('parses --completions with shell', () => {
    expect(parseArgs(['--completions', 'bash']).completions).toBe('bash');
  });

  it('collects positional args as prompt', () => {
    const args = parseArgs(['add', 'a', 'login', 'page']);
    expect(args.prompt).toBe('add a login page');
  });

  it('ignores unknown flags', () => {
    const args = parseArgs(['--unknown', 'stuff']);
    expect(args.prompt).toBe('stuff');
  });

  it('combines flags and positional', () => {
    const args = parseArgs(['-m', 'codestral', '--auto', 'refactor', 'utils']);
    expect(args.model).toBe('codestral');
    expect(args.auto).toBe(true);
    expect(args.prompt).toBe('refactor utils');
  });
});

describe('generateCompletions', () => {
  it('generates bash completions', () => {
    const out = generateCompletions('bash');
    expect(out).toContain('_deyad_completions');
    expect(out).toContain('complete');
    expect(out).toContain('--help');
  });

  it('generates zsh completions', () => {
    const out = generateCompletions('zsh');
    expect(out).toContain('compdef _deyad');
    expect(out).toContain('--model');
  });

  it('generates fish completions', () => {
    const out = generateCompletions('fish');
    expect(out).toContain('complete -c deyad');
    expect(out).toContain('-l auto');
  });

  it('returns error for unknown shell', () => {
    const out = generateCompletions('powershell');
    expect(out).toContain('Unknown shell');
    expect(out).toContain('powershell');
  });
});
