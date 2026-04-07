/**
 * TUI rendering helpers — polished terminal UI for Deyad CLI.
 * Uses ANSI escape codes directly (no heavy deps) with chalk for colors.
 */

// ── Colors & Styles ──

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;
const UNDERLINE = `${ESC}4m`;

// Brand colors
const CYAN = `${ESC}36m`;
const BRIGHT_CYAN = `${ESC}96m`;
const BLUE = `${ESC}34m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const MAGENTA = `${ESC}35m`;
const WHITE = `${ESC}37m`;
const GRAY = `${ESC}90m`;

// Background
const BG_GRAY = `${ESC}48;5;236m`;
const BG_DARK = `${ESC}48;5;233m`;

export const c = {
  reset: (s: string) => `${RESET}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  italic: (s: string) => `${ITALIC}${s}${RESET}`,
  underline: (s: string) => `${UNDERLINE}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  brightCyan: (s: string) => `${BRIGHT_CYAN}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  gray: (s: string) => `${GRAY}${s}${RESET}`,
  bgDark: (s: string) => `${BG_DARK}${s}${RESET}`,
  bgGray: (s: string) => `${BG_GRAY}${s}${RESET}`,
  // Compound styles
  brandBold: (s: string) => `${BOLD}${BRIGHT_CYAN}${s}${RESET}`,
  error: (s: string) => `${BOLD}${RED}${s}${RESET}`,
  success: (s: string) => `${GREEN}${s}${RESET}`,
  warn: (s: string) => `${YELLOW}${s}${RESET}`,
  muted: (s: string) => `${DIM}${s}${RESET}`,
};

// ── Box Drawing ──

const BOX = {
  topLeft: '╭', topRight: '╮',
  bottomLeft: '╰', bottomRight: '╯',
  horizontal: '─', vertical: '│',
  teeRight: '├', teeLeft: '┤',
};

