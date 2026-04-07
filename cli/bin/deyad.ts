#!/usr/bin/env node

/**
 * Deyad CLI — local AI coding agent powered by Ollama.
 *
 * Usage:
 *   deyad                         # interactive chat mode in current directory
 *   deyad "add a login page"      # one-shot task mode (executes or edits project once)
 *   deyad --model codestral       # specify model
 *   deyad --print "fix the bug"   # headless mode (single prompt, no REPL)
 *
 * Notes:
 *   - Use plain conversational prompts for chat and non-actionable questions.
 *   - Use task requests like "create file" or "fix bug" to trigger file/command tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { checkOllama, listModels, estimateTokens } from '../src/ollama.js';
import type { OllamaMessage } from '../src/ollama.js';
import { runAgentLoop } from '../src/agent.js';
import type { AgentResult, TokenStats } from '../src/agent.js';
import { runCommand, stripToolMarkup } from '../src/tools.js';
import { McpManager } from '../src/mcp.js';
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
  c, bold, red, green, cyan, dim,
} from '../src/ui.js';

const SESSION_FILE = '.deyad-session.json';
const MEMORY_FILE = 'DEYAD.md';

function isRunRequest(message: string): boolean {
  return /\b(run|execute|start|launch|open|serve|build|deploy|compile|install|create|write|append|make|generate|add|save)\b/i.test(message);
}

function inferFallbackShellCommand(message: string, cwd: string): string | null {
  const normalize = (s: string) => s.trim();
  const createFile = /create (?:a )?file (?:named |called )?"?([^"\s]+)"?(?: with content| containing| and content)?\s*"?([\s\S]+?)"?$/i;
  const writeFile = /write (?:a )?file (?:named |called )?"?([^"\s]+)"?(?: with content| containing| and content)?\s*"?([\s\S]+?)"?$/i;
  const createMatch = message.match(createFile) || message.match(writeFile);
  if (createMatch) {
    const filename = normalize(createMatch[1]);
    const content = createMatch[2].replace(/"?$/,'').trim();
    const marker = 'EOF';
    return `cat > "${filename}" <<'${marker}'\n${content}\n${marker}`;
  }

  const installMatch = message.match(/install (?:the )?package ([^\s]+)/i);
  if (installMatch) {
    const pkg = normalize(installMatch[1]);
    return `npm install ${pkg}`;
  }

  if (/\bdev\b|\bstart\b|\brun\b.*\bdev\b/i.test(message)) {
    return 'npm run dev';
  }
  if (/\bbuild\b/i.test(message) && fs.existsSync(path.join(cwd, 'package.json'))) {
    return 'npm run build';
  }
  if (/\btest\b/i.test(message) && fs.existsSync(path.join(cwd, 'package.json'))) {
    return 'npm test';
  }
  return null;
}

function findFallbackRunCommand(cwd: string): string | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.dev) return 'npm run dev';
    if (pkg.scripts?.start) return 'npm start';
    if (pkg.scripts?.serve) return 'npm run serve';
    if (pkg.scripts?.build) return 'npm run build';
  } catch {
    return null;
  }
  return null;
}

// ── Parse args ──────────────────────────────────────────────────────
interface CliArgs {
  model?: string;
  message?: string;
  dir?: string;
  help?: boolean;
  autoConfirm?: boolean;
  print?: string;
  resume?: boolean;
  init?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};
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
    } else if (arg === '--print' || arg === '-p') {
      result.print = argv[++i];
    } else if (arg === '--resume') {
      result.resume = true;
    } else if (arg === 'init') {
      result.init = true;
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
  deyad                              Interactive chat/task mode in current directory
  deyad "add a login page"           One-shot task mode (executes a single request)
  deyad -m codestral "fix bugs"      Specify model for one-shot or interactive use
  deyad --print "fix the bug"        Headless CI/chat mode (no REPL, exits after)
  deyad --resume                     Resume last saved conversation
  deyad init                         Create DEYAD.md memory file

${bold('Modes:')}
  Interactive chat: use \`deyad\` and type conversational prompts.
  Headless chat: use \`--print\` with plain questions or chat prompts.
  Task mode: use actionable requests like create/write/edit/run to modify the project.

${bold('Options:')}
  -m, --model <name>    Ollama model to use
  -d, --dir <path>      Project directory (default: cwd)
  -y, --yes             Auto-confirm all tool actions
  -p, --print <prompt>  Headless mode: execute prompt and exit
  --resume              Resume last saved conversation
  -h, --help            Show this help

${bold('Environment:')}
  OLLAMA_HOST           Ollama API URL (default: http://127.0.0.1:11434)
  DEYAD_MODEL           Default model name
`);
}

function formatTokenStats(stats: TokenStats): string {
  return dim(`[tokens: ~${stats.promptTokens.toLocaleString()} in, ~${stats.completionTokens.toLocaleString()} out, ~${stats.totalTokens.toLocaleString()} total]`);
}

// ── Session save/load ───────────────────────────────────────────────
function saveSession(cwd: string, history: OllamaMessage[], model: string, stats: TokenStats, changedFiles: string[]) {
  const sessionPath = path.join(cwd, SESSION_FILE);
  const data = { model, history, stats, changedFiles, savedAt: new Date().toISOString() };
  fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadSession(cwd: string): { model: string; history: OllamaMessage[]; stats: TokenStats; changedFiles: string[] } | null {
  const sessionPath = path.join(cwd, SESSION_FILE);
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    return { model: data.model, history: data.history || [], stats: data.stats || { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, changedFiles: data.changedFiles || [] };
  } catch { return null; }
}

function extractRequestedFilename(message: string): string | null {
  const patterns = [
    /(?:create|make|write|generate|add|save)\s+(?:a\s+)?(?:python\s+script\s+)?(?:file\s+)?(?:named|called)?\s*["']?([\w.\-/]+\.py)["']?/i,
    /(?:create|make|write|generate|add|save)\s+(?:a\s+)?(?:python\s+script\s+)?(["']?[\w.\-/]+\.py["']?)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}

function extractPythonCode(text: string): string | null {
  const codeBlock = text.match(/```(?:python|py)?\n([\s\S]+?)```/i);
  if (codeBlock?.[1]) {
    return codeBlock[1].trim();
  }

  const contentMatch = text.match(/(?:content|with content|containing)\s*[:=]\s*([\s\S]+)/i);
  if (contentMatch?.[1]) {
    const content = contentMatch[1].trim();
    return content.replace(/^['"]|['"]$/g, '').trim();
  }

  const lines = text.split('\n').map((line) => line.trim());
  const codeLines = lines.filter((line) => line !== '' && !/^\[.*\]$/.test(line));
  if (codeLines.length > 0 && codeLines.every((line) => /^[\w\s\"'`#.:,+*/<>%\-_=;()\[\]{}]+$/.test(line))) {
    return codeLines.join('\n');
  }
  return null;
}

