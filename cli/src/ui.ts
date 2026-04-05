/**
 * Terminal UI helpers — colors, prompts, spinners.
 * Uses chalk for colors, readline for input.
 */

import * as readline from 'node:readline';

// ── ANSI color helpers (no dependency needed for basics) ────────────
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  bgBlue: '\x1b[44m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

export function bold(s: string): string { return `${c.bold}${s}${c.reset}`; }
export function dim(s: string): string { return `${c.dim}${s}${c.reset}`; }
export function red(s: string): string { return `${c.red}${s}${c.reset}`; }
export function green(s: string): string { return `${c.green}${s}${c.reset}`; }
export function yellow(s: string): string { return `${c.yellow}${s}${c.reset}`; }
export function blue(s: string): string { return `${c.blue}${s}${c.reset}`; }
export function cyan(s: string): string { return `${c.cyan}${s}${c.reset}`; }
export function magenta(s: string): string { return `${c.magenta}${s}${c.reset}`; }
export function gray(s: string): string { return `${c.gray}${s}${c.reset}`; }

// ── Spinner ─────────────────────────────────────────────────────────
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private text = '';

  start(text: string) {
    this.text = text;
    this.frame = 0;
    this.interval = setInterval(() => {
      const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      process.stderr.write(`\r${c.cyan}${f}${c.reset} ${this.text}`);
      this.frame++;
    }, 80);
  }

  update(text: string) {
    this.text = text;
  }

  stop(finalText?: string) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stderr.write('\r\x1b[K'); // clear line
    if (finalText) {
      console.log(finalText);
    }
  }
}

// ── Readline helpers ────────────────────────────────────────────────
export function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer));
  });
}

export async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await prompt(rl, `${c.yellow}?${c.reset} ${question} ${dim('(y/n)')} `);
  return answer.trim().toLowerCase().startsWith('y');
}

export async function selectModel(rl: readline.Interface, models: string[]): Promise<string> {
  console.log(`\n${bold('Available models:')}`);
  for (let i = 0; i < models.length; i++) {
    console.log(`  ${dim(`${i + 1}.`)} ${models[i]}`);
  }
  const answer = await prompt(rl, `\n${c.cyan}>${c.reset} Select model (number or name): `);
  const num = parseInt(answer.trim(), 10);
  if (num >= 1 && num <= models.length) return models[num - 1];
  // Try matching by name
  const match = models.find(m => m.startsWith(answer.trim()));
  return match || models[0];
}

// ── Banner ──────────────────────────────────────────────────────────
export function printBanner(model: string, cwd: string) {
  console.log('');
  console.log(`${c.bold}${c.cyan}  ╔══════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ║${c.reset}${c.bold}         Deyad CLI Agent              ${c.cyan}║${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ║${c.reset}${c.gray}    Local AI coding · Ollama only     ${c.cyan}║${c.reset}`);
  console.log(`${c.bold}${c.cyan}  ╚══════════════════════════════════════╝${c.reset}`);
  console.log('');
  console.log(`  ${dim('Model:')} ${bold(model)}`);
  console.log(`  ${dim('Dir:')}   ${cwd}`);
  console.log(`  ${dim('Help:')}  Type ${cyan('/help')} · ${dim('Quit:')} ${cyan('/quit')} or Ctrl+C`);
  console.log('');
}

export function printHelp() {
  console.log(`
${bold('Commands:')}
  ${cyan('/help')}          Show this help
  ${cyan('/model')}         Switch Ollama model
  ${cyan('/clear')}         Clear conversation history
  ${cyan('/compact')}       Show token/message stats
  ${cyan('/diff')}          Show git diff of all changes
  ${cyan('/undo')}          Undo last agent changes (git checkout)
  ${cyan('/add <file>')}    Add a file to conversation context
  ${cyan('/drop <file>')}   Remove a file from context
  ${cyan('/run <cmd>')}     Run a shell command directly
  ${cyan('/init')}          Create a DEYAD.md memory file
  ${cyan('/resume')}        Resume last saved conversation
  ${cyan('/save')}          Save conversation to disk
  ${cyan('/quit')}          Exit

${bold('Tips:')}
  • The agent can read/write files, run commands, search your code, and fetch URLs
  • It will ask for confirmation before writing files or running commands
  • Use --print "prompt" for headless/CI mode (no REPL, exits after response)
  • Attach images: /image path/to/image.png (for multimodal models)
  • Press Ctrl+C to abort the current operation, twice to quit
  • Multi-line input: end with \\ to continue on next line
`);
}

