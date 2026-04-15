import { describe, it, expect } from 'vitest';
import {
  c,
  box,
  divider,
  Spinner,
  formatToolStart,
  formatToolEnd,
  formatDiff,
  formatConfirm,
  formatStatus,
  formatHelp,
  formatError,
  formatSuccess,
  formatTokenBadge,
  getPrompt,
  printBanner,
} from '../src/tui.js';

// Strip ANSI codes for content assertions
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('c (color helpers)', () => {
  it('wraps text with ANSI codes', () => {
    expect(c.bold('hello')).toContain('hello');
    expect(c.dim('hello')).toContain('hello');
    expect(c.cyan('hello')).toContain('hello');
    expect(c.red('error')).toContain('error');
    expect(c.green('ok')).toContain('ok');
    expect(c.yellow('warn')).toContain('warn');
  });

  it('compound styles work', () => {
    expect(c.brandBold('deyad')).toContain('deyad');
    expect(c.error('fail')).toContain('fail');
    expect(c.success('pass')).toContain('pass');
    expect(c.warn('caution')).toContain('caution');
    expect(c.muted('quiet')).toContain('quiet');
  });
});

describe('box', () => {
  it('renders a bordered box with title', () => {
    const result = box('Test', 'Hello world');
    const plain = strip(result);
    expect(plain).toContain('Test');
    expect(plain).toContain('Hello world');
    expect(plain).toContain('╭');
    expect(plain).toContain('╰');
  });

  it('handles multi-line content', () => {
    const result = box('Title', 'line1\nline2\nline3');
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5); // top + 3 body + bottom
  });

  it('handles empty title', () => {
    const result = box('', 'content');
    expect(strip(result)).toContain('content');
  });
});

describe('divider', () => {
  it('renders a line without label', () => {
    const result = divider();
    expect(strip(result)).toMatch(/─+/);
  });

  it('renders with a label', () => {
    const result = divider('Section');
    expect(strip(result)).toContain('Section');
  });
});

describe('Spinner', () => {
  it('constructs without error', () => {
    const spinner = new Spinner('Loading...');
    expect(spinner).toBeDefined();
  });
});

describe('formatToolStart', () => {
  it('renders tool name and params', () => {
    const result = formatToolStart('read_file', { path: 'src/main.ts' });
    const plain = strip(result);
    expect(plain).toContain('read_file');
    expect(plain).toContain('src/main.ts');
  });

  it('truncates long param values', () => {
    const longVal = 'x'.repeat(200);
    const result = formatToolStart('write_files', { content: longVal });
    const plain = strip(result);
    expect(plain).toContain('...');
  });
});

describe('formatToolEnd', () => {
  it('renders success result', () => {
    const result = formatToolEnd('read_file', true, 'file contents here');
    const plain = strip(result);
    expect(plain).toContain('✓');
    expect(plain).toContain('completed');
  });

  it('renders failure result', () => {
    const result = formatToolEnd('run_command', false, 'command not found');
    const plain = strip(result);
    expect(plain).toContain('✗');
    expect(plain).toContain('failed');
  });

  it('handles elapsed time', () => {
    const result = formatToolEnd('run_command', true, 'done', '1.2s');
    const plain = strip(result);
    expect(plain).toContain('1.2s');
  });

  it('truncates long output to preview lines', () => {
    const longOutput = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const result = formatToolEnd('search_files', true, longOutput);
    const plain = strip(result);
    expect(plain).toContain('more lines');
  });
});

describe('formatDiff', () => {
  it('renders a diff display with file path', () => {
    const diff = '+added line\n-removed line\n unchanged';
    const result = formatDiff('src/main.ts', diff);
    const plain = strip(result);
    expect(plain).toContain('src/main.ts');
    expect(plain).toContain('added line');
    expect(plain).toContain('removed line');
  });
});

describe('formatConfirm', () => {
  it('renders a confirm prompt', () => {
    const result = formatConfirm('Delete file?');
    const plain = strip(result);
    expect(plain).toContain('Delete file?');
    expect(plain).toContain('y/n');
  });
});

describe('formatStatus', () => {
  it('shows model, tasks, and tokens', () => {
    const result = formatStatus('qwen3:8b', 5, 12000, false);
    const plain = strip(result);
    expect(plain).toContain('qwen3:8b');
    expect(plain).toContain('5');
    expect(plain).toContain('12,000');
  });

  it('shows sandbox indicator when active', () => {
    const result = formatStatus('qwen3:8b', 0, 0, true);
    const plain = strip(result);
    expect(plain).toContain('sandbox');
  });
});

describe('formatHelp', () => {
  it('includes all command categories', () => {
    const result = formatHelp();
    const plain = strip(result);
    expect(plain).toContain('/model');
    expect(plain).toContain('/undo');
    expect(plain).toContain('/sandbox');
    expect(plain).toContain('/memory');
    expect(plain).toContain('exit');
  });
});

describe('formatError', () => {
  it('renders error message', () => {
    const result = formatError('Something broke');
    const plain = strip(result);
    expect(plain).toContain('✗');
    expect(plain).toContain('Something broke');
  });
});

describe('formatSuccess', () => {
  it('renders success message', () => {
    const result = formatSuccess('Done!');
    const plain = strip(result);
    expect(plain).toContain('✓');
    expect(plain).toContain('Done!');
  });
});

describe('formatTokenBadge', () => {
  it('renders token count', () => {
    const result = formatTokenBadge(1500);
    const plain = strip(result);
    expect(plain).toContain('1,500');
    expect(plain).toContain('tokens');
  });

  it('renders context percentage when provided', () => {
    const result = formatTokenBadge(3000, 45);
    const plain = strip(result);
    expect(plain).toContain('45%');
    expect(plain).toContain('context');
  });

  it('renders high context in warning color', () => {
    const result = formatTokenBadge(50000, 95);
    const plain = strip(result);
    expect(plain).toContain('95%');
  });
});

describe('getPrompt', () => {
  it('returns prompt without sandbox prefix', () => {
    const result = getPrompt(false);
    const plain = strip(result);
    expect(plain).toContain('❯');
    expect(plain).not.toContain('sandbox');
  });

  it('returns prompt with sandbox prefix', () => {
    const result = getPrompt(true);
    const plain = strip(result);
    expect(plain).toContain('sandbox');
    expect(plain).toContain('❯');
  });
});
