#!/usr/bin/env node
import 'dotenv/config';

import * as readline from 'node:readline';
import { checkOllama, listModels } from './ollama.js';
import type { OllamaMessage } from './ollama.js';
import { runAgentLoop } from './agent.js';
import type { AgentCallbacks } from './agent.js';
import { loadOrCreateSession, saveSession, pruneSessions, memoryList } from './session.js';
import type { SessionData } from './session.js';
import { createSnapshot, undoLast, getSnapshots, diffFromSnapshot } from './undo.js';
import { enterSandbox, exitSandbox, isSandboxed } from './sandbox.js';

const VERSION = '0.1.31';

function printUsage(): void {
  console.log(`
  Deyad CLI v${VERSION} — local AI coding agent powered by Ollama

  Usage
    $ deyad                          Interactive chat mode
    $ deyad "add a login page"       One-shot task mode
    $ deyad --model codestral        Specify model
    $ deyad --print "explain this"   Print response and exit
    $ deyad --auto "refactor utils"  Full-auto sandbox mode
    $ deyad --resume                 Resume last session

  Options
    -h, --help             Show this help
    -m, --model <model>    Ollama model (default: DEYAD_MODEL env or first available)
    -p, --print <prompt>   Run prompt non-interactively and print result
    -a, --auto             Full-auto mode (sandbox + no confirmations)
    --resume               Resume the most recent session for this directory
    -v, --version          Show version
`);
}

