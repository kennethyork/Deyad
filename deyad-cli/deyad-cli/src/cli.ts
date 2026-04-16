#!/usr/bin/env node
import 'dotenv/config';

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { checkOllama, listModels, getModelContextLength, warmModel, streamChat, skipHealthCheck } from './ollama.js';
import type { OllamaMessage } from './ollama.js';
import { runAgentLoop } from './agent.js';
import type { AgentCallbacks } from './agent.js';
import { loadConfig, getConfigPath } from './config.js';
import { enterSandbox, exitSandbox } from './sandbox.js';
import { startRepl } from './repl.js';
import {
  c, Spinner, divider,
  formatToolStart, formatToolEnd, formatDiff,
  formatConfirm, formatError, formatSuccess,
} from './tui.js';
import { VERSION, printUsage, generateCompletions, parseArgs } from './cli-args.js';
import { debugLog } from './debug.js';

/**
 * Streaming filter that suppresses <think>...</think> blocks from token output.
 * Buffers partial tags and only emits non-thinking content.
 */
export class ThinkFilter {
  private insideThink = false;
  private buf = '';
  private output: (s: string) => void;

  constructor(output: (s: string) => void) {
    this.output = output;
  }

  write(token: string): void {
    this.buf += token;

    while (this.buf.length > 0) {
      if (this.insideThink) {
        const closeIdx = this.buf.indexOf('</think>');
        if (closeIdx === -1) {
          if (this.buf.length > 8) this.buf = this.buf.slice(-8);
          return;
        }
        this.buf = this.buf.slice(closeIdx + 8);
        this.insideThink = false;
        continue;
      }

      const openIdx = this.buf.indexOf('<think>');
      if (openIdx === -1) {
        const partial = this.partialTagAt(this.buf);
        if (partial > 0) {
          this.output(this.buf.slice(0, this.buf.length - partial));
          this.buf = this.buf.slice(this.buf.length - partial);
          return;
        }
        this.output(this.buf);
        this.buf = '';
        return;
      }

      if (openIdx > 0) this.output(this.buf.slice(0, openIdx));
      this.buf = this.buf.slice(openIdx + 7);
      this.insideThink = true;
    }
  }

