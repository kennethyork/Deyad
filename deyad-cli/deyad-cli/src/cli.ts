#!/usr/bin/env node
import 'dotenv/config';

import * as readline from 'node:readline';
import * as path from 'node:path';
import { checkOllama, listModels } from './ollama.js';
import type { OllamaMessage } from './ollama.js';
import { runAgentLoop } from './agent.js';
import type { AgentCallbacks } from './agent.js';
import { loadOrCreateSession, saveSession, pruneSessions, memoryList } from './session.js';
import { createSnapshot, undoLast, getSnapshots } from './undo.js';
import { enterSandbox, exitSandbox, isSandboxed } from './sandbox.js';
import { buildIndex, getIndexStats } from './rag.js';
import {
  c, divider, Spinner,
  printBanner, formatToolStart, formatToolEnd, formatDiff,
  formatConfirm, formatStatus, formatHelp, formatError,
  formatSuccess, formatTokenBadge, getPrompt,
} from './tui.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
const VERSION = pkg.version;

function printUsage(): void {
  console.log(`
  ${c.brandBold('Deyad CLI')} ${c.dim('v' + VERSION)} — local AI coding agent powered by Ollama

  ${c.bold('Usage')}
    ${c.cyan('$ deyad')}                          Interactive chat mode
    ${c.cyan('$ deyad "add a login page"')}       One-shot task mode
    ${c.cyan('$ deyad --model codestral')}        Specify model
    ${c.cyan('$ deyad --print "explain this"')}   Print response and exit
    ${c.cyan('$ deyad --auto "refactor utils"')}  Full-auto sandbox mode
    ${c.cyan('$ deyad --resume')}                 Resume last session

  ${c.bold('Options')}
    ${c.yellow('-h, --help')}             Show this help
    ${c.yellow('-m, --model <model>')}    Ollama model (default: DEYAD_MODEL env or first available)
    ${c.yellow('-p, --print <prompt>')}   Run prompt non-interactively and print result
    ${c.yellow('-a, --auto')}             Full-auto mode (sandbox + no confirmations)
    ${c.yellow('--resume')}               Resume the most recent session for this directory
    ${c.yellow('--completions <shell>')}  Output shell completion script (bash, zsh, fish)
    ${c.yellow('-v, --version')}          Show version
`);
}

function generateCompletions(shell: string): string {
  switch (shell) {
    case 'bash':
      return `# deyad bash completions — add to ~/.bashrc
_deyad_completions() {
  local cur opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  opts="-h --help -v --version -m --model -p --print -a --auto --resume --no-resume --completions"
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
}
complete -F _deyad_completions deyad`;
    case 'zsh':
      return `# deyad zsh completions — add to ~/.zshrc
_deyad() {
  _arguments \\
    '-h[Show help]' '--help[Show help]' \\
    '-v[Show version]' '--version[Show version]' \\
    '-m[Specify model]:model:' '--model[Specify model]:model:' \\
    '-p[Print mode]:prompt:' '--print[Print mode]:prompt:' \\
    '-a[Full-auto mode]' '--auto[Full-auto mode]' \\
    '--resume[Resume last session]' \\
    '--no-resume[Start fresh session]' \\
    '--completions[Output completions]:shell:(bash zsh fish)' \\
    '*:prompt:'
}
compdef _deyad deyad`;
    case 'fish':
      return `# deyad fish completions — save to ~/.config/fish/completions/deyad.fish
complete -c deyad -s h -l help -d 'Show help'
complete -c deyad -s v -l version -d 'Show version'
complete -c deyad -s m -l model -r -d 'Specify model'
complete -c deyad -s p -l print -r -d 'Print mode'
complete -c deyad -s a -l auto -d 'Full-auto mode'
complete -c deyad -l resume -d 'Resume last session'
complete -c deyad -l no-resume -d 'Start fresh session'
complete -c deyad -l completions -r -a 'bash zsh fish' -d 'Output completions'`;
    default:
      return `Unknown shell: ${shell}. Supported: bash, zsh, fish`;
  }
}