function getTermWidth(): number {
  return process.stdout.columns || 80;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function padRight(s: string, width: number): string {
  const visible = visibleLength(s);
  return visible >= width ? s : s + ' '.repeat(width - visible);
}

function truncate(s: string, maxWidth: number): string {
  const stripped = stripAnsi(s);
  if (stripped.length <= maxWidth) return s;
  // Simple truncation — won't perfectly handle mid-ansi truncation but good enough
  let visible = 0;
  let i = 0;
  // eslint-disable-next-line no-control-regex
  const ansiRegex = /\x1b\[[0-9;]*m/g;
  let result = '';
  while (i < s.length && visible < maxWidth - 1) {
    ansiRegex.lastIndex = i;
    const match = ansiRegex.exec(s);
    if (match && match.index === i) {
      result += match[0];
      i += match[0].length;
    } else {
      result += s[i];
      visible++;
      i++;
    }
  }
  return result + '…' + RESET;
}

// ── Box Renderer ──

export function box(title: string, content: string, color: string = CYAN): string {
  const w = Math.min(getTermWidth(), 100);
  const innerW = w - 4; // 2 border + 2 padding
  const titleStr = title ? ` ${title} ` : '';
  const titleLen = stripAnsi(titleStr).length;
  const topLine = `${color}${BOX.topLeft}${BOX.horizontal}${BOLD}${titleStr}${RESET}${color}${BOX.horizontal.repeat(Math.max(0, w - 3 - titleLen))}${BOX.topRight}${RESET}`;
  
  const lines = content.split('\n');
  const bodyLines = lines.map((line) => {
    const tLine = truncate(line, innerW);
    return `${color}${BOX.vertical}${RESET} ${padRight(tLine, innerW)} ${color}${BOX.vertical}${RESET}`;
  });

  const bottomLine = `${color}${BOX.bottomLeft}${BOX.horizontal.repeat(w - 2)}${BOX.bottomRight}${RESET}`;

  return [topLine, ...bodyLines, bottomLine].join('\n');
}

export function divider(label?: string): string {
  const w = Math.min(getTermWidth(), 100);
  if (!label) return c.dim(BOX.horizontal.repeat(w));
  const labelStr = ` ${label} `;
  const remaining = w - stripAnsi(labelStr).length - 2;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return c.dim(`${BOX.horizontal.repeat(left)}${labelStr}${BOX.horizontal.repeat(right)}`);
}

// ── Spinner ──

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    this.frame = 0;
    process.stdout.write('\x1b[?25l'); // Hide cursor
    this.render();
    this.interval = setInterval(() => this.render(), 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r\x1b[K`); // Clear line
    process.stdout.write('\x1b[?25h'); // Show cursor
    if (finalMessage) {
      console.log(finalMessage);
    }
  }

  private render(): void {
    const spinner = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    process.stdout.write(`\r\x1b[K  ${CYAN}${spinner}${RESET} ${DIM}${this.message}${RESET}`);
    this.frame++;
  }
}

// ── Startup Banner ──

export function printBanner(version: string, model: string, cwd: string, isSandbox: boolean): void {
  const logo = `${BOLD}${BRIGHT_CYAN}  ╺━━╸  ╺━━━━━╸  ╺━╸ ╺━╸  ╺━━━╸  ╺━━━╸
  ╺╸  ╺╸ ╺╸        ╺╸ ╺╸  ╺╸  ╺╸ ╺╸  ╺╸
  ╺╸  ╺╸ ╺━━━╸     ╺━━╸   ╺━━━╸  ╺╸  ╺╸
  ╺╸  ╺╸ ╺╸         ╺╸    ╺╸  ╺╸ ╺╸  ╺╸
  ╺━━╸  ╺━━━━━╸    ╺╸    ╺╸  ╺╸ ╺━━━╸${RESET}`;

  console.log('');
  console.log(logo);
  console.log('');
  console.log(`  ${c.dim('v' + version)} ${c.dim('·')} ${c.yellow(model)} ${c.dim('·')} ${c.dim(shortenPath(cwd))}`);
  if (isSandbox) {
    console.log(`  ${c.warn('⚠ Sandbox mode active')}`);
  }
  console.log(`  ${c.dim('Type /help for commands · exit to quit')}`);
  console.log('');
}

function shortenPath(p: string): string {
  const home = process.env['HOME'] || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

// ── Tool Display ──

export function formatToolStart(name: string, params: Record<string, string>): string {
  const w = Math.min(getTermWidth(), 100);
  const innerW = w - 4;
  const icon = getToolIcon(name);
  const header = `${icon} ${c.brandBold(name)}`;

  const paramLines: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const val = v.length > innerW - 15 ? v.slice(0, innerW - 18) + '...' : v;
    paramLines.push(`  ${c.dim(k + ':')} ${val}`);
  }

  const topLine = `${CYAN}${BOX.topLeft}${BOX.horizontal}${RESET} ${header} ${CYAN}${BOX.horizontal.repeat(Math.max(0, w - visibleLength(header) - 5))}${BOX.topRight}${RESET}`;
  const bodyLines = paramLines.map((line) => {
    return `${CYAN}${BOX.vertical}${RESET} ${padRight(truncate(line, innerW), innerW)} ${CYAN}${BOX.vertical}${RESET}`;
  });

  return [topLine, ...bodyLines].join('\n');
}

export function formatToolEnd(name: string, success: boolean, output: string): string {
  const w = Math.min(getTermWidth(), 100);
  const innerW = w - 4;

  const icon = success ? c.green('✓') : c.red('✗');
  const statusLabel = success ? c.green('completed') : c.red('failed');
  const preview = output.split('\n').slice(0, 3).map((l) => truncate(l, innerW));
  
  const bodyLines = preview.map((line) => {
    return `${CYAN}${BOX.vertical}${RESET} ${padRight(c.dim(line), innerW)} ${CYAN}${BOX.vertical}${RESET}`;
  });

  const footer = `${CYAN}${BOX.bottomLeft}${BOX.horizontal}${RESET} ${icon} ${statusLabel} ${CYAN}${BOX.horizontal.repeat(Math.max(0, w - visibleLength(`${icon} ${statusLabel}`) - 5))}${BOX.bottomRight}${RESET}`;

  return [...bodyLines, footer].join('\n');
}

function getToolIcon(name: string): string {
  const icons: Record<string, string> = {
    read_file: '📄',
    write_files: '✏️ ',
    edit_file: '🔧',
    multi_edit: '🔧',
    delete_file: '🗑️ ',
    list_files: '📁',
    glob_files: '🔍',
    search_files: '🔍',
    run_command: '⚙️ ',
    git_status: '📊',
    git_log: '📋',
    git_diff: '📝',
    git_branch: '🌿',
    git_add: '📌',
    git_commit: '💾',
    git_stash: '📦',
    fetch_url: '🌐',
    memory_read: '🧠',
    memory_write: '🧠',
    memory_list: '🧠',
    memory_delete: '🧠',
  };
  return icons[name] || '⚡';
}

// ── Diff Display ──

export function formatDiff(filePath: string, diff: string, maxLines = 12): string {
  const w = Math.min(getTermWidth(), 100);
  const innerW = w - 4;
  const lines = diff.split('\n').slice(0, maxLines);
  const colored = lines.map((l) => {
    if (l.startsWith('+') && !l.startsWith('+++')) return c.green(l);
    if (l.startsWith('-') && !l.startsWith('---')) return c.red(l);
    if (l.startsWith('@@')) return c.cyan(l);
    return c.dim(l);
  });

  const header = `${YELLOW}${BOX.topLeft}${BOX.horizontal}${RESET} ${c.yellow(filePath)} ${YELLOW}${BOX.horizontal.repeat(Math.max(0, w - visibleLength(filePath) - 5))}${BOX.topRight}${RESET}`;
  const bodyLines = colored.map((line) => {
    return `${YELLOW}${BOX.vertical}${RESET} ${padRight(truncate(line, innerW), innerW)} ${YELLOW}${BOX.vertical}${RESET}`;
  });

  const more = diff.split('\n').length > maxLines ? ` ${c.dim(`… ${diff.split('\n').length - maxLines} more lines`)}` : '';
  const footer = `${YELLOW}${BOX.bottomLeft}${BOX.horizontal.repeat(w - 2)}${BOX.bottomRight}${RESET}${more}`;

  return [header, ...bodyLines, footer].join('\n');
}

// ── Confirm Dialog ──

export function formatConfirm(question: string): string {
  return `\n  ${c.yellow('?')} ${c.bold(question)} ${c.dim('(y/n)')} `;
}

// ── Status Bar ──

export function formatStatus(model: string, taskCount: number, tokens: number, sandboxed: boolean): string {
  const parts = [
    c.dim('model:') + ' ' + c.yellow(model),
    c.dim('tasks:') + ' ' + String(taskCount),
    c.dim('tokens:') + ' ~' + tokens.toLocaleString(),
  ];
  if (sandboxed) parts.push(c.yellow('⚠ sandbox'));
  return `  ${parts.join(c.dim(' · '))}`;
}

// ── Help Display ──

export function formatHelp(): string {
  const sections = [
    {
      title: 'Commands',
      items: [
        ['/model <name>', 'Switch Ollama model'],
        ['/models', 'List available models'],
        ['/clear', 'Clear conversation history'],
        ['/status', 'Show session stats'],
        ['/compact', 'Force conversation compaction'],
      ],
    },
    {
      title: 'Undo & Sandbox',
      items: [
        ['/undo', 'Undo last agent task (git rollback)'],
        ['/snapshots', 'List available undo points'],
        ['/sandbox start', 'Enter sandbox mode (temp git branch)'],
        ['/sandbox merge', 'Merge sandbox changes back'],
        ['/sandbox discard', 'Discard sandbox changes'],
      ],
    },
    {
      title: 'Sessions & Memory',
      items: [
        ['/sessions', 'List saved sessions'],
        ['/memory', 'List persistent memory notes'],
        ['exit', 'Save session and quit'],
      ],
    },
  ];

  const lines: string[] = [''];
  for (const section of sections) {
    lines.push(`  ${c.brandBold(section.title)}`);
    for (const [cmd, desc] of section.items) {
      lines.push(`    ${c.cyan(cmd.padEnd(20))} ${c.dim(desc)}`);
    }
    lines.push('');
  }
  lines.push(`  ${c.dim('Tip: Create a DEYAD.md in your project root for custom instructions.')}`);
  lines.push('');
  return lines.join('\n');
}

// ── Error Display ──

export function formatError(message: string): string {
  return `\n  ${c.error('✗')} ${c.red(message)}\n`;
}

export function formatSuccess(message: string): string {
  return `  ${c.green('✓')} ${message}`;
}

// ── Token Badge ──

export function formatTokenBadge(tokens: number): string {
  return c.dim(`  ─── ${tokens.toLocaleString()} tokens ───`);
}

// ── Prompt ──

export function getPrompt(sandboxed: boolean): string {
  const prefix = sandboxed ? `${YELLOW}sandbox${RESET}${GRAY}:${RESET}` : '';
  return `\n ${prefix}${BOLD}${BRIGHT_CYAN}❯${RESET} `;
}