interface ParsedArgs {
  help: boolean;
  version: boolean;
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
    model: undefined,
    print: undefined,
    prompt: undefined,
    auto: false,
    resume: false,
  };
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '-v' || arg === '--version') {
      args.version = true;
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

async function runOnce(
  model: string,
  prompt: string,
  cwd: string,
  silent: boolean,
): Promise<void> {
  const callbacks: AgentCallbacks = {
    onToken: (t) => { if (!silent) process.stdout.write(t); },
    onToolStart: (name, params) => {
      if (!silent) console.log(`\n\x1b[36m> ${name}\x1b[0m`, Object.keys(params).length ? params : '');
    },
    onToolResult: (r) => {
      if (!silent) {
        const tag = r.success ? '\x1b[32m\u2713\x1b[0m' : '\x1b[31m\u2717\x1b[0m';
        console.log(`${tag} ${r.tool}: ${r.output.slice(0, 200)}`);
      }
    },
    onDiff: () => {},
    onDone: (summary) => {
      if (silent && summary) console.log(summary);
      if (!silent) console.log('');
    },
    onError: (e) => console.error(`\x1b[31mError: ${e}\x1b[0m`),
    confirm: async () => true,
  };
  await runAgentLoop(model, prompt, cwd, callbacks);
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

  const ok = await checkOllama();
  if (!ok) {
    console.error('\x1b[31mCannot connect to Ollama. Is it running? (ollama serve)\x1b[0m');
    process.exit(1);
  }

  const models = await listModels();
  if (models.length === 0) {
    console.error('\x1b[31mNo Ollama models found. Pull one first: ollama pull llama3.2\x1b[0m');
    process.exit(1);
  }

  let model: string = args.model ?? process.env['DEYAD_MODEL'] ?? models[0]!;
  if (!models.includes(model)) {
    console.error(`\x1b[31mModel "${model}" not found. Available: ${models.join(', ')}\x1b[0m`);
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
    console.log(`\x1b[1m\x1b[36mDeyad CLI v${VERSION}\x1b[0m \u2014 \x1b[33mfull-auto sandbox\x1b[0m`);
    const sbResult = enterSandbox(cwd);
    if (!sbResult.success) {
      console.error(`\x1b[31m${sbResult.message}\x1b[0m`);
      process.exit(1);
    }
    console.log(`\x1b[32m${sbResult.message}\x1b[0m\n`);

    const autoCallbacks: AgentCallbacks = {
      onToken: (t) => process.stdout.write(t),
      onToolStart: (name, params) => {
        const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '\u2026' : v}`).join(' ');
        console.log(`\n  \x1b[36m\u26A1 ${name}\x1b[0m ${paramStr ? '\x1b[2m' + paramStr + '\x1b[0m' : ''}`);
      },
      onToolResult: (r) => {
        const tag = r.success ? '\x1b[32m\u2713\x1b[0m' : '\x1b[31m\u2717\x1b[0m';
        const preview = r.output.split('\n')[0]?.slice(0, 120) || '';
        console.log(`  ${tag} ${r.tool}${preview ? ': ' + preview : ''}`);
      },
      onDiff: () => {},
      onDone: () => { console.log(''); },
      onError: (e) => console.error(`\x1b[31mError: ${e}\x1b[0m`),
      confirm: async () => true, // auto-approve everything in sandbox
    };

    await runAgentLoop(model, args.prompt, cwd, autoCallbacks);
    console.log('\n\x1b[1mSandbox complete.\x1b[0m Review the changes:');

    const autoRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    autoRl.question('\x1b[33mMerge changes? (y/n) \x1b[0m', (answer) => {
      const merge = answer.trim().toLowerCase().startsWith('y');
      const result = exitSandbox(cwd, merge);
      if (result.diff) {
        console.log(`\x1b[2m${result.diff}\x1b[0m`);
      }
      console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
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

  // \u2500\u2500 Interactive REPL \u2500\u2500
  // Load or create session
  let session = loadOrCreateSession(cwd, model);
  if (args.resume && session.history.length > 0) {
    console.log(`\x1b[2mResuming session ${session.id} (${session.taskCount} tasks, ${session.history.length} messages)\x1b[0m`);
  }
  pruneSessions();

  console.log(`\x1b[1m\x1b[36mDeyad CLI v${VERSION}\x1b[0m \u2014 model: \x1b[33m${model}\x1b[0m`);
  console.log(`Working in: ${cwd}`);
  if (isSandboxed()) console.log(`\x1b[33m\u26A0 Sandbox mode active\x1b[0m`);
  console.log('Commands: /help /undo /sandbox /sessions /model <name> /clear /status | "exit" to quit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history: OllamaMessage[] = args.resume ? session.history : [];
  let totalTokens = args.resume ? session.totalTokens : 0;
  let taskCount = args.resume ? session.taskCount : 0;

  const ask = (): void => {
    rl.question('\x1b[1mdeyad>\x1b[0m ', async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input === 'exit' || input === 'quit') {
        // Save session on exit
        session.history = history;
        session.totalTokens = totalTokens;
        session.taskCount = taskCount;
        session.model = model;
        saveSession(session);
        console.log(`Session saved: ${session.id}`);
        console.log(`Session: ${taskCount} tasks, ~${totalTokens.toLocaleString()} tokens used.`);
        console.log('Bye!');
        rl.close();
        process.exit(0);
      }
      if (input === '/help') {
        console.log(`
  \x1b[1mDeyad CLI Commands:\x1b[0m
    /model <name>    Switch Ollama model
    /models          List available models
    /clear           Clear conversation history
    /status          Show session stats
    /compact         Force conversation compaction
    /undo            Undo last agent task (git rollback)
    /snapshots       List available undo points
    /sandbox start   Enter sandbox mode (temp git branch)
    /sandbox merge   Merge sandbox changes back
    /sandbox discard Discard sandbox changes
    /sessions        List saved sessions
    /memory          List persistent memory notes
    exit             Quit
  
  \x1b[1mProject Instructions:\x1b[0m
    Create a DEYAD.md file in your project root with instructions
    that Deyad will follow for every task.
`);
        ask();
        return;
      }
      if (input === '/clear') {
        history = [];
        console.log('History cleared.');
        ask();
        return;
      }
      if (input === '/status') {
        console.log(`Model: ${model}`);
        console.log(`Tasks completed: ${taskCount}`);
        console.log(`Tokens used: ~${totalTokens.toLocaleString()}`);
        console.log(`History messages: ${history.length}`);
        ask();
        return;
      }
      if (input === '/models') {
        console.log(`Available models: ${models.join(', ')}`);
        console.log(`Current: ${model}`);
        ask();
        return;
      }
      if (input === '/compact') {
        const before = history.length;
        // Trigger compaction by shortening history
        if (history.length > 10) {
          const keep = history.slice(-10);
          history = [{ role: 'system' as const, content: `[Earlier conversation compacted — ${before - 10} messages summarized]` }, ...keep];
        }
        console.log(`Compacted: ${before} → ${history.length} messages`);
        ask();
        return;
      }
      if (input.startsWith('/model ')) {
        const newModel = input.slice(7).trim();
        if (models.includes(newModel)) {
          model = newModel;
          console.log(`Switched to model: ${model}`);
        } else {
          console.log(`Model not found. Available: ${models.join(', ')}`);
        }
        ask();
        return;
      }

      // ── Undo commands ──
      if (input === '/undo') {
        const result = undoLast(cwd);
        console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
        ask();
        return;
      }
      if (input === '/snapshots') {
        const snaps = getSnapshots();
        if (snaps.length === 0) {
          console.log('No snapshots yet. Snapshots are created before each task.');
        } else {
          snaps.forEach((s, i) => {
            console.log(`  ${i + 1}. ${s.ref.slice(0, 8)} — ${s.description} (${s.timestamp})`);
          });
        }
        ask();
        return;
      }

      // ── Sandbox commands ──
      if (input === '/sandbox start' || input === '/sandbox') {
        const result = enterSandbox(cwd);
        console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
        ask();
        return;
      }
      if (input === '/sandbox merge') {
        const result = exitSandbox(cwd, true);
        if (result.diff) console.log(`\x1b[2m${result.diff}\x1b[0m`);
        console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
        ask();
        return;
      }
      if (input === '/sandbox discard') {
        const result = exitSandbox(cwd, false);
        if (result.diff) console.log(`\x1b[2m${result.diff}\x1b[0m`);
        console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
        ask();
        return;
      }

      // ── Session commands ──
      if (input === '/sessions') {
        const { listSessions } = await import('./session.js');
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log('No saved sessions.');
        } else {
          sessions.slice(0, 10).forEach((s) => {
            console.log(`  ${s.id} — ${s.cwd} (${s.taskCount} tasks, ${s.updatedAt})`);
          });
        }
        ask();
        return;
      }
      if (input === '/memory') {
        const entries = memoryList();
        if (entries.length === 0) {
          console.log('No memory entries. The agent can store notes with memory_write.');
        } else {
          entries.forEach((e) => {
            console.log(`  \x1b[1m${e.key}\x1b[0m: ${e.value.slice(0, 80)}${e.value.length > 80 ? '…' : ''}`);
          });
        }
        ask();
        return;
      }

      // ── Create snapshot before task, then run agent ──
      createSnapshot(cwd, `before task: ${input.slice(0, 50)}`);

      const callbacks: AgentCallbacks = {
        onToken: (t) => process.stdout.write(t),
        onToolStart: (name, params) => {
          const paramStr = Object.entries(params).map(([k, v]) => `${k}=${v.length > 60 ? v.slice(0, 60) + '…' : v}`).join(' ');
          console.log(`\n  \x1b[36m⚡ ${name}\x1b[0m ${paramStr ? '\x1b[2m' + paramStr + '\x1b[0m' : ''}`);
        },
        onToolResult: (r) => {
          const tag = r.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
          const preview = r.output.split('\n')[0]?.slice(0, 120) || '';
          console.log(`  ${tag} ${r.tool}${preview ? ': ' + preview : ''}`);
        },
        onDiff: (_path, diff) => {
          const lines = diff.split('\n').slice(0, 15);
          console.log(`\x1b[33m${lines.join('\n')}\x1b[0m${diff.split('\n').length > 15 ? '\n  ... (diff truncated)' : ''}`);
        },
        onDone: () => { console.log(''); },
        onError: (e) => console.error(`\x1b[31mError: ${e}\x1b[0m`),
        confirm: async (question) => {
          return new Promise((resolve) => {
            rl.question(`\x1b[33m${question}\x1b[0m (y/n) `, (answer) => {
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
        console.log(`\x1b[2m  [~${result.stats.totalTokens.toLocaleString()} tokens]\x1b[0m`);

        // Auto-save session after each task
        session.history = history;
        session.totalTokens = totalTokens;
        session.taskCount = taskCount;
        session.model = model;
        saveSession(session);
      } catch (err) {
        console.error(`\x1b[31m${String(err)}\x1b[0m`);
      }
      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
