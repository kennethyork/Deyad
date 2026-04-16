/**
 * Interactive REPL loop — session management, agent dispatch, git integration.
 * Slash-command handlers live in commands.ts.
 */
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { OllamaMessage } from './ollama.js';
import { streamChat, estimateTokens } from './ollama.js';
import { runAgentLoop, compactConversation } from './agent.js';
import { loadOrCreateSession, saveSession, pruneSessions } from './session.js';
import { createSnapshot } from './undo.js';
import { isSandboxed } from './sandbox.js';
import { getConfigPath } from './config.js';
import { VERSION } from './cli-args.js';
import { createCallbacks } from './cli.js';
import { handleSlashCommand } from './commands.js';
import { debugLog } from './debug.js';
import {
  c, Spinner,
  printBanner,
  formatConfirm, formatError,
  formatSuccess, formatTokenBadge, getPrompt,
} from './tui.js';

/** Shared REPL configuration passed from main(). */
export interface ReplConfig {
  model: string;
  models: string[];
  cwd: string;
  autoApprove: boolean;
  noThink: boolean;
  temperature: number;
  ollamaHost: string;
  contextSize: number;
  maxIterations: number;
  gitAutoCommit: boolean;
  allowedTools: string[];
  restrictedTools: string[];
  resume: boolean;
  numThread?: number;
  numGpu?: number;
}

/** Tab-completion for REPL commands and file paths. */
function buildCompleter(cwd: string): (line: string) => [string[], string] {
  const REPL_COMMANDS = [
    '/help', '/clear', '/status', '/models', '/compact', '/model ',
    '/diff', '/git', '/tokens', '/index', '/init', '/undo',
    '/snapshots', '/sandbox ', '/sessions', '/memory',
    'exit', 'quit', 'git',
  ];
  return (line: string): [string[], string] => {
    if (line.startsWith('/') || line === 'g' || line === 'gi' || line === 'git' || line === 'e' || line === 'ex' || line === 'exi' || line === 'q' || line === 'qu' || line === 'qui') {
      const hits = REPL_COMMANDS.filter(c => c.startsWith(line));
      return [hits.length ? hits : REPL_COMMANDS, line];
    }
    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || '';
    if (lastWord.includes('/') || lastWord.includes('.')) {
      try {
        const dir = path.dirname(path.resolve(cwd, lastWord));
        const prefix = path.basename(lastWord);
        const entries = fs.readdirSync(dir).filter(e => e.startsWith(prefix));
        const completions = entries.map(e => {
          const full = path.join(path.dirname(lastWord), e);
          const stat = fs.statSync(path.resolve(cwd, full));
          return stat.isDirectory() ? full + '/' : full;
        });
        return [completions, lastWord];
      } catch (e) { debugLog('repl', 'tab completion failed', e); }
    }
    return [[], line];
  };
}

/** Run git add + AI-generated commit + push. */
async function runGitCommitPushImpl(state: ReplState): Promise<void> {
  const { cfg } = state;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', '-A'], { cwd: cfg.cwd, timeout: 10000 });
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 }).trim();
    if (!status) {
      console.log(c.dim('  Nothing to commit. Working tree clean.'));
      return;
    }
    const commitMsg = await generateCommitMessage(cfg, cfg.cwd);
    console.log(`  ${c.cyan('commit')} ${commitMsg}`);
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: cfg.cwd, timeout: 10000 });

    const pushSpinner = new Spinner('Pushing...');
    pushSpinner.start();
    try {
      execFileSync('git', ['push'], { cwd: cfg.cwd, timeout: 30000 });
      pushSpinner.stop();
      console.log(formatSuccess('Staged, committed, and pushed.'));
    } catch (e) {
      debugLog('git push failed: %s', (e as Error).message);
      pushSpinner.stop();
      console.log(formatSuccess('Committed locally.'));
      console.log(c.dim('  Push failed — no remote configured or network error. Run git push manually.'));
    }
  } catch (e) {
    console.log(formatError(`Git error: ${(e as Error).message}`));
  }
}

