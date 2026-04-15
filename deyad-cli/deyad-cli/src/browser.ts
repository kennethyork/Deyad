/**
 * Headless browser automation supporting Chrome (CDP) and Firefox (BiDi).
 * Zero external dependencies — uses Node's native WebSocket (v21+) and child_process.
 *
 * Tries Chrome/Chromium first (CDP protocol), falls back to Firefox (WebDriver BiDi).
 * Provides: navigate, screenshot, click, type, get_text, console logs.
 * The agent can use the `browser` tool with an `action` parameter.
 */

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { debugLog } from './debug.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type BrowserKind = 'cdp' | 'bidi';

// ── Browser Discovery ─────────────────────────────────────────────────────────

const CHROME_PATHS = [
  'google-chrome-stable',
  'google-chrome',
  'chromium-browser',
  'chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const FIREFOX_PATHS = [
  'firefox',
  '/usr/bin/firefox',
  '/usr/lib/firefox/firefox',
  '/snap/bin/firefox',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/Applications/Firefox.app/Contents/MacOS/firefox-bin',
];

function findBrowser(paths: string[]): string | null {
  for (const p of paths) {
    try {
      const resolved = execFileSync('which', [p], { encoding: 'utf-8', timeout: 3000 }).trim();
      if (resolved) return resolved;
    } catch (e) { debugLog('browser', 'which lookup failed for ' + p, e); }
    if (p.startsWith('/') && fs.existsSync(p)) return p;
  }
  return null;
}

// ── State ─────────────────────────────────────────────────────────────────────

let browserKind: BrowserKind | null = null;
let browserProcess: ChildProcess | null = null;
let ws: WebSocket | null = null;
let messageId = 1;
const pendingRequests = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
const consoleLogs: string[] = [];
let currentUrl = '';
let bidiContextId = '';

// ── Connection ────────────────────────────────────────────────────────────────

function setupMessageHandler(): void {
  ws!.addEventListener('message', (event) => {
    const data = JSON.parse(String(event.data)) as Record<string, unknown>;

    // Resolve pending request by id (works for both CDP and BiDi)
    const id = data['id'] as number | undefined;
    if (id !== undefined && pendingRequests.has(id)) {
      const req = pendingRequests.get(id)!;
      pendingRequests.delete(id);
      req.resolve(data);
    }

    // CDP console events
    if (data['method'] === 'Runtime.consoleAPICalled') {
      const params = data['params'] as Record<string, unknown> | undefined;
      const args = (params?.['args'] as Array<{ value?: unknown; description?: string }>) || [];
      const text = args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(`[${params?.['type'] || 'log'}] ${text}`);
      if (consoleLogs.length > 100) consoleLogs.shift();
    }

    // BiDi console events
    if (data['method'] === 'log.entryAdded') {
      const params = data['params'] as Record<string, unknown> | undefined;
      const text = (params?.['text'] as string) || '';
      const level = (params?.['level'] as string) || 'log';
      consoleLogs.push(`[${level}] ${text}`);
      if (consoleLogs.length > 100) consoleLogs.shift();
    }
  });
}

async function connectWebSocket(url: string): Promise<void> {
  ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
    ws!.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    ws!.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`WebSocket error: ${e}`)); });
  });
  setupMessageHandler();
}

