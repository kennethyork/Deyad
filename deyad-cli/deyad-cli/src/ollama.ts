/**
 * Ollama API client — streaming chat completions + multimodal support.
 * No external dependencies, uses native fetch.
 */

// ── Retry configuration ──────────────────────────────────────────────────────
/** Maximum retries for transient errors (timeouts, 429, 503). */
export const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff (doubled each retry). */
export const BACKOFF_BASE_MS = 1_000;

/** Returns true for HTTP status codes that are worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 502 || status === 504;
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
): Promise<StreamChatResult> {
  const baseUrl = process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';

  // Health check: verify Ollama is reachable before starting the stream
  try {
    const ping = await fetch(`${baseUrl}/api/tags`, { signal: signal ?? AbortSignal.timeout(5000) });
    if (!ping.ok) throw new Error(`Ollama returned ${ping.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach Ollama at ${baseUrl} — ${msg}.\n` +
      `Make sure Ollama is running: ollama serve`
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.3,
      top_p: options.top_p ?? 0.9,
      repeat_penalty: options.repeat_penalty ?? 1.1,
      ...(options.num_ctx ? { num_ctx: options.num_ctx } : {}),
    },
    ...(tools && tools.length > 0 ? { tools } : {}),
  };

  // Disable thinking by default for reasoning models (qwen3.5, etc.)
  // This dramatically reduces latency — thinking adds 5-30s of chain-of-thought.
  if (think !== undefined) {
    body.think = think;
  }

  const resp = await (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
      try {
        const r = await fetch(`${baseUrl}/api/chat`, {
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
      } catch {
        // Ignore malformed lines
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
    } catch {
      // ignore remaining buffer
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

export async function listModels(): Promise<string[]> {
  const baseUrl = process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
  const resp = await fetch(`${baseUrl}/api/tags`);
  if (!resp.ok) throw new Error(`Failed to list models: ${resp.status}`);
  const data = await resp.json() as { models?: Array<{ name?: string }> };
  return (data.models || [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === 'string')
    .filter((name) => !isEmbeddingModel(name));
}

export async function checkOllama(): Promise<boolean> {
  try {
    const baseUrl = process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}
