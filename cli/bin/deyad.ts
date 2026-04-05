#!/usr/bin/env node

/**
 * Deyad CLI — local AI coding agent powered by Ollama.
 *
 * Usage:
 *   deyad                    # interactive mode in current directory
 *   deyad "add a login page" # one-shot mode
 *   deyad --model codestral  # specify model
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { checkOllama, listModels } from '../src/ollama.js';
import { runAgentLoop } from '../src/agent.js';
import type { OllamaMessage } from '../src/ollama.js';
import type { AgentResult, TokenStats } from '../src/agent.js';
import { runCommand } from '../src/tools.js';
import {
  createInterface,
  prompt,
  confirm as uiConfirm,
  selectModel,
  printBanner,
  printHelp,
  formatToolStart,
  formatToolResult,
  formatDiff,
  Spinner,
  c, bold, red, green, yellow, cyan, dim, gray,
} from '../src/ui.js';

// ── Parse args ──────────────────────────────────────────────────────
function parseArgs(argv: string[]): { model?: string; message?: string; dir?: string; help?: boolean; autoConfirm?: boolean } {
  const result: { model?: string; message?: string; dir?: string; help?: boolean; autoConfirm?: boolean } = {};
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model' || arg === '-m') {
      result.model = argv[++i];
    } else if (arg === '--dir' || arg === '-d') {
      result.dir = argv[++i];
    } else if (arg === '--yes' || arg === '-y') {
      result.autoConfirm = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    result.message = positional.join(' ');
  }

  return result;
}

function printUsage() {
  console.log(`
${bold('Deyad CLI')} — Local AI coding agent powered by Ollama

${bold('Usage:')}
  deyad                          Interactive mode
  deyad "add a login page"       One-shot mode
  deyad -m codestral "fix bugs"  Specify model

${bold('Options:')}
  -m, --model <name>    Ollama model to use
  -d, --dir <path>      Project directory (default: cwd)
  -y, --yes             Auto-confirm all tool actions
  -h, --help            Show this help

${bold('Environment:')}
  OLLAMA_HOST           Ollama API URL (default: http://127.0.0.1:11434)
  DEYAD_MODEL           Default model name
`);
}

function formatTokenStats(stats: TokenStats): string {
  return dim(`[tokens: ~${stats.promptTokens.toLocaleString()} in, ~${stats.completionTokens.toLocaleString()} out, ~${stats.totalTokens.toLocaleString()} total]`);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const cwd = path.resolve(args.dir || process.cwd());
  const rl = createInterface();

  // Check Ollama
  const spinner = new Spinner();
  spinner.start('Connecting to Ollama...');
  const ollamaUp = await checkOllama();
  if (!ollamaUp) {
    spinner.stop(red('✗ Cannot connect to Ollama. Is it running?'));
    console.log(dim('  Start it with: ollama serve'));
    console.log(dim('  Or set OLLAMA_HOST if running on a different host.'));
    rl.close();
    process.exit(1);
  }
  spinner.stop(green('✓ Ollama connected'));

  // Get models
  const models = await listModels();
  if (models.length === 0) {
    console.log(red('No models found. Pull one first:'));
    console.log(dim('  ollama pull deepseek-coder-v2'));
    rl.close();
    process.exit(1);
  }

  // Select model
  let model = args.model || process.env.DEYAD_MODEL || '';
  if (!model) {
    if (models.length === 1) {
      model = models[0];
    } else {
      model = await selectModel(rl, models);
    }
  }
  // Validate model exists
  if (!models.some(m => m.startsWith(model))) {
    console.log(red(`Model "${model}" not found. Available: ${models.join(', ')}`));
    rl.close();
    process.exit(1);
  }

  printBanner(model, cwd);

  let history: OllamaMessage[] = [];
  let cumulativeStats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let allChangedFiles: string[] = [];
  /** Files explicitly added to context with /add */
  const contextFiles: string[] = [];

  // ── Confirm callback ────────────────────────────────────────────
  const confirmFn = args.autoConfirm
    ? async (_q: string) => true
    : async (question: string) => uiConfirm(rl, question);

  // ── Double Ctrl+C to quit ───────────────────────────────────────
  let lastCtrlC = 0;
  process.on('SIGINT', () => {
    const now = Date.now();
    if (now - lastCtrlC < 500) {
      console.log(dim('\nBye!'));
      process.exit(0);
    }
    lastCtrlC = now;
    console.log(dim('\n(Press Ctrl+C again to quit)'));
  });

  // ── One-shot mode ───────────────────────────────────────────────
  if (args.message) {
    await runOnce(model, args.message, cwd, history, confirmFn, contextFiles);
    rl.close();
    process.exit(0);
  }

  // ── Interactive REPL ────────────────────────────────────────────
  console.log(dim('Enter your request. Type /help for commands.\n'));

  let running = true;
  rl.on('close', () => {
    running = false;
    console.log(dim('\nBye!'));
    process.exit(0);
  });

  while (running) {
    let input: string;
    try {
      input = await prompt(rl, `${cyan('❯')} `);
    } catch {
      break;
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // ── Slash commands ──────────────────────────────────────────
    if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/q') {
      break;
    }
    if (trimmed === '/help' || trimmed === '/h') {
      printHelp();
      continue;
    }
    if (trimmed === '/clear') {
      history = [];
      allChangedFiles = [];
      cumulativeStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      console.log(green('✓ Conversation cleared.'));
      continue;
    }
    if (trimmed === '/model') {
      const newModels = await listModels();
      model = await selectModel(rl, newModels);
      console.log(green(`✓ Switched to ${model}`));
      continue;
    }
    if (trimmed === '/compact') {
      const chars = history.reduce((s, m) => s + m.content.length, 0);
      console.log(dim(`Messages: ${history.length} · Characters: ${chars.toLocaleString()}`));
      console.log(formatTokenStats(cumulativeStats));
      if (allChangedFiles.length > 0) {
        console.log(dim(`Files changed: ${allChangedFiles.join(', ')}`));
      }
      continue;
    }
    if (trimmed === '/diff') {
      try {
        const out = execSync('git diff', { cwd, encoding: 'utf-8', timeout: 5000 });
        if (out.trim()) {
          const lines = out.split('\n').map(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) return `${c.green}${line}${c.reset}`;
            if (line.startsWith('-') && !line.startsWith('---')) return `${c.red}${line}${c.reset}`;
            if (line.startsWith('@@')) return `${c.cyan}${line}${c.reset}`;
            return line;
          });
          console.log(lines.join('\n'));
        } else {
          console.log(dim('No uncommitted changes.'));
        }
      } catch {
        console.log(red('Not a git repository or git not available.'));
      }
      continue;
    }
    if (trimmed === '/undo') {
      if (allChangedFiles.length === 0) {
        console.log(dim('No files to undo.'));
        continue;
      }
      const ok = await uiConfirm(rl, `Revert ${allChangedFiles.length} file(s): ${allChangedFiles.join(', ')}?`);
      if (ok) {
        try {
          execSync(`git checkout -- ${allChangedFiles.map(f => `"${f}"`).join(' ')}`, { cwd, encoding: 'utf-8' });
          console.log(green(`✓ Reverted: ${allChangedFiles.join(', ')}`));
          allChangedFiles = [];
        } catch {
          // Try git stash as fallback
          console.log(red('✗ Failed to revert. Try git checkout manually.'));
        }
      }
      continue;
    }
    if (trimmed.startsWith('/add ')) {
      const filePath = trimmed.slice(5).trim();
      const absPath = path.resolve(cwd, filePath);
      if (!fs.existsSync(absPath)) {
        console.log(red(`File not found: ${filePath}`));
      } else if (contextFiles.includes(filePath)) {
        console.log(dim(`Already in context: ${filePath}`));
      } else {
        contextFiles.push(filePath);
        console.log(green(`✓ Added to context: ${filePath}`));
      }
      continue;
    }
    if (trimmed.startsWith('/drop ')) {
      const filePath = trimmed.slice(6).trim();
      const idx = contextFiles.indexOf(filePath);
      if (idx === -1) {
        console.log(dim(`Not in context: ${filePath}`));
      } else {
        contextFiles.splice(idx, 1);
        console.log(green(`✓ Dropped from context: ${filePath}`));
      }
      continue;
    }
    if (trimmed.startsWith('/run ')) {
      const cmd = trimmed.slice(5).trim();
      if (!cmd) { console.log(dim('Usage: /run <command>')); continue; }
      const result = await runCommand(cmd, cwd);
      console.log(result.success ? result.output : red(result.output));
      continue;
    }

    // Handle multi-line input (lines ending with \)
    let fullInput = trimmed;
    while (fullInput.endsWith('\\')) {
      fullInput = fullInput.slice(0, -1) + '\n';
      const next = await prompt(rl, `${dim('…')} `);
      fullInput += next;
    }

    // Prepend context files to the message
    let contextPrefix = '';
    if (contextFiles.length > 0) {
      const fileContents: string[] = [];
      for (const f of contextFiles) {
        try {
          const content = fs.readFileSync(path.resolve(cwd, f), 'utf-8');
          const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n... (truncated)' : content;
          fileContents.push(`--- ${f} ---\n${truncated}`);
        } catch { /* skip unreadable */ }
      }
      if (fileContents.length > 0) {
        contextPrefix = `The user has added these files to context:\n\n${fileContents.join('\n\n')}\n\n`;
      }
    }

    const result = await runOnce(model, contextPrefix + fullInput, cwd, history, confirmFn, contextFiles);
    history = result.history;
    cumulativeStats.promptTokens += result.stats.promptTokens;
    cumulativeStats.completionTokens += result.stats.completionTokens;
    cumulativeStats.totalTokens += result.stats.totalTokens;
    for (const f of result.changedFiles) {
      if (!allChangedFiles.includes(f)) allChangedFiles.push(f);
    }

    // Show token stats after each turn
    console.log(formatTokenStats(cumulativeStats));

    // Offer auto-commit if files changed
    if (result.changedFiles.length > 0) {
      console.log(dim(`  Changed: ${result.changedFiles.join(', ')}`));
    }
  }

  rl.close();
  console.log(dim('\nBye!'));
}