function safeWriteFile(cwd: string, filePath: string, content: string): boolean {
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) return false;
  const absPath = path.join(cwd, normalized);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ── Init command ────────────────────────────────────────────────────
function initMemory(cwd: string) {
  const memPath = path.join(cwd, MEMORY_FILE);
  if (fs.existsSync(memPath)) {
    console.log(dim(`DEYAD.md already exists at ${memPath}`));
    return;
  }
  const projectName = path.basename(cwd);
  const template = `# ${projectName}

## Project Overview
<!-- Describe your project here -->

## Key Conventions
<!-- Add coding conventions, architecture decisions, etc. -->

## Build & Test
<!-- Add build/test commands here -->
\`\`\`bash
# npm run build
# npm test
\`\`\`

## Notes
<!-- The AI agent will read this file for project context -->
`;
  fs.writeFileSync(memPath, template, 'utf-8');
  console.log(green(`✓ Created ${MEMORY_FILE}`));
  console.log(dim('  Edit it to add project context for the AI agent.'));
}

// ── Image helpers ───────────────────────────────────────────────────
function loadImageBase64(imagePath: string): string | null {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) return null;
  const ext = path.extname(absPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return null;
  return fs.readFileSync(absPath).toString('base64');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const cwd = path.resolve(args.dir || process.cwd());

  // Handle init subcommand
  if (args.init) {
    initMemory(cwd);
    process.exit(0);
  }

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

  // Load session if --resume
  let history: OllamaMessage[] = [];
  let cumulativeStats: TokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let allChangedFiles: string[] = [];

  if (args.resume) {
    const session = loadSession(cwd);
    if (session) {
      history = session.history;
      cumulativeStats = session.stats;
      allChangedFiles = session.changedFiles;
      if (!args.model && session.model) args.model = session.model;
      console.log(green(`✓ Resumed session (${history.length} messages, ${formatTokenStats(cumulativeStats)})`));
    } else {
      console.log(dim('No saved session found. Starting fresh.'));
    }
  }

  // Select model
  let model = args.model || process.env.DEYAD_MODEL || '';
  if (!model) {
    if (models.includes('qwen2.5-coder:1.5b-base')) {
      model = 'qwen2.5-coder:1.5b-base';
    } else if (models.includes('qwen3.5:27b')) {
      model = 'qwen3.5:27b';
    } else if (models.length === 1 || args.print) {
      model = models[0];
    } else {
      model = await selectModel(rl, models);
    }
  }
  if (!models.some(m => m.startsWith(model))) {
    console.log(red(`Model "${model}" not found. Available: ${models.join(', ')}`));
    rl.close();
    process.exit(1);
  }

  // ── Connect to MCP servers ─────────────────────────────────────
  const mcpManager = new McpManager();
  await mcpManager.connect(cwd, (msg) => console.log(dim(msg)));
  const mcpTools = mcpManager.getTools();
  if (mcpTools.length > 0) {
    console.log(green(`✓ MCP: ${mcpTools.length} tools from ${mcpManager.getStatus().length} server(s)`));
  }

  // Cleanup MCP on exit
  process.on('exit', () => { mcpManager.disconnect().catch(() => {}); });

  // ── --print headless mode ─────────────────────────────────────
  if (args.print) {
    const confirmFn = args.autoConfirm ? async (_q: string) => true : async (question: string) => uiConfirm(rl, question);
    await runOnce(model, args.print, cwd, history, confirmFn, [], true, undefined, mcpManager);
    await mcpManager.disconnect();
    rl.close();
    process.exit(0);
  }

  printBanner(model, cwd);

  const contextFiles: string[] = [];
  /** Pending images to attach to next message */
  let pendingImages: string[] = [];

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
    await runOnce(model, args.message, cwd, history, confirmFn, contextFiles, false, undefined, mcpManager);
    await mcpManager.disconnect();
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
      console.log(dim(`Messages: ${history.length} · Characters: ${chars.toLocaleString()} · Estimated tokens: ~${estimateTokens(chars).toLocaleString()}`));
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
    if (trimmed === '/init') {
      initMemory(cwd);
      continue;
    }
    if (trimmed === '/save') {
      saveSession(cwd, history, model, cumulativeStats, allChangedFiles);
      console.log(green(`✓ Session saved to ${SESSION_FILE}`));
      continue;
    }
    if (trimmed === '/resume') {
      const session = loadSession(cwd);
      if (session) {
        history = session.history;
        cumulativeStats = session.stats;
        allChangedFiles = session.changedFiles;
        if (session.model) model = session.model;
        console.log(green(`✓ Resumed session (${history.length} messages)`));
      } else {
        console.log(dim('No saved session found.'));
      }
      continue;
    }
    if (trimmed.startsWith('/image ')) {
      const imagePath = trimmed.slice(7).trim();
      const b64 = loadImageBase64(path.resolve(cwd, imagePath));
      if (!b64) {
        console.log(red(`Cannot load image: ${imagePath} (must be png/jpg/gif/webp)`));
      } else {
        pendingImages.push(b64);
        console.log(green(`✓ Image attached: ${imagePath} (will be sent with next message)`));
      }
      continue;
    }
    if (trimmed === '/mcp') {
      const status = mcpManager.getStatus();
      if (status.length === 0) {
        console.log(dim('No MCP servers connected.'));
        console.log(dim('  Add servers to .deyad.json:'));
        console.log(dim('  { "mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } } }'));
      } else {
        console.log(bold('MCP Servers:'));
        for (const s of status) console.log(`  ${s}`);
      }
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

    // Attach pending images
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    pendingImages = [];

    const result = await runOnce(model, contextPrefix + fullInput, cwd, history, confirmFn, contextFiles, false, images, mcpManager);
    history = result.history;
    cumulativeStats.promptTokens += result.stats.promptTokens;
    cumulativeStats.completionTokens += result.stats.completionTokens;
    cumulativeStats.totalTokens += result.stats.totalTokens;
    for (const f of result.changedFiles) {
      if (!allChangedFiles.includes(f)) allChangedFiles.push(f);
    }

    // Show token stats after each turn
    console.log(formatTokenStats(cumulativeStats));

    // Auto-save session
    saveSession(cwd, history, model, cumulativeStats, allChangedFiles);

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
  headless: boolean = false,
  images?: string[],
  mcpManager?: McpManager,
): Promise<AgentResult> {
  if (!headless) console.log(''); // blank line before response

  let currentLine = '';
  let inToolBlock = false;
  let inThinkBlock = false;
  let printedVisible = false;
  let finalOutput = '';

  // Build the user message with optional images
  const userMsg: OllamaMessage = { role: 'user', content: message };
  if (images && images.length > 0) {
    userMsg.images = images;
  }

  let toolStarted = false;
  const result = await runAgentLoop(model, userMsg, cwd, {
    onToken: (token: string) => {
      finalOutput += token;
      currentLine += token;

      // Show <think> blocks in dimmed style
      if (currentLine.includes('<think>')) {
        inThinkBlock = true;
        const before = currentLine.split('<think>')[0];
        if (before && !inToolBlock) process.stdout.write(before);
        currentLine = currentLine.split('<think>').slice(1).join('<think>');
      }
      if (inThinkBlock) {
        if (currentLine.includes('</think>')) {
          const thinkContent = currentLine.split('</think>')[0];
          if (thinkContent.trim() && !headless) {
            process.stdout.write(`${c.dim}${thinkContent}${c.reset}`);
          }
          if (!headless) process.stdout.write('\n');
          inThinkBlock = false;
          currentLine = currentLine.split('</think>').slice(1).join('</think>');
          return;
        }
        if (!headless) process.stdout.write(`${c.dim}${token}${c.reset}`);
        return;
      }

      // Don't print tool XML or done tag to the user
      if (currentLine.includes('<tool_call>')) { inToolBlock = true; }
      if (currentLine.includes('<done')) { inToolBlock = true; }
      if (!inToolBlock && !inThinkBlock) {
        process.stdout.write(token);
        if (token.trim()) printedVisible = true;
      }
      if (currentLine.includes('</tool_call>')) {
        inToolBlock = false;
        currentLine = '';
      }
    },
    onToolStart: (name, params) => {
      toolStarted = true;
      console.log(`\n${formatToolStart(name, params)}`);
    },
    onToolResult: (result) => {
      console.log(formatToolResult(result.tool, result.success, result.output));
      console.log('');
    },
    onDiff: (filePath, diff) => {
      console.log(formatDiff(filePath, diff));
    },
    onDone: (summary) => {
      if (!printedVisible && summary.trim()) {
        process.stdout.write(summary.trim());
        process.stdout.write('\n');
      }
      if (headless) {
        console.log(''); // newline after streamed output
      } else {
        console.log(`\n${green('✓ Done')}\n`);
      }
    },
    onError: (error) => {
      console.log(`\n${red('✗ ' + error)}\n`);
    },
    confirm: confirmFn,
  }, history, undefined, mcpManager);

  if (!toolStarted && isRunRequest(message)) {
      const finalText = stripToolMarkup(finalOutput).trim();
      const filename = extractRequestedFilename(message) || extractRequestedFilename(finalText);
      const pythonCode = extractPythonCode(message) || extractPythonCode(finalText);

      if (filename && pythonCode) {
        const written = safeWriteFile(cwd, filename, pythonCode);
        if (written) {
          console.log(green(`\n✓ Wrote ${filename} from model output.`));
          console.log('');
          if (!result.changedFiles.includes(filename)) result.changedFiles.push(filename);
        } else {
          console.log(red(`\n✗ Could not write ${filename}.`));
          console.log('');
        }
      } else {
        const inferredCommand = inferFallbackShellCommand(message, cwd);
        const fallbackCommand = findFallbackRunCommand(cwd);
        if (inferredCommand) {
          console.log(dim(`\nNo Ollama tool call was produced for this run request. The agent is Ollama-only, so it will not execute a guessed shell command.`));
          console.log(dim(`Try rephrasing or run this command manually if appropriate:`));
          console.log(cyan(inferredCommand));
          console.log('');
        } else if (fallbackCommand) {
          console.log(dim(`\nNo Ollama tool call was produced for this run request. The agent is Ollama-only, so it will not execute a guessed shell command.`));
          console.log(dim(`You can try this command manually instead:`));
          console.log(cyan(fallbackCommand));
          console.log('');
        } else {
          console.log(dim(`\nNo Ollama tool call was produced for this request. Please rephrase or use /run if you want a shell command.`));
          console.log('');
        }
      }
    }

    return result;
  }

main().catch((err: Error) => {
  console.error(red(`Fatal: ${err.message}`));
  process.exit(1);
});