// ── Diff formatting ─────────────────────────────────────────────────
export function formatDiff(filePath: string, diff: string): string {
  const lines = diff.split('\n');
  const colored = lines.map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) return bold(line);
    if (line.startsWith('+')) return `${c.green}${line}${c.reset}`;
    if (line.startsWith('-')) return `${c.red}${line}${c.reset}`;
    if (line.startsWith('@@')) return `${c.cyan}${line}${c.reset}`;
    return dim(line);
  });
  return `\n${dim('─── ' + filePath + ' ───')}\n${colored.join('\n')}`;
}

// ── Tool output formatting ──────────────────────────────────────────
export function formatToolStart(name: string, params: Record<string, string>): string {
  const paramStr = Object.entries(params)
    .filter(([k]) => !k.includes('content')) // don't show file content in logs
    .map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '…' : v}`)
    .join(' ');
  return `${c.magenta}▶${c.reset} ${bold(name)} ${dim(paramStr)}`;
}

export function formatToolResult(tool: string, success: boolean, output: string): string {
  const icon = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
  const preview = output.split('\n').slice(0, 5).join('\n');
  const more = output.split('\n').length > 5 ? dim(`  ... (${output.split('\n').length} lines)`) : '';
  return `${icon} ${dim(tool)}\n${gray(preview)}${more}`;
}

// ── Markdown terminal rendering ─────────────────────────────────────
/**
 * Render markdown text with ANSI terminal formatting.
 * Handles: headers, bold, italic, inline code, code blocks, lists, links, horizontal rules.
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';

  for (const line of lines) {
    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        out.push(dim('─── ' + (codeBlockLang || 'code') + ' ─────────────────────────'));
      } else {
        inCodeBlock = false;
        out.push(dim('────────────────────────────────────'));
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(`${c.gray}  ${line}${c.reset}`);
      continue;
    }

    let processed = line;

    // Headers
    if (processed.startsWith('### ')) {
      out.push(`${c.bold}${c.cyan}${processed.slice(4)}${c.reset}`);
      continue;
    }
    if (processed.startsWith('## ')) {
      out.push(`\n${c.bold}${c.blue}${processed.slice(3)}${c.reset}`);
      continue;
    }
    if (processed.startsWith('# ')) {
      out.push(`\n${c.bold}${c.magenta}${processed.slice(2)}${c.reset}`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(processed.trim()) || /^\*\*\*+$/.test(processed.trim())) {
      out.push(dim('────────────────────────────────────'));
      continue;
    }

    // Bullet lists
    if (/^\s*[-*+]\s/.test(processed)) {
      const indent = processed.match(/^(\s*)/)?.[1] || '';
      processed = processed.replace(/^(\s*)[-*+]\s/, '');
      processed = renderInline(processed);
      out.push(`${indent}${c.cyan}•${c.reset} ${processed}`);
      continue;
    }

    // Numbered lists
    if (/^\s*\d+\.\s/.test(processed)) {
      const match = processed.match(/^(\s*)(\d+)\.\s(.*)/);
      if (match) {
        const rendered = renderInline(match[3]);
        out.push(`${match[1]}${c.cyan}${match[2]}.${c.reset} ${rendered}`);
        continue;
      }
    }

    // Regular text — apply inline formatting
    out.push(renderInline(processed));
  }

  return out.join('\n');
}

/** Apply inline markdown formatting (bold, italic, code, links). */
function renderInline(text: string): string {
  let s = text;
  // Inline code (must be before bold/italic)
  s = s.replace(/`([^`]+)`/g, `${c.cyan}$1${c.reset}`);
  // Bold + italic
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, `${c.bold}${c.magenta}$1${c.reset}`);
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, `${c.bold}$1${c.reset}`);
  // Italic
  s = s.replace(/\*([^*]+)\*/g, `${c.magenta}$1${c.reset}`);
  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `$1 ${c.dim}(${c.cyan}$2${c.reset}${c.dim})${c.reset}`);
  return s;
}
