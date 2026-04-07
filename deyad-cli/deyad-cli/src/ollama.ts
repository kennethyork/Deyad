/**
 * Ollama API client — streaming chat completions + multimodal support.
 * No external dependencies, uses native fetch.
 */

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

export const CHARS_PER_TOKEN = 4.0;

export function estimateTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

export async function streamChat(
  model: string,
  messages: OllamaMessage[],
  onToken: (token: string) => void,
  options: OllamaOptions = {},
  signal?: AbortSignal,
  onThinkingToken?: (token: string) => void,
  tools?: OllamaTool[],
): Promise<StreamChatResult> {
  const baseUrl = process.env['OLLAMA_HOST'] || 'http://127.0.0.1:11434';
  const body = {
    model,
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.7,
      top_p: options.top_p ?? 0.9,
      repeat_penalty: options.repeat_penalty ?? 1.1,
      ...(options.num_ctx ? { num_ctx: options.num_ctx } : {}),
    },
    ...(tools && tools.length > 0 ? { tools } : {}),
  };

  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error ${resp.status}: ${text}`);
  }

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
