/**
 * Ollama / AI IPC handlers.
 */

import { ipcMain, net } from 'electron';

async function listOllamaModels(baseUrl: string): Promise<{ models: { name: string; modified_at: string; size: number; details?: Record<string, string> }[] }> {
  return new Promise((resolve, reject) => {
    const request = net.request(`${baseUrl}/api/tags`);
    let data = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { console.debug('Handled error:', err); reject(new Error('Failed to parse Ollama response')); }
      });
    });
    request.on('error', (err: Error) => reject(new Error(`Ollama not reachable: ${err.message}`)));
    request.end();
  });
}

/** Stream from Ollama (NDJSON format). Tagged with requestId for concurrency. */
function streamOllama(baseUrl: string, event: Electron.IpcMainInvokeEvent, model: string, messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }>, requestId: string, options?: Record<string, number>, tools?: unknown[], think?: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const body: Record<string, unknown> = { model, messages, stream: true };
    if (options && Object.keys(options).length > 0) body.options = options;
    if (tools && tools.length > 0) body.tools = tools;
    if (think !== undefined) body.think = think;
    const request = net.request({ method: 'POST', url: `${baseUrl}/api/chat` });
    let buffer = '';
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (!event.sender.isDestroyed()) event.sender.send('ollama:stream-done', requestId);
      resolve();
    };
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.thinking && !event.sender.isDestroyed()) {
              event.sender.send('ollama:stream-thinking', requestId, parsed.message.thinking);
            }
            if (parsed.message?.content && !event.sender.isDestroyed()) {
              event.sender.send('ollama:stream-token', requestId, parsed.message.content);
            }
            if (parsed.message?.tool_calls && !event.sender.isDestroyed()) {
              event.sender.send('ollama:stream-tool-calls', requestId, parsed.message.tool_calls);
            }
            if (parsed.done) finish();
          } catch (err) { console.debug('skip malformed:', err); }
        }
      });
      response.on('end', () => finish());
    });
    request.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        if (!event.sender.isDestroyed()) event.sender.send('ollama:stream-error', requestId, err.message);
        reject(err);
      }
    });
    request.setHeader('Content-Type', 'application/json');
    request.write(JSON.stringify(body));
    request.end();
  });
}

export function registerOllamaHandlers(getOllamaBaseUrl: () => string): void {
  ipcMain.handle('ollama:list-models', async () => {
    return listOllamaModels(getOllamaBaseUrl());
  });

  ipcMain.handle('ollama:chat-stream', async (event, { model, messages, requestId, options, tools, think }: { model: string; messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_name?: string }>; requestId: string; options?: Record<string, number>; tools?: unknown[]; think?: boolean }) => {
    return streamOllama(getOllamaBaseUrl(), event, model, messages, requestId, options, tools, think);
  });

  /** Fill-in-the-middle completion for inline autocomplete. */
  ipcMain.handle('ollama:fim-complete', async (_event, { model, prompt, suffix, stop }: { model: string; prompt: string; suffix?: string; stop?: string[] }) => {
    return new Promise<string>((resolve, reject) => {
      const body: Record<string, unknown> = {
        model,
        prompt,
        stream: false,
        options: { temperature: 0.15, num_predict: 256, top_p: 0.9, repeat_penalty: 1.1, stop: stop || ['\n\n', '```'] },
      };
      if (suffix) body.suffix = suffix;
      const request = net.request({ method: 'POST', url: `${getOllamaBaseUrl()}/api/generate` });
      let data = '';
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.response || '');
          } catch (err) { console.debug('Handled error:', err); resolve(''); }
        });
      });
      request.on('error', (err: Error) => reject(err));
      request.setHeader('Content-Type', 'application/json');
      request.write(JSON.stringify(body));
      request.end();
    });
  });

  /** Generate embeddings via Ollama for codebase indexing. */
  ipcMain.handle('ollama:embed', async (_event, { model, input }: { model: string; input: string | string[] }) => {
    return new Promise<{ embeddings: number[][] }>((resolve, reject) => {
      const body = JSON.stringify({ model, input });
      const request = net.request({ method: 'POST', url: `${getOllamaBaseUrl()}/api/embed` });
      let data = '';
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ embeddings: parsed.embeddings || [] });
          } catch (err) { console.debug('Handled error:', err); resolve({ embeddings: [] }); }
        });
      });
      request.on('error', (err: Error) => reject(err));
      request.setHeader('Content-Type', 'application/json');
      request.write(body);
      request.end();
    });
  });
}
