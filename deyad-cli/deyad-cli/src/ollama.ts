/**
 * Ollama API client — streaming chat completions + multimodal support.
 * No external dependencies, uses native fetch.
 */
import { debugLog } from './debug.js';

// ── Retry configuration ──────────────────────────────────────────────────────
/** Maximum retries for transient errors (timeouts, 429, 503). */
export const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff (doubled each retry). */
export const BACKOFF_BASE_MS = 1_000;

/** Returns true for HTTP status codes that are worth retrying. */
export function isRetryableStatus(status: number): boolean {
  // 500: Ollama's native tool call XML parser can fail on malformed model output — retry helps
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** Returns true for error messages that indicate transient failures. */
export function isRetryableError(msg: string): boolean {
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|timeout|aborted/i.test(msg);
}

/** Sleep helper for backoff delays. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  num_ctx?: number;
  num_thread?: number;
  num_gpu?: number;
}

export interface OllamaUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface StreamChatResult {
  content: string;
  thinking: string;
  toolCalls: OllamaToolCall[];
  usage: OllamaUsage;
}

export const DEFAULT_CHARS_PER_TOKEN = 3.5;

/**
 * Adaptive chars-per-token ratio that learns from actual Ollama usage data.
 * Starts at 3.5 (good default for English + code), adjusts as real data comes in.
 */
let calibratedRatio = DEFAULT_CHARS_PER_TOKEN;
let calibrationSamples = 0;
const MAX_CALIBRATION_SAMPLES = 20; // running average window

/** Skip redundant health checks after first successful connection. */
let ollamaHealthVerified = false;

/** Reset health-check cache (used by tests). */
export function resetHealthCache(): void { ollamaHealthVerified = false; }

export function estimateTokens(chars: number): number {
  return Math.round(chars / calibratedRatio);
}

/** Update the adaptive ratio with actual Ollama token counts. */
function calibrateTokenRatio(actualTokens: number, charCount: number): void {
  if (actualTokens <= 0 || charCount <= 0) return;
  const actualRatio = charCount / actualTokens;
  // Clamp to reasonable range (1.5 – 8.0 chars/token)
  if (actualRatio < 1.5 || actualRatio > 8.0) return;
  calibrationSamples = Math.min(calibrationSamples + 1, MAX_CALIBRATION_SAMPLES);
  // Exponential moving average: weight new data more when we have few samples
  const alpha = 1 / calibrationSamples;
  calibratedRatio = calibratedRatio * (1 - alpha) + actualRatio * alpha;
}

export async function streamChat(
  model: string,
  messages: OllamaMessage[],
  onToken: (token: string) => void,
  options: OllamaOptions = {},
  signal?: AbortSignal,
  onThinkingToken?: (token: string) => void,
  tools?: OllamaTool[],
  think?: boolean,
  baseUrl?: string,
): Promise<StreamChatResult> {
  const ollamaHost = baseUrl || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';

  // Health check: only on first call, then trust the connection
  if (!ollamaHealthVerified) {
    try {
      const ping = await fetch(`${ollamaHost}/api/tags`, { signal: signal ?? AbortSignal.timeout(5000) });
      if (!ping.ok) throw new Error(`Ollama returned ${ping.status}`);
      ollamaHealthVerified = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot reach Ollama at ${ollamaHost} — ${msg}.\n` +
        `Make sure Ollama is running: ollama serve`
      );
    }
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.2,
      top_p: options.top_p ?? 0.9,
      repeat_penalty: options.repeat_penalty ?? 1.1,
      ...(options.num_ctx ? { num_ctx: options.num_ctx } : {}),
      ...(options.num_thread ? { num_thread: options.num_thread } : {}),
      ...(options.num_gpu ? { num_gpu: options.num_gpu } : {}),
    },
    ...(tools && tools.length > 0 ? { tools } : {}),
  };

  // Disable thinking by default for reasoning models (qwen3.5, etc.)
  // This dramatically reduces latency — thinking adds 5-30s of chain-of-thought.
  if (think !== undefined) {
    body['think'] = think;
  }

  const resp = await (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
      try {
        const r = await fetch(`${ollamaHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
        if (r.ok) return r;
        if (isRetryableStatus(r.status) && attempt < MAX_RETRIES) {
          lastError = new Error(`Ollama error ${r.status}`);
          continue;
        }
        const text = await r.text().catch(() => '');
        throw new Error(`Ollama error ${r.status}: ${text}`);
      } catch (err) {
        if (signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableError(msg) && attempt < MAX_RETRIES) {
          lastError = err instanceof Error ? err : new Error(msg);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('Ollama request failed after retries');
  })();

  if (!resp.body) throw new Error('No response body from Ollama');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let thinking = '';
  let toolCalls: OllamaToolCall[] = [];
  let usage: OllamaUsage = { promptTokens: 0, completionTokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        // Qwen3.5+ reasoning models emit a "thinking" field during chain-of-thought
        if (json.message?.thinking) {
          thinking += json.message.thinking;
          if (onThinkingToken) onThinkingToken(json.message.thinking);
        }
        if (json.message?.tool_calls) {
          toolCalls.push(...json.message.tool_calls);
        }
        if (json.message?.content) {
          full += json.message.content;
          onToken(json.message.content);
        }
        if (json.done && json.prompt_eval_count != null) {
          usage.promptTokens = json.prompt_eval_count;
          usage.completionTokens = json.eval_count ?? 0;
        }
      } catch (e) {
        debugLog('ollama stream JSON parse failed: %s', (e as Error).message);
      }
    }
  }

  if (buf.trim()) {
    try {
      const json = JSON.parse(buf);
      if (json.message?.thinking) {
        thinking += json.message.thinking;
        if (onThinkingToken) onThinkingToken(json.message.thinking);
      }
      if (json.message?.tool_calls) {
        toolCalls.push(...json.message.tool_calls);
      }
      if (json.message?.content) {
        full += json.message.content;
        onToken(json.message.content);
      }
      if (json.done && json.prompt_eval_count != null) {
        usage.promptTokens = json.prompt_eval_count;
        usage.completionTokens = json.eval_count ?? 0;
      }
    } catch (e) {
      debugLog('ollama stream buffer parse failed: %s', (e as Error).message);
    }
  }

  // Reasoning models (qwen3.5, etc.) put tool calls and real content in the thinking block.
  // Return thinking separately so the agent can decide how to use it.

  if (usage.promptTokens === 0) {
    const promptChars = messages.reduce((s, m) => s + m.content.length, 0);
    usage.promptTokens = estimateTokens(promptChars);
  }
  if (usage.completionTokens === 0) {
    usage.completionTokens = estimateTokens(full.length + thinking.length);
  }

  // Calibrate the adaptive ratio from actual Ollama token counts
  if (usage.promptTokens > 0) {
    const promptChars = messages.reduce((s, m) => s + m.content.length, 0);
    calibrateTokenRatio(usage.promptTokens, promptChars);
  }
  if (usage.completionTokens > 0) {
    calibrateTokenRatio(usage.completionTokens, full.length + thinking.length);
  }

  return { content: full, thinking, toolCalls, usage };
}

// Model families that are embedding-only and do not support chat.
const EMBEDDING_MODEL_PREFIXES = ['nomic-embed', 'all-minilm', 'mxbai-embed', 'snowflake-arctic-embed', 'bge-'];

function isEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export async function listModels(baseUrl?: string): Promise<string[]> {
  const ollamaHost = baseUrl || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
  const resp = await fetch(`${ollamaHost}/api/tags`);
  if (!resp.ok) throw new Error(`Failed to list models: ${resp.status}`);
  const data = await resp.json() as { models?: Array<{ name?: string }> };
  return (data.models || [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => !isEmbeddingModel(name));
}

export async function checkOllama(baseUrl?: string): Promise<boolean> {
  try {
    const ollamaHost = baseUrl || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
    const resp = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) { ollamaHealthVerified = true; return true; }
    return false;
  } catch (e) {
    debugLog('checkOllama failed: %s', (e as Error).message);
    return false;
  }
}

/**
 * Pre-warm a model by asking Ollama to load it into memory without generating.
 * Fire-and-forget — does not block on the full load, just kicks it off.
 * Ollama loads the model weights into RAM/VRAM in the background.
 */
export function warmModel(model: string, baseUrl?: string): void {
  const ollamaHost = baseUrl || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
  fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: -1 }),
  }).catch(e => debugLog('warmModel failed: %s', (e as Error).message));
}

/**
 * Query the model's native context window size from Ollama's /api/show endpoint.
 * Returns the context length in tokens, or `undefined` if it can't be determined.
 */
export async function getModelContextLength(model: string, baseUrl?: string): Promise<number | undefined> {
  const ollamaHost = baseUrl || process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
  try {
    const resp = await fetch(`${ollamaHost}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return undefined;
    const data = await resp.json() as { model_info?: Record<string, unknown> };
    const info = data.model_info;
    if (!info) return undefined;
    // Key format: "<arch>.context_length", e.g. "llama.context_length", "qwen35.context_length"
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
        return value;
      }
    }
    return undefined;
  } catch (e) {
    debugLog('getModelContextLength failed for %s: %s', model, (e as Error).message);
    return undefined;
  }
}