  private partialTagAt(s: string): number {
    const tag = '<think>';
    for (let len = Math.min(tag.length - 1, s.length); len > 0; len--) {
      if (s.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }

  flush(): void {
    if (!this.insideThink && this.buf.length > 0) {
      this.output(this.buf);
    }
    this.buf = '';
    this.insideThink = false;
  }
}

/** Options for creating a standard set of agent callbacks. */
interface CallbackOptions {
  silent?: boolean;
  showDiffs?: boolean;
  autoApprove?: boolean;
  /** Custom confirm handler (e.g. readline prompt). Falls back to auto-approve. */
  askConfirm?: (question: string) => Promise<boolean>;
}

/**
 * Create a standard AgentCallbacks with spinner management and ThinkFilter.
 * Consolidates the 3 duplicate callback patterns (runOnce, auto-mode, REPL).
 */
export function createCallbacks(opts: CallbackOptions = {}): AgentCallbacks {
  const { silent = false, showDiffs = false, autoApprove = false, askConfirm } = opts;
  const spinner = new Spinner('Thinking...');
  let active = false;
  let toolStartTime = 0;
  const thinkFilter = new ThinkFilter((s) => { if (!silent) process.stdout.write(s); });

  const stop = (): void => { if (active) { spinner.stop(); active = false; } };

  return {
    onToken: (t) => { stop(); thinkFilter.write(t); },
    onThinkingToken: () => {
      if (!active && !silent) {
        spinner.update('Reasoning...');
        spinner.start(); active = true;
      }
    },
    onToolStart: (name, params) => {
      stop(); thinkFilter.flush();
      if (!silent) console.log('\n' + formatToolStart(name, params));
      toolStartTime = Date.now();
      spinner.update(`Running ${name}...`);
      spinner.start(); active = true;
    },
    onToolResult: (r) => {
      stop();
      const elapsed = toolStartTime ? ` ${((Date.now() - toolStartTime) / 1000).toFixed(1)}s` : '';
      console.log(formatToolEnd(r.tool, r.success, r.output, elapsed));
    },
    onDiff: showDiffs
      ? (p, d) => { stop(); console.log(formatDiff(p, d)); }
      : () => {},
    onDone: (summary) => {
      stop(); thinkFilter.flush();
      if (silent && summary) console.log(summary);
      if (!silent) console.log('');
    },
    onError: (e) => { stop(); thinkFilter.flush(); console.error(formatError(e)); },
    confirm: askConfirm ?? (async () => autoApprove),
  };
}

export async function runOnce(
  model: string,
  prompt: string,
  cwd: string,
  silent: boolean,
  think: boolean | undefined = true,
  options?: {
    temperature?: number;
    contextSize?: number;
    ollamaHost?: string;
    maxIterations?: number;
    allowedTools?: string[];
    restrictedTools?: string[];
    autoApprove?: boolean;
    numThread?: number;
    numGpu?: number;
  },
): Promise<void> {
  const callbacks = createCallbacks({ silent, autoApprove: options?.autoApprove ?? true });
  await runAgentLoop(model, prompt, cwd, callbacks, [], undefined, think, options);
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
  if (args.showConfig) {
    console.log(`Config path: ${getConfigPath()}`);
    const config = loadConfig();
    if (Object.keys(config).length > 0) {
      console.log('');
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log('No config found.');
    }
    process.exit(0);
  }
  if (args.completions) {
    console.log(generateCompletions(args.completions));
    process.exit(0);
  }

  // --print mode: ultra-fast path — skip checkOllama/listModels entirely.
  // Just load config, resolve model, and call streamChat directly.
  // streamChat has its own error handling if Ollama is unreachable.
  const printPrompt = args.print;
  if (printPrompt !== undefined) {
    const globalConfig = loadConfig();
    const model = args.model ?? process.env['DEYAD_MODEL'] ?? globalConfig.model ?? 'qwen3.5:27b';
    const temperature = globalConfig.temperature ?? 0.3;
    const ollamaHost = globalConfig.ollamaHost ?? 'http://127.0.0.1:11434';
    const numThread = globalConfig.numThread ?? os.cpus().length;
    const numGpu = globalConfig.numGpu;

    // Skip the /api/tags health ping — the /api/chat call itself will fail
    // with a clear ECONNREFUSED if Ollama is down. Saves one round trip.
    skipHealthCheck();

    const messages: OllamaMessage[] = [
      { role: 'system', content: 'You are a helpful assistant. Be concise.' },
      { role: 'user', content: printPrompt },
    ];
    try {
      await streamChat(
        model,
        messages,
        (t) => process.stdout.write(t),
        { temperature, num_thread: numThread, ...(numGpu !== undefined ? { num_gpu: numGpu } : {}) },
        undefined, // no abort signal
        undefined, // no thinking token handler
        undefined, // no tools
        false,     // always disable thinking for --print (speed)
        ollamaHost,
      );
      console.log('');
    } catch (err) {
      console.error(formatError(`Ollama error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
    process.exit(0);
  }

  // ── Non-print modes: verify Ollama and list available models ──
  const [ok, models] = await Promise.all([
    checkOllama(),
    listModels(),
  ]);
  if (!ok) {
    console.error(formatError('Cannot connect to Ollama. Is it running? (ollama serve)'));
    process.exit(1);
  }

  if (models.length === 0) {
    console.error(formatError('No Ollama models found. Pull one first: ollama pull llama3.2'));
    process.exit(1);
  }

  // Load global config
  const globalConfig = loadConfig();

  let model: string = args.model ?? process.env['DEYAD_MODEL'] ?? globalConfig.model ?? models[0]!;
  if (!models.includes(model)) {
    console.error(formatError(`Model "${model}" not found. Available: ${models.join(', ')}`));
    process.exit(1);
  }

  // Merge config options with CLI flags (CLI takes precedence)
  const autoApprove = args.autoApprove ?? globalConfig.autoApprove ?? false;
  const noThink = args.noThink ?? globalConfig.noThink ?? false;
  const temperature = globalConfig.temperature ?? 0.3;
  const ollamaHost = globalConfig.ollamaHost ?? 'http://127.0.0.1:11434';

  // Use all CPU cores for inference threads
  const numThread = globalConfig.numThread ?? os.cpus().length;
  const numGpu = globalConfig.numGpu; // let Ollama auto-decide GPU layers unless explicitly set

  const cwd = process.cwd();
  let contextSize = globalConfig.contextSize;
  if (contextSize === undefined) {
    contextSize = await getModelContextLength(model, ollamaHost) ?? 32768;
  }
  const maxIterations = globalConfig.maxIterations ?? 30;
  const gitAutoCommit = globalConfig.gitAutoCommit ?? true;
  const allowedTools = globalConfig.allowedTools ?? [];
  const restrictedTools = globalConfig.restrictedTools ?? [];

  // Pre-warm model for non-print modes (fire-and-forget).
  // Overlaps with remaining CLI init + agent startup.
  warmModel(model, ollamaHost);

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

    const autoCallbacks = createCallbacks({ autoApprove: true });
    await runAgentLoop(model, args.prompt, cwd, autoCallbacks, [], undefined, noThink ? false : true, { temperature, contextSize, ollamaHost, maxIterations, allowedTools, restrictedTools, numThread, numGpu });

    console.log('');
    console.log(divider('Sandbox Complete'));
    console.log('');

    const autoRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    autoRl.on('close', () => {
      const result = exitSandbox(cwd, false);
      if (result.diff) console.log(c.dim(result.diff));
      console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
      process.exit(0);
    });
    autoRl.question(formatConfirm('Merge changes into your branch?'), (answer) => {
      const merge = answer.trim().toLowerCase().startsWith('y');
      const result = exitSandbox(cwd, merge);
      if (result.diff) console.log(c.dim(result.diff));
      console.log(result.success ? formatSuccess(result.message) : formatError(result.message));
      autoRl.close();
      process.exit(0);
    });
    return;
  }

  // One-shot prompt mode
  if (args.prompt) {
    await runOnce(model, args.prompt, cwd, false, noThink ? false : true, { temperature, contextSize, ollamaHost, maxIterations, allowedTools, restrictedTools, autoApprove, numThread, numGpu });
    process.exit(0);
  }

  // ── Interactive REPL ──
  startRepl({
    model, models, cwd, autoApprove, noThink, temperature,
    ollamaHost, contextSize, maxIterations, gitAutoCommit,
    allowedTools, restrictedTools, resume: !!args.resume,
    numThread, numGpu,
  });
}

function checkIsMain(): boolean {
  if (!process.argv[1]) return false;
  const scriptPath = process.argv[1].replace(/\\/g, '/');
  // Direct match (node dist/cli.js)
  if (import.meta.url.endsWith(scriptPath)) return true;
  // Resolve symlinks (global npm install creates a symlink)
  try {
    const resolved = fs.realpathSync(scriptPath).replace(/\\/g, '/');
    if (import.meta.url.endsWith(resolved)) return true;
  } catch (e) { debugLog('realpath check failed: %s', (e as Error).message); }
  return false;
}

if (checkIsMain()) {
  const MAX_RESTARTS = 3;
  const RESTART_DELAY_MS = 2000;
  let restarts = 0;

  const run = async (): Promise<void> => {
    try {
      await main();
    } catch (err) {
      console.error(formatError(String(err)));
      restarts++;
      if (restarts <= MAX_RESTARTS) {
        console.log(c.dim(`  Restarting in ${RESTART_DELAY_MS / 1000}s... (attempt ${restarts}/${MAX_RESTARTS})`));
        await new Promise(r => setTimeout(r, RESTART_DELAY_MS));
        return run();
      }
      console.error(formatError(`Failed after ${MAX_RESTARTS} restarts. Exiting.`));
      process.exit(1);
    }
  };

  // Reset restart counter on SIGUSR1 (manual restart signal)
  process.on('SIGUSR1', () => { restarts = 0; });

  run();
}
