import * as vscode from 'vscode';
import * as http from 'node:http';

/**
 * Ollama client — all completions go through local Ollama only.
 * Supports FIM (fill-in-the-middle) via /api/generate and
 * chat-style completion via /api/chat as fallback.
 */
export class OllamaClient {
  private getEndpoint(): string {
    return vscode.workspace
      .getConfiguration('deyadCopilot')
      .get<string>('endpoint', 'http://localhost:11434');
  }

  /** Check if Ollama is reachable */
  async checkHealth(): Promise<boolean> {
    try {
      const resp = await this.request('GET', '/api/tags', undefined, 5000);
      return resp.status === 200;
    } catch {
      return false;
    }
  }

  /** List available models */
  async listModels(): Promise<string[]> {
    try {
      const resp = await this.request('GET', '/api/tags', undefined, 10000);
      if (resp.status !== 200) return [];
      const data = JSON.parse(resp.body) as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  /**
   * Fill-in-the-Middle completion — the best approach for code completions.
   * Uses Ollama's /api/generate with raw mode + FIM tokens.
   */
  async fim(
    model: string,
    prefix: string,
    suffix: string,
    fileName: string,
    languageId: string,
    maxTokens: number,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    // FIM format that works with qwen2.5-coder, deepseek-coder, codellama, starcoder2
    const prompt = `<|fim_prefix|>${fileHeader(fileName, languageId)}${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

    const body = JSON.stringify({
      model,
      prompt,
      raw: true,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
        stop: ['<|fim_pad|>', '<|endoftext|>', '<|file_sep|>', '\n\n\n', '<|fim_prefix|>', '<|fim_suffix|>', '<|fim_middle|>'],
      },
    });

    const resp = await this.request('POST', '/api/generate', body, 30000, signal);
    if (resp.status !== 200) {
      // FIM might not be supported — fall back to chat
      return this.chatComplete(model, prefix, suffix, fileName, languageId, maxTokens, temperature, signal);
    }

    const data = JSON.parse(resp.body) as { response?: string };
    return data.response || '';
  }

  /**
   * Chat-style completion — fallback for models without FIM support.
   */
  async chatComplete(
    model: string,
    prefix: string,
    suffix: string,
    fileName: string,
    languageId: string,
    maxTokens: number,
    temperature: number,
    signal: AbortSignal
  ): Promise<string> {
    const systemPrompt = `You are a code completion engine. Output ONLY the code that should be inserted at the cursor position. Do not include explanations, markdown, or the existing code. Continue naturally from where the code left off.`;

    const userPrompt = suffix.trim()
      ? `File: ${fileName} (${languageId})\n\nCode before cursor:\n\`\`\`\n${prefix}\n\`\`\`\n\nCode after cursor:\n\`\`\`\n${suffix}\n\`\`\`\n\nGenerate the code that goes at the cursor position.`
      : `File: ${fileName} (${languageId})\n\nCode before cursor:\n\`\`\`\n${prefix}\n\`\`\`\n\nContinue this code naturally.`;

    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
      },
    });

    const resp = await this.request('POST', '/api/chat', body, 30000, signal);
    if (resp.status !== 200) return '';

    const data = JSON.parse(resp.body) as { message?: { content?: string } };
    let content = data.message?.content || '';

    // Strip markdown code blocks if the model wraps its output
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

    return content;
  }

  /** Low-level HTTP request to Ollama — no dependencies needed */
  private request(
    method: string,
    path: string,
    body: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const endpoint = this.getEndpoint();
      let url: URL;
      try {
        url = new URL(path, endpoint);
      } catch {
        reject(new Error(`Invalid endpoint: ${endpoint}`));
        return;
      }

      const opts: http.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : {},
        timeout: timeoutMs,
      };

      const req = http.request(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (signal) {
        if (signal.aborted) {
          req.destroy();
          reject(new Error('aborted'));
          return;
        }
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('aborted'));
        });
      }

      if (body) req.write(body);
      req.end();
    });
  }
}

/** Add a file header comment so the model knows the context */
function fileHeader(fileName: string, languageId: string): string {
  const name = fileName.split(/[/\\]/).pop() || fileName;
  const commentMap: Record<string, string> = {
    javascript: '//',
    typescript: '//',
    typescriptreact: '//',
    javascriptreact: '//',
    python: '#',
    ruby: '#',
    rust: '//',
    go: '//',
    c: '//',
    cpp: '//',
    java: '//',
    kotlin: '//',
    swift: '//',
    css: '/*',
    html: '<!--',
    shell: '#',
    bash: '#',
    lua: '--',
  };
  const comment = commentMap[languageId] || '//';
  if (comment === '/*') return `/* ${name} (${languageId}) */\n`;
  if (comment === '<!--') return `<!-- ${name} (${languageId}) -->\n`;
  return `${comment} ${name} (${languageId})\n`;
}