interface ParsedArgs {
  help: boolean;
  version: boolean;
  completions: string | undefined;
  model: string | undefined;
  print: string | undefined;
  prompt: string | undefined;
  auto: boolean;
  resume: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    help: false,
    version: false,
    completions: undefined,
    model: undefined,
    print: undefined,
    prompt: undefined,
    auto: false,
    resume: true,
  };
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '-v' || arg === '--version') {
      args.version = true;
    } else if (arg === '--completions') {
      i++;
      args.completions = argv[i];
    } else if (arg === '-m' || arg === '--model') {
      i++;
      args.model = argv[i];
    } else if (arg === '-p' || arg === '--print') {
      i++;
      args.print = argv[i];
    } else if (arg === '-a' || arg === '--auto') {
      args.auto = true;
    } else if (arg === '--resume') {
      args.resume = true;
    } else if (arg === '--no-resume') {
      args.resume = false;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
    i++;
  }
  if (positional.length > 0) {
    args.prompt = positional.join(' ');
  }
  return args;
}

export async function runOnce(
  model: string,
  prompt: string,
  cwd: string,
  silent: boolean,
): Promise<void> {
  const spinner = new Spinner('Thinking...');
  let spinnerActive = false;

  const callbacks: AgentCallbacks = {
    onToken: (t) => {
      if (spinnerActive) { spinner.stop(); spinnerActive = false; }
      if (!silent) process.stdout.write(t);
    },
    onThinkingToken: (_t) => {
      // Show spinner while model is thinking (don't print thinking tokens)
      if (!spinnerActive && !silent) {
        spinner.update('Reasoning...');
        spinner.start();
        spinnerActive = true;
      }
    },
    onToolStart: (name, params) => {
      if (spinnerActive) { spinner.stop(); spinnerActive = false; }
      if (!silent) console.log('\n' + formatToolStart(name, params));
    },
    onToolResult: (r) => {
      console.log(formatToolEnd(r.tool, r.success, r.output));
      if (!silent) {
        spinner.update('Thinking...');
        spinner.start();
        spinnerActive = true;
      }
    },
    onDiff: () => {},
    onDone: (summary) => {
      if (spinnerActive) { spinner.stop(); spinnerActive = false; }
      if (silent && summary) console.log(summary);
      if (!silent) console.log('');
    },
    onError: (e) => {
      if (spinnerActive) { spinner.stop(); spinnerActive = false; }
      console.error(formatError(e));
    },
    confirm: async () => true,
  };

  if (!silent) { spinner.start(); spinnerActive = true; }
  await runAgentLoop(model, prompt, cwd, callbacks);
  if (spinnerActive) { spinner.stop(); spinnerActive = false; }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }
  if (args.version) {
    console.log(`deyad ${VERSION}`);
    process.exit(0);
  }
  if (args.completions) {
    console.log(generateCompletions(args.completions));
    process.exit(0);
  }

  const ok = await checkOllama();
  if (!ok) {
    console.error(formatError('Cannot connect to Ollama. Is it running? (ollama serve)'));
    process.exit(1);
  }

  const models = await listModels();
  if (models.length === 0) {
    console.error(formatError('No Ollama models found. Pull one first: ollama pull llama3.2'));
    process.exit(1);
  }

  let model: string = args.model ?? process.env['DEYAD_MODEL'] ?? models[0]!;
  if (!models.includes(model)) {
    console.error(formatError(`Model "${model}" not found. Available: ${models.join(', ')}`));
    process.exit(1);
  }

  const cwd = process.cwd();

  // --print mode: run once and exit
  const printPrompt = args.print;
  if (printPrompt !== undefined) {
    await runOnce(model, printPrompt, cwd, true);
    process.exit(0);
  }

  // --auto mode: enter sandbox, run task, prompt to merge or discard
  if (args.auto && args.prompt) {
    console.log('');
    console.log(`  ${c.brandBold('Deyad')} ${c.dim('v' + VERSION)} ${c.dim('\u00b7')} ${c.yellow('full-auto sandbox')}`);
    const sbResult = enterSandbox(cwd);
    if (!sbResult.success) {
      console.error(formatError(sbResult.message));
      process.exit(1);
    }
    console.log(formatSuccess(sbResult.message));
    console.log(divider());
    console.log('');

    const autoSpinner = new Spinner('Working...');
    let autoSpinnerActive = false;

    const autoCallbacks: AgentCallbacks = {
      onToken: (t) => {
        if (autoSpinnerActive) { autoSpinner.stop(); autoSpinnerActive = false; }
        process.stdout.write(t);
      },
      onToolStart: (name, params) => {
        if (autoSpinnerActive) { autoSpinner.stop(); autoSpinnerActive = false; }
        console.log('\n' + formatToolStart(name, params));
      },
      onToolResult: (r) => {
        console.log(formatToolEnd(r.tool, r.success, r.output));
        autoSpinner.update('Working...');
        autoSpinner.start();
        autoSpinnerActive = true;
      },
      onDiff: () => {},
      onDone: () => {
        if (autoSpinnerActive) { autoSpinner.stop(); autoSpinnerActive = false; }
        console.log('');
      },
      onError: (e) => {
        if (autoSpinnerActive) { autoSpinner.stop(); autoSpinnerActive = false; }
        console.error(formatError(e));
      },
      confirm: async () => true,
    };

    autoSpinner.start(); autoSpinnerActive = true;
    await runAgentLoop(model, args.prompt, cwd, autoCallbacks);
    if (autoSpinnerActive) { autoSpinner.stop(); autoSpinnerActive = false; }

    console.log('');
    console.log(divider('Sandbox Complete'));
    console.log('');

    const autoRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    autoRl.question(formatConfirm('Merge changes into your branch?'), (answer) => {
      const merge = answer.trim().toLowerCase().startsWith('y');
      const result = exitSandbox(cwd, merge);
      if (result.diff) {
        console.log(c.dim(result.diff));
      }
      console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
      autoRl.close();
      process.exit(0);
    });
    return;
  }

  // One-shot prompt mode
  if (args.prompt) {
    await runOnce(model, args.prompt, cwd, false);
    process.exit(0);
  }

  // ── Interactive REPL ──
  // Load or create session
  let session = loadOrCreateSession(cwd, model);
  if (args.resume && session.history.length > 0) {
    console.log(c.dim(`  Resuming session ${session.id} (${session.taskCount} tasks, ${session.history.length} messages)`));
  }
  pruneSessions();

  printBanner(VERSION, model, cwd, isSandboxed());

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history: OllamaMessage[] = args.resume ? session.history : [];
  let totalTokens = args.resume ? session.totalTokens : 0;
  let taskCount = args.resume ? session.taskCount : 0;

  const ask = (): void => {
    rl.question(getPrompt(isSandboxed()), async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input === 'exit' || input === 'quit') {
        // Save session on exit
        session.history = history;
        session.totalTokens = totalTokens;
        session.taskCount = taskCount;
        session.model = model;
        saveSession(session);
        console.log('');
        console.log(divider());
        console.log(c.dim(`  Session saved: ${session.id}`));
        console.log(formatStatus(model, taskCount, totalTokens, isSandboxed()));
        console.log(c.dim('  Goodbye!'));
        console.log('');
        rl.close();
        process.exit(0);
      }
      if (input === '/help') {
        console.log(formatHelp());
        ask();
        return;
      }
      if (input === '/clear') {
        history = [];
        console.log(formatSuccess('History cleared.'));
        ask();
        return;
      }
      if (input === '/status') {
        console.log('');
        console.log(formatStatus(model, taskCount, totalTokens, isSandboxed()));
        console.log(c.dim(`  history: ${history.length} messages · session: ${session.id}`));
        console.log('');
        ask();
        return;
      }
      if (input === '/models') {
        console.log('');
        console.log(`  ${c.bold('Models')}`);
        models.forEach((m) => {
          const marker = m === model ? c.green('● ') : c.dim('○ ');
          console.log(`  ${marker}${m === model ? c.yellow(m) : m}`);
        });
        console.log('');
        ask();
        return;
      }
      if (input === '/compact') {
        const before = history.length;
        if (history.length > 10) {
          const keep = history.slice(-10);
          history = [{ role: 'system' as const, content: `[Earlier conversation compacted — ${before - 10} messages summarized]` }, ...keep];
        }
        console.log(formatSuccess(`Compacted: ${before} → ${history.length} messages`));
        ask();
        return;
      }
      if (input.startsWith('/model ')) {
        const newModel = input.slice(7).trim();
        if (models.includes(newModel)) {
          model = newModel;
          console.log(formatSuccess(`Switched to model: ${c.yellow(model)}`));
        } else {
          console.log(formatError(`Model "${newModel}" not found. Available: ${models.join(', ')}`));
        }
        ask();
        return;
      }

      // ── Undo commands ──
      if (input === '/undo') {
        const result = undoLast(cwd);
        console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
        ask();
        return;
      }
      if (input === '/snapshots') {
        const snaps = getSnapshots();
        if (snaps.length === 0) {
          console.log(c.dim('  No snapshots yet. Snapshots are created before each task.'));
        } else {
          console.log('');
          console.log(`  ${c.bold('Snapshots')}`);
          snaps.forEach((s, i) => {
            console.log(`  ${c.dim(String(i + 1) + '.')} ${c.cyan(s.ref.slice(0, 8))} ${c.dim('—')} ${s.description} ${c.dim(s.timestamp)}`);
          });
          console.log('');
        }
        ask();
        return;
      }

      // ── Sandbox commands ──
      if (input === '/sandbox start' || input === '/sandbox') {
        const result = enterSandbox(cwd);
        console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
        ask();
        return;
      }
      if (input === '/sandbox merge') {
        const result = exitSandbox(cwd, true);
        if (result.diff) console.log(c.dim(result.diff));
        console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
        ask();
        return;
      }
      if (input === '/sandbox discard') {
        const result = exitSandbox(cwd, false);
        if (result.diff) console.log(c.dim(result.diff));
        console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
        ask();
        return;
      }

      // ── Session commands ──
      if (input === '/sessions') {
        const { listSessions } = await import('./session.js');
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log(c.dim('  No saved sessions.'));
        } else {
          console.log('');
          console.log(`  ${c.bold('Sessions')}`);
          sessions.slice(0, 10).forEach((s) => {
            console.log(`  ${c.cyan(s.id)} ${c.dim('—')} ${s.cwd} ${c.dim(`(${s.taskCount} tasks, ${s.updatedAt})`)}`);
          });
          console.log('');
        }
        ask();
        return;
      }
      if (input === '/memory') {
        const entries = memoryList();
        if (entries.length === 0) {
          console.log(c.dim('  No memory entries. The agent can store notes with memory_write.'));
        } else {
          console.log('');
          console.log(`  ${c.bold('Memory')}`);
          entries.forEach((e) => {
            console.log(`  ${c.cyan(e.key)} ${c.dim('—')} ${e.value.slice(0, 80)}${e.value.length > 80 ? '…' : ''}`);
          });
          console.log('');
        }
        ask();
        return;
      }

      // ── Diff command ──
      if (input === '/diff') {
        try {
          const { execFileSync } = await import('node:child_process');
          const diff = execFileSync('git', ['diff'], { cwd, encoding: 'utf-8', timeout: 10000 });
          if (diff.trim()) {
            console.log('');
            console.log(`  ${c.bold('Unstaged Changes')}`);
            console.log(c.dim(diff));
          } else {
            const staged = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf-8', timeout: 10000 });
            if (staged.trim()) {
              console.log('');
              console.log(`  ${c.bold('Staged Changes')}`);
              console.log(c.dim(staged));
            } else {
              console.log(c.dim('  No changes detected.'));
            }
          }
        } catch (e) {
          console.log(formatError('Not a git repository or git not available.'));
        }
        ask();
        return;
      }

      // ── Tokens command ──
      if (input === '/tokens') {
        console.log('');
        console.log(`  ${c.bold('Token Usage')}`);
        console.log(`  ${c.cyan('Total tokens:')}  ${c.yellow(String(totalTokens))}`);
        console.log(`  ${c.cyan('Tasks run:')}     ${c.yellow(String(taskCount))}`);
        if (taskCount > 0) {
          console.log(`  ${c.cyan('Avg per task:')}  ${c.yellow(String(Math.round(totalTokens / taskCount)))}`);
        }
        console.log(`  ${c.cyan('Messages:')}      ${c.yellow(String(history.length))}`);
        console.log('');
        ask();
        return;
      }

      // ── Index command (RAG) ──
      if (input === '/index') {
        console.log('');
        const spinner = new Spinner('Indexing codebase...');
        spinner.start();
        buildIndex(cwd, true);
        spinner.stop();
        const stats = getIndexStats(cwd);
        if (stats) {
          console.log(formatSuccess(`Indexed ${stats.files} files → ${stats.chunks} chunks`));
        } else {
          console.log(formatError('Failed to build index.'));
        }
        console.log('');
        ask();
        return;
      }

      // ── Init command ──
      if (input === '/init') {
        const { existsSync, writeFileSync } = await import('node:fs');
        const deyadMd = path.join(cwd, 'DEYAD.md');
        if (existsSync(deyadMd)) {
          console.log(c.dim('  DEYAD.md already exists.'));
        } else {
          const template = `# Project Instructions for Deyad

<!-- Deyad reads this file before every task. Add project-specific instructions here. -->

## Project Overview
<!-- Describe what this project does -->

## Tech Stack
<!-- e.g., TypeScript, React, Node.js, Python, Rust -->

## Conventions
<!-- Coding conventions, naming patterns, file structure rules -->

## Build & Test
<!-- How to build, test, and run this project -->
\`\`\`bash
# npm run build
# npm test
\`\`\`

## Important Notes
<!-- Anything the agent should know: gotchas, restrictions, preferences -->
`;
          writeFileSync(deyadMd, template, 'utf-8');
          console.log(formatSuccess('Created DEYAD.md — edit it to give the agent project-specific instructions.'));
        }
        ask();
        return;
      }

      // ── Create snapshot before task, then run agent ──
      createSnapshot(cwd, `before task: ${input.slice(0, 50)}`);

      const callbacks: AgentCallbacks = {
        onToken: (t) => process.stdout.write(t),
        onThinkingToken: () => {
          // Reasoning models think silently — user sees streamed content tokens
        },
        onToolStart: (name, params) => {
          console.log('');
          console.log(formatToolStart(name, params));
        },
        onToolResult: (r) => {
          console.log(formatToolEnd(r.tool, r.success, r.output));
        },
        onDiff: (path, diff) => {
          console.log(formatDiff(path, diff));
        },
        onDone: () => { console.log(''); },
        onError: (e) => console.error(formatError(String(e))),
        confirm: async (question) => {
          return new Promise((resolve) => {
            rl.question(formatConfirm(question), (answer) => {
              resolve(answer.trim().toLowerCase().startsWith('y'));
            });
          });
        },
      };

      try {
        const result = await runAgentLoop(model, input, cwd, callbacks, history);
        history = result.history;
        totalTokens += result.stats.totalTokens;
        taskCount++;
        console.log(formatTokenBadge(result.stats.totalTokens));

        // Auto-save session after each task
        session.history = history;
        session.totalTokens = totalTokens;
        session.taskCount = taskCount;
        session.model = model;
        saveSession(session);
      } catch (err) {
        console.error(formatError(String(err)));
      }
      ask();
    });
  };

  ask();
}

import { realpathSync } from 'node:fs';

function checkIsMain(): boolean {
  if (!process.argv[1]) return false;
  const scriptPath = process.argv[1].replace(/\\/g, '/');
  // Direct match (node dist/cli.js)
  if (import.meta.url.endsWith(scriptPath)) return true;
  // Resolve symlinks (global npm install creates a symlink)
  try {
    const resolved = realpathSync(scriptPath).replace(/\\/g, '/');
    if (import.meta.url.endsWith(resolved)) return true;
  } catch { /* ignore */ }
  return false;
}

if (checkIsMain()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