async function runOnce(
  model: string,
  message: string,
  cwd: string,
  history: OllamaMessage[],
  confirmFn: (q: string) => Promise<boolean>,
  _contextFiles: string[],
): Promise<AgentResult> {
  console.log(''); // blank line before response

  let currentLine = '';
  let inToolBlock = false;
  let inThinkBlock = false;

  const result = await runAgentLoop(model, message, cwd, {
    onToken: (token: string) => {
      currentLine += token;

      // Show <think> blocks in dimmed style
      if (currentLine.includes('<think>')) {
        inThinkBlock = true;
        // Print what came before <think>
        const before = currentLine.split('<think>')[0];
        if (before && !inToolBlock) process.stdout.write(before);
        currentLine = currentLine.split('<think>').slice(1).join('<think>');
      }
      if (inThinkBlock) {
        if (currentLine.includes('</think>')) {
          // Print the thinking content dimmed
          const thinkContent = currentLine.split('</think>')[0];
          if (thinkContent.trim()) {
            process.stdout.write(`${c.dim}${thinkContent}${c.reset}`);
          }
          process.stdout.write('\n');
          inThinkBlock = false;
          currentLine = currentLine.split('</think>').slice(1).join('</think>');
          return;
        }
        // Stream thinking tokens dimmed
        process.stdout.write(`${c.dim}${token}${c.reset}`);
        return;
      }

      // Don't print tool XML to the user
      if (currentLine.includes('<tool_call>')) { inToolBlock = true; }
      if (!inToolBlock && !inThinkBlock) {
        process.stdout.write(token);
      }
      if (currentLine.includes('</tool_call>') || currentLine.includes('<done')) {
        inToolBlock = false;
        currentLine = '';
      }
    },
    onToolStart: (name, params) => {
      console.log(`\n${formatToolStart(name, params)}`);
    },
    onToolResult: (result) => {
      console.log(formatToolResult(result.tool, result.success, result.output));
      console.log(''); // spacing
    },
    onDiff: (filePath, diff) => {
      console.log(formatDiff(filePath, diff));
    },
    onDone: (_summary) => {
      console.log(`\n${green('✓ Done')}\n`);
    },
    onError: (error) => {
      console.log(`\n${red('✗ ' + error)}\n`);
    },
    confirm: confirmFn,
  }, history);

  return result;
}

main().catch((err: Error) => {
  console.error(red(`Fatal: ${err.message}`));
  process.exit(1);
});