async function send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Browser not connected');
  }
  const id = messageId++;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Browser timeout: ${method}`));
    }, 30000);
    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws!.send(JSON.stringify({ id, method, params }));
  });
}

// ── Browser Launch ────────────────────────────────────────────────────────────

async function ensureBrowser(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  // Clean up any stale state from a previous session
  closeBrowser();

  // Try Firefox first (BiDi) — most reliable for headless automation
  const firefoxPath = findBrowser(FIREFOX_PATHS);
  if (firefoxPath) {
    try {
      await startFirefox(firefoxPath);
      return;
    } catch (e) {
      debugLog('Firefox launch failed: %s', (e as Error).message);
      closeBrowser();
    }
  }

  // Fall back to Chrome/Chromium (CDP)
  const chromePath = findBrowser(CHROME_PATHS);
  if (chromePath) {
    try {
      await startChrome(chromePath);
      return;
    } catch (e) {
      debugLog('Chrome launch failed: %s', (e as Error).message);
      closeBrowser();
    }
  }

  throw new Error('No browser found. Install Firefox, Chrome, or Chromium.');
}

async function startChrome(chromePath: string): Promise<void> {
  const userDataDir = path.join(os.tmpdir(), 'deyad-browser-profile');
  const port = 9222 + Math.floor(Math.random() * 100);

  browserProcess = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,720',
  ], { stdio: 'ignore', detached: false });

  // Detect if Chrome exits immediately (broken headless on some systems)
  let chromeExited = false;
  browserProcess.on('exit', () => { chromeExited = true; });

  // Wait for CDP to be ready — bail early if Chrome exits
  let wsUrl = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (chromeExited) break;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = await resp.json() as { webSocketDebuggerUrl: string };
      wsUrl = data.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch (e) { debugLog('browser', 'CDP discovery retry', e); }
  }

  if (!wsUrl) {
    closeBrowser();
    throw new Error('Chrome started but CDP not reachable.');
  }

  await connectWebSocket(wsUrl);
  browserKind = 'cdp';

  // Verify CDP is actually functional — some Chrome headless builds connect
  // to a browser-level target where Page commands are unavailable.
  await send('Page.enable', {});
  await send('Runtime.enable', {});
  const check = await send('Page.navigate', { url: 'about:blank' });
  if (check['error']) throw new Error('Chrome CDP Page domain not functional');
}

async function startFirefox(firefoxPath: string): Promise<void> {
  const profileDir = path.join(os.tmpdir(), `deyad-firefox-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const port = 9222 + Math.floor(Math.random() * 100);

  browserProcess = spawn(firefoxPath, [
    '--headless',
    '--no-remote',
    '--profile', profileDir,
    '--remote-debugging-port', String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: false });

  // Wait for Firefox to signal readiness ("WebDriver BiDi listening on ws://...")
  // The message may appear on stdout or stderr depending on Firefox version.
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => { if (!settled) { settled = true; resolve(); } };
    const check = (chunk: Buffer): void => {
      if (chunk.toString().includes('WebDriver BiDi listening')) done();
    };
    browserProcess!.stdout?.on('data', check);
    browserProcess!.stderr?.on('data', check);
    // Fallback timeout in case the signal is missed
    setTimeout(done, 15000);
  });

  // Connect to BiDi WebSocket — retry until Firefox is fully ready
  let connected = false;
  for (let i = 0; i < 20; i++) {
    try {
      await connectWebSocket(`ws://127.0.0.1:${port}/session`);
      connected = true;
      break;
    } catch (e) {
      debugLog('BiDi connect attempt %d failed: %s', i + 1, (e as Error).message);
      ws = null;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!connected) {
    closeBrowser();
    throw new Error('Firefox started but BiDi not reachable.');
  }

  browserKind = 'bidi';

  // Initialize BiDi session
  await send('session.new', { capabilities: {} });

  // Get browsing context
  const treeResp = await send('browsingContext.getTree', {});
  const result = treeResp['result'] as Record<string, unknown>;
  const contexts = result['contexts'] as Array<Record<string, unknown>>;
  bidiContextId = (contexts?.[0]?.['context'] as string) || '';

  if (!bidiContextId) {
    closeBrowser();
    throw new Error('Firefox BiDi: no browsing context found.');
  }

  // Subscribe to console log events
  try {
    await send('session.subscribe', { events: ['log.entryAdded'] });
  } catch (e) { debugLog('browser', 'BiDi subscribe failed', e); }
}

// ── Evaluate Helper ───────────────────────────────────────────────────────────

