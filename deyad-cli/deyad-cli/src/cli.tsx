#!/usr/bin/env node
import 'dotenv/config';

import * as readline from 'node:readline';
import { checkOllama, listModels } from './ollama.js';
import type { OllamaMessage } from './ollama.js';
import { runAgentLoop } from './agent.js';
import type { AgentCallbacks } from './agent.js';

const VERSION = '0.1.31';

function printUsage(): void {
  console.log(`
  Deyad CLI v${VERSION} — local AI coding agent powered by Ollama

  Usage
    $ deyad                          Interactive chat mode
    $ deyad "add a login page"       One-shot task mode
    $ deyad --model codestral        Specify model
    $ deyad --print "explain this"   Print response and exit

  Options
    -h, --help             Show this help
    -m, --model <model>    Ollama model (default: DEYAD_MODEL env or first available)
    -p, --print <prompt>   Run prompt non-interactively and print result
    -v, --version          Show version
`);
}

interface ParsedArgs {
  help: boolean;
  version: boolean;
  model: string | undefined;
  print: string | undefined;
  prompt: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    help: false,
    version: false,
    model: undefined,
    print: undefined,
    prompt: undefined,
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

  // One-shot prompt mode
  if (args.prompt) {
    await runOnce(model, args.prompt, cwd, false);
    process.exit(0);
  }

  // Interactive REPL
  console.log(`\x1b[1m\x1b[36mDeyad CLI v${VERSION}\x1b[0m \u2014 model: \x1b[33m${model}\x1b[0m`);
  console.log(`Working in: ${cwd}`);
  console.log('Type your request or "exit" to quit.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let history: OllamaMessage[] = [];

  const ask = (): void => {
    rl.question('\x1b[1mdeyad>\x1b[0m ', async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input === 'exit' || input === 'quit') {
        console.log('Bye!');
        rl.close();
        process.exit(0);
      }
      if (input === '/clear') {
        history = [];
        console.log('History cleared.');
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

      const callbacks: AgentCallbacks = {
        onToken: (t) => process.stdout.write(t),
        onToolStart: (name, params) => {
          console.log(`\n\x1b[36m> ${name}\x1b[0m`, Object.keys(params).length ? params : '');
        },
        onToolResult: (r) => {
          const tag = r.success ? '\x1b[32m\u2713\x1b[0m' : '\x1b[31m\u2717\x1b[0m';
          console.log(`${tag} ${r.tool}: ${r.output.slice(0, 200)}`);
        },
        onDiff: (_path, diff) => {
          console.log(`\x1b[33m${diff.slice(0, 500)}\x1b[0m`);
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
