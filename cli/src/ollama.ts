/**
 * Ollama API client — streaming chat completions.
 * No external dependencies, uses native fetch.
 */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  num_ctx?: number;
}

/**
 * Stream a chat completion from Ollama.
 * Calls onToken for each token, returns the full response when done.
 */
export async function streamChat(
  model: string,
  messages: OllamaMessage[],
  onToken: (token: string) => void,
  options: OllamaOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
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
        if (json.message?.content) {
          full += json.message.content;
          onToken(json.message.content);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buf.trim()) {
    try {
      const json = JSON.parse(buf);
      if (json.message?.content) {
        full += json.message.content;
        onToken(json.message.content);
      }
    } catch {
      // ignore
    }
  }

  return full;
}

/** List available chat models from Ollama (excludes embedding models). */
export async function listModels(): Promise<string[]> {
  const baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const resp = await fetch(`${baseUrl}/api/tags`);
  if (!resp.ok) throw new Error(`Failed to list models: ${resp.status}`);
  const data = await resp.json() as { models?: Array<{ name: string; details?: { family?: string } }> };
  const EMBED_PATTERNS = /embed|nomic-embed|bge-|e5-|gte-/i;
  return (data.models || [])
    .map((m) => m.name)
    .filter((name) => !EMBED_PATTERNS.test(name));
}

/** Check if Ollama is reachable. */
export async function checkOllama(): Promise<boolean> {
  try {
    const baseUrl = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}