/** Evaluate a JS expression in the page and return the string result. */
async function evaluate(expression: string): Promise<{ error?: string; value: string }> {
  if (browserKind === 'bidi') {
    const resp = await send('script.evaluate', {
      expression,
      target: { context: bidiContextId },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    if ((resp['type'] as string) === 'error') {
      return { error: (resp['message'] as string) || 'evaluate error', value: '' };
    }
    const result = resp['result'] as Record<string, unknown> | undefined;
    if ((result?.['type'] as string) === 'exception') {
      return { error: 'script exception', value: '' };
    }
    const inner = result?.['result'] as Record<string, unknown> | undefined;
    return { value: String(inner?.['value'] ?? '') };
  }

  // CDP
  const resp = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (resp['error']) {
    const err = resp['error'] as Record<string, unknown>;
    return { error: (err['message'] as string) || 'evaluate error', value: '' };
  }
  const result = resp['result'] as Record<string, unknown> | undefined;
  const inner = result?.['result'] as Record<string, unknown> | undefined;
  return { value: String(inner?.['value'] ?? '') };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function browserNavigate(url: string): Promise<string> {
  await ensureBrowser();

  if (browserKind === 'bidi') {
    const resp = await send('browsingContext.navigate', {
      url,
      context: bidiContextId,
      wait: 'complete',
    });
    if ((resp['type'] as string) === 'error') {
      return `Error: ${(resp['message'] as string) || 'navigate failed'}`;
    }
  } else {
    const resp = await send('Page.navigate', { url });
    if (resp['error']) return `Error: ${(resp['error'] as Record<string, unknown>)['message']}`;
    await new Promise(r => setTimeout(r, 2000));
  }

  currentUrl = url;
  const { value: title } = await evaluate('document.title');
  return `Navigated to: ${url}\nTitle: ${title}`;
}

export async function browserScreenshot(cwd: string): Promise<string> {
  await ensureBrowser();

  let base64 = '';
  if (browserKind === 'bidi') {
    const resp = await send('browsingContext.captureScreenshot', { context: bidiContextId });
    if ((resp['type'] as string) === 'error') {
      return `Error: ${(resp['message'] as string) || 'screenshot failed'}`;
    }
    base64 = ((resp['result'] as Record<string, unknown>)?.['data'] as string) || '';
  } else {
    const resp = await send('Page.captureScreenshot', { format: 'png' });
    if (resp['error']) return `Error: ${(resp['error'] as Record<string, unknown>)['message']}`;
    base64 = ((resp['result'] as Record<string, unknown>)?.['data'] as string) || '';
  }

  const filePath = path.join(cwd, '.deyad', 'screenshot.png');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return `Screenshot saved to .deyad/screenshot.png (${Math.round(base64.length * 0.75 / 1024)}KB).\nCurrent URL: ${currentUrl}`;
}

export async function browserClick(selector: string): Promise<string> {
  await ensureBrowser();
  const escapedSelector = selector.replace(/'/g, "\\'");
  const { error, value } = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'Element not found: ${escapedSelector}';
    el.click();
    return 'Clicked: ${escapedSelector}';
  })()`);
  if (error) return `Error: ${error}`;
  return value || 'click sent';
}

export async function browserType(selector: string, text: string): Promise<string> {
  await ensureBrowser();
  const escapedSelector = selector.replace(/'/g, "\\'");
  const { error, value } = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'Element not found: ${escapedSelector}';
    el.focus();
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'Typed into: ${escapedSelector}';
  })()`);
  if (error) return `Error: ${error}`;
  return value || 'typed';
}

export async function browserGetText(): Promise<string> {
  await ensureBrowser();
  const { error, value } = await evaluate('document.body?.innerText?.slice(0, 10000) || "(empty page)"');
  if (error) return `Error: ${error}`;
  return `URL: ${currentUrl}\n\n${value}`;
}

export async function browserGetConsole(): Promise<string> {
  return consoleLogs.length > 0
    ? consoleLogs.slice(-50).join('\n')
    : '(no console output)';
}

export function closeBrowser(): void {
  if (ws) {
    try { ws.close(); } catch (e) { debugLog('browser', 'ws.close failed', e); }
    ws = null;
  }
  if (browserProcess) {
    try { browserProcess.kill('SIGTERM'); } catch (e) { debugLog('browser', 'process.kill failed', e); }
    browserProcess = null;
  }
  consoleLogs.length = 0;
  currentUrl = '';
  messageId = 1;
  pendingRequests.clear();
  browserKind = null;
  bidiContextId = '';
}

/**
 * Execute a browser action. Actions:
 * - navigate <url>       → Go to URL
 * - screenshot           → Capture page screenshot
 * - click <selector>     → Click an element
 * - type <selector> <text> → Type text into an input
 * - get_text             → Get visible page text
 * - console              → Get console logs
 * - close                → Close the browser
 */
export async function executeBrowserAction(
  action: string,
  params: Record<string, string>,
  cwd: string,
): Promise<{ success: boolean; output: string }> {
  try {
    switch (action) {
      case 'navigate': {
        const url = params['url'];
        if (!url) return { success: false, output: 'Missing "url" param for navigate action.' };
        // Basic URL validation
        try { new URL(url); } catch (e) { debugLog('browser', 'invalid URL', e); return { success: false, output: 'Invalid URL.' }; }
        return { success: true, output: await browserNavigate(url) };
      }
      case 'screenshot':
        return { success: true, output: await browserScreenshot(cwd) };
      case 'click': {
        const selector = params['selector'];
        if (!selector) return { success: false, output: 'Missing "selector" param.' };
        return { success: true, output: await browserClick(selector) };
      }
      case 'type': {
        const selector = params['selector'];
        const text = params['text'];
        if (!selector || !text) return { success: false, output: 'Missing "selector" or "text" param.' };
        return { success: true, output: await browserType(selector, text) };
      }
      case 'get_text':
        return { success: true, output: await browserGetText() };
      case 'console':
        return { success: true, output: await browserGetConsole() };
      case 'close':
        closeBrowser();
        return { success: true, output: 'Browser closed.' };
      default:
        return { success: false, output: `Unknown browser action: ${action}. Use: navigate, screenshot, click, type, get_text, console, close` };
    }
  } catch (err) {
    return { success: false, output: `Browser error: ${(err as Error).message}` };
  }
}
