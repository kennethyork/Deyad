/**
 * Headless browser automation via Chrome DevTools Protocol (CDP).
 * Zero external dependencies — uses Node's native WebSocket (v21+) and child_process.
 *
 * Provides: navigate, screenshot, click, type, get_text, console logs.
 * The agent can use the `browser` tool with an `action` parameter.
 */

import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface CDPEvent {
  method: string;
  params?: Record<string, unknown>;
}

// ── Chrome Discovery ──────────────────────────────────────────────────────────

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

function findChrome(): string | null {
  for (const p of CHROME_PATHS) {
    try {
      const resolved = execFileSync('which', [p], { encoding: 'utf-8', timeout: 3000 }).trim();
      if (resolved) return resolved;
    } catch { /* continue */ }
    if (p.startsWith('/') && fs.existsSync(p)) return p;
  }
  return null;
}

// ── CDP Client ────────────────────────────────────────────────────────────────

let chromeProcess: ChildProcess | null = null;
let cdpWs: WebSocket | null = null;
let messageId = 1;
const pendingRequests = new Map<number, { resolve: (v: CDPResponse) => void; reject: (e: Error) => void }>();
const consoleLogs: string[] = [];
let currentUrl = '';

async function ensureBrowser(): Promise<void> {
  if (cdpWs && cdpWs.readyState === WebSocket.OPEN) return;

  const chromePath = findChrome();
  if (!chromePath) throw new Error('No Chrome/Chromium found. Install Chrome or Chromium.');

  const userDataDir = path.join(os.tmpdir(), 'deyad-browser-profile');
  const port = 9222 + Math.floor(Math.random() * 100);

  chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  // Wait for CDP to be ready
  let wsUrl = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = await resp.json() as { webSocketDebuggerUrl: string };
      wsUrl = data.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch { /* retry */ }
  }

  if (!wsUrl) {
    closeBrowser();
    throw new Error('Chrome started but CDP not reachable.');
  }

  // Connect WebSocket
  cdpWs = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket timeout')), 10000);
    cdpWs!.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    cdpWs!.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(`CDP WS error: ${e}`)); });
  });

  cdpWs.addEventListener('message', (event) => {
    const data = JSON.parse(String(event.data)) as CDPResponse & CDPEvent;
    if (data.id !== undefined && pendingRequests.has(data.id)) {
      const req = pendingRequests.get(data.id)!;
      pendingRequests.delete(data.id);
      req.resolve(data);
    }
    // Capture console messages
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = (data.params?.['args'] as Array<{ value?: unknown; description?: string }>) || [];
      const text = args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(`[${data.params?.['type'] || 'log'}] ${text}`);
      if (consoleLogs.length > 100) consoleLogs.shift();
    }
  });

  // Enable console capture
  await cdpSend('Runtime.enable', {});
}

async function cdpSend(method: string, params: Record<string, unknown> = {}): Promise<CDPResponse> {
  if (!cdpWs || cdpWs.readyState !== WebSocket.OPEN) {
    throw new Error('CDP not connected');
  }
  const id = messageId++;
  return new Promise<CDPResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    cdpWs!.send(JSON.stringify({ id, method, params }));
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function browserNavigate(url: string): Promise<string> {
  await ensureBrowser();
  const resp = await cdpSend('Page.navigate', { url });
  if (resp.error) return `Error: ${resp.error.message}`;
  // Wait for load
  await cdpSend('Page.enable', {});
  await new Promise(r => setTimeout(r, 2000));
  currentUrl = url;
  // Get page title
  const titleResp = await cdpSend('Runtime.evaluate', { expression: 'document.title' });
  const title = (titleResp.result?.['result'] as { value?: string })?.value || '';
  return `Navigated to: ${url}\nTitle: ${title}`;
}

export async function browserScreenshot(cwd: string): Promise<string> {
  await ensureBrowser();
  const resp = await cdpSend('Page.captureScreenshot', { format: 'png' });
  if (resp.error) return `Error: ${resp.error.message}`;
  const base64 = (resp.result?.['data'] as string) || '';
  const filePath = path.join(cwd, '.deyad', 'screenshot.png');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return `Screenshot saved to .deyad/screenshot.png (${Math.round(base64.length * 0.75 / 1024)}KB).\nCurrent URL: ${currentUrl}`;
}

export async function browserClick(selector: string): Promise<string> {
  await ensureBrowser();
  const resp = await cdpSend('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ${selector.replace(/'/g, "\\'")}';
      el.click();
      return 'Clicked: ${selector.replace(/'/g, "\\'")}';
    })()`,
    returnByValue: true,
  });
  if (resp.error) return `Error: ${resp.error.message}`;
  return String((resp.result?.['result'] as { value?: string })?.value || 'click sent');
}

export async function browserType(selector: string, text: string): Promise<string> {
  await ensureBrowser();
  const resp = await cdpSend('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'Element not found: ${selector.replace(/'/g, "\\'")}';
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Typed into: ${selector.replace(/'/g, "\\'")}';
    })()`,
    returnByValue: true,
  });
  if (resp.error) return `Error: ${resp.error.message}`;
  return String((resp.result?.['result'] as { value?: string })?.value || 'typed');
}

export async function browserGetText(): Promise<string> {
  await ensureBrowser();
  const resp = await cdpSend('Runtime.evaluate', {
    expression: 'document.body?.innerText?.slice(0, 10000) || "(empty page)"',
    returnByValue: true,
  });
  if (resp.error) return `Error: ${resp.error.message}`;
  const text = String((resp.result?.['result'] as { value?: string })?.value || '');
  return `URL: ${currentUrl}\n\n${text}`;
}

export async function browserGetConsole(): Promise<string> {
  return consoleLogs.length > 0
    ? consoleLogs.slice(-50).join('\n')
    : '(no console output)';
}

export function closeBrowser(): void {
  if (cdpWs) {
    try { cdpWs.close(); } catch { /* ignore */ }
    cdpWs = null;
  }
  if (chromeProcess) {
    try { chromeProcess.kill('SIGTERM'); } catch { /* ignore */ }
    chromeProcess = null;
  }
  consoleLogs.length = 0;
  currentUrl = '';
  messageId = 1;
  pendingRequests.clear();
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
        try { new URL(url); } catch { return { success: false, output: 'Invalid URL.' }; }
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