/** Generate a commit message from the staged diff using the model. */
async function generateCommitMessage(cfg: ReplConfig, cwd: string): Promise<string> {
  const { execFileSync } = await import('node:child_process');
  const diffStat = execFileSync('git', ['diff', '--cached', '--stat'], { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  const diffContent = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf-8', timeout: 60000 });
  const diffForPrompt = diffContent.length > 4000 ? diffContent.slice(0, 4000) + '\n...(truncated)' : diffContent;

  const commitSpinner = new Spinner('Generating commit message...');
  commitSpinner.start();
  let commitMsg = '';
  try {
    const result = await streamChat(
      cfg.model,
      [
        { role: 'system', content: 'You are a git commit message generator. Output ONLY the commit message — no explanation, no quotes, no markdown. Use conventional commit format (feat:, fix:, chore:, refactor:, docs:, etc). Keep it under 72 chars. If multiple changes, summarize the most important one.' },
        { role: 'user', content: `Generate a commit message for:\n\n${diffStat}\n\n${diffForPrompt}` },
      ],
      (token) => { commitMsg += token; },
      { temperature: 0.1 },
      undefined, undefined, undefined, false, cfg.ollamaHost,
    );
    commitMsg = (commitMsg || result.content).trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0]!.trim();
  } catch (e) {
    debugLog('commit message generation failed: %s', (e as Error).message);
    const lines = diffStat.split('\n');
    commitMsg = `chore: update ${lines.length > 1 ? lines.length - 1 + ' files' : lines[0]?.trim() || 'files'}`;
  }
  commitSpinner.stop();
  return commitMsg || 'chore: update files';
}

/** Persist current REPL state to session storage. */
function saveReplSession(state: ReplState): void {
  state.session.history = state.history;
  state.session.totalTokens = state.totalTokens;
  state.session.taskCount = state.taskCount;
  state.session.model = state.cfg.model;
  saveSession(state.session);
}

/** Auto-commit changed files after a task if gitAutoCommit is enabled. */
async function autoCommitIfNeeded(state: ReplState, changedFiles: string[]): Promise<void> {
  const { cfg } = state;
  if (!cfg.gitAutoCommit || changedFiles.length === 0) return;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['add', '-A'], { cwd: cfg.cwd, timeout: 10000 });
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: cfg.cwd, encoding: 'utf-8', timeout: 10000 }).trim();
    if (status) {
      const commitMsg = await generateCommitMessage(cfg, cfg.cwd);
      execFileSync('git', ['commit', '-m', commitMsg], { cwd: cfg.cwd, timeout: 10000 });
      console.log(c.dim(`  auto-commit: ${commitMsg}`));
    }
  } catch (e) { debugLog('auto-commit skipped: %s', (e as Error).message); }
}

/** Mutable REPL state passed between handlers. */
export interface ReplState {
  cfg: ReplConfig;
  session: ReturnType<typeof loadOrCreateSession>;
  history: OllamaMessage[];
  totalTokens: number;
  taskCount: number;
  rl: readline.Interface;
  saveSession(): void;
  runGitCommitPush(): Promise<void>;
}

/** Start the interactive REPL loop. */
export function startRepl(cfg: ReplConfig): void {
  let session = loadOrCreateSession(cfg.cwd, cfg.model);
  if (cfg.resume && session.history.length > 0) {
    const before = session.history.length;
    compactConversation(session.history, cfg.contextSize);
    if (session.history.length < before) {
      console.log(c.dim(`  Resuming session ${session.id} (compacted ${before}→${session.history.length} messages, ${session.taskCount} tasks)`));
    } else {
      console.log(c.dim(`  Resuming session ${session.id} (${session.taskCount} tasks, ${session.history.length} messages)`));
    }
  }
  pruneSessions();

  if (cfg.autoApprove) {
    console.log(c.dim(`  Config: ${getConfigPath()}`));
    console.log(formatSuccess(`  Auto-approve enabled`));
    console.log('');
  }

  printBanner(VERSION, cfg.model, cfg.cwd, isSandboxed());
  console.log(c.dim(`  Context: ${(cfg.contextSize / 1024).toFixed(0)}K tokens${cfg.contextSize ? '' : ' (auto-detected)'}`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: buildCompleter(cfg.cwd),
    history: [] as string[],
    historySize: 100,
  } as readline.ReadLineOptions);

  const state: ReplState = {
    cfg,
    session,
    history: cfg.resume ? session.history : [],
    totalTokens: cfg.resume ? session.totalTokens : 0,
    taskCount: cfg.resume ? session.taskCount : 0,
    rl,
    saveSession() { saveReplSession(state); },
    runGitCommitPush() { return runGitCommitPushImpl(state); },
  };

  rl.on('close', () => {
    saveReplSession(state);
    console.log('');
    console.log(c.dim(`  Session saved: ${state.session.id}`));
    console.log(c.dim('  Goodbye!'));
    console.log('');
    process.exit(0);
  });

  const ask = (): void => {
    rl.question(getPrompt(isSandboxed()), async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }

      const handled = await handleSlashCommand(input, state);
      if (handled) { ask(); return; }

      // ── User prompt → run agent ──
      createSnapshot(cfg.cwd, `before task: ${input.slice(0, 50)}`);

      const replCallbacks = createCallbacks({
        silent: false,
        showDiffs: true,
        autoApprove: cfg.autoApprove,
        askConfirm: (question) => new Promise((resolve) => {
          rl.question(formatConfirm(question), (answer) => {
            resolve(answer.trim().toLowerCase().startsWith('y'));
          });
        }),
      });

      try {
        const result = await runAgentLoop(cfg.model, input, cfg.cwd, replCallbacks, state.history, undefined, cfg.noThink ? false : undefined, {
          temperature: cfg.temperature, contextSize: cfg.contextSize, ollamaHost: cfg.ollamaHost,
          maxIterations: cfg.maxIterations, allowedTools: cfg.allowedTools, restrictedTools: cfg.restrictedTools,
          numThread: cfg.numThread, numGpu: cfg.numGpu,
        });
        state.history = result.history;
        state.totalTokens += result.stats.totalTokens;
        state.taskCount++;

        const historyChars = state.history.reduce((s, m) => s + m.content.length, 0);
        const contextTokens = estimateTokens(historyChars);
        const contextPct = Math.min(100, Math.round((contextTokens / cfg.contextSize) * 100));
        console.log(formatTokenBadge(result.stats.totalTokens, contextPct));

        await autoCommitIfNeeded(state, result.changedFiles);
        saveReplSession(state);
      } catch (err) {
        console.error(formatError(String(err)));
      }
      ask();
    });
  };

  ask();
}
