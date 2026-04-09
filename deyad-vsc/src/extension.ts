import * as vscode from 'vscode';
import { OllamaClient } from './ollama';
import { StatusBar } from './statusbar';

let statusBar: StatusBar;
let completionProvider: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
  const ollama = new OllamaClient();
  statusBar = new StatusBar();

  // Register inline completion provider
  completionProvider = registerCompletionProvider(ollama, statusBar);
  context.subscriptions.push(completionProvider);
  context.subscriptions.push(statusBar);

  // Toggle command
  context.subscriptions.push(
    vscode.commands.registerCommand('deyadCopilot.toggle', () => {
      const config = vscode.workspace.getConfiguration('deyadCopilot');
      const current = config.get<boolean>('enabled', true);
      config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      statusBar.setEnabled(!current);
      vscode.window.showInformationMessage(
        `Deyad Copilot ${!current ? 'enabled' : 'disabled'}`
      );
    })
  );

  // Select model command
  context.subscriptions.push(
    vscode.commands.registerCommand('deyadCopilot.selectModel', async () => {
      const models = await ollama.listModels();
      if (models.length === 0) {
        vscode.window.showErrorMessage('No Ollama models found. Is Ollama running?');
        return;
      }
      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select a model for code completions',
      });
      if (picked) {
        const config = vscode.workspace.getConfiguration('deyadCopilot');
        await config.update('model', picked, vscode.ConfigurationTarget.Global);
        statusBar.setModel(picked);
        vscode.window.showInformationMessage(`Deyad Copilot: switched to ${picked}`);
      }
    })
  );

  // Re-register provider when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('deyadCopilot')) {
        statusBar.refresh();
      }
    })
  );

  // Check Ollama connectivity on startup
  ollama.checkHealth().then((ok) => {
    if (!ok) {
      statusBar.setError('Ollama not running');
      vscode.window.showWarningMessage(
        'Deyad Copilot: Cannot connect to Ollama. Start it with: ollama serve'
      );
    } else {
      statusBar.setEnabled(
        vscode.workspace.getConfiguration('deyadCopilot').get<boolean>('enabled', true)
      );
    }
  });
}

function registerCompletionProvider(
  ollama: OllamaClient,
  statusBar: StatusBar
): vscode.Disposable {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let abortController: AbortController | undefined;

  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      _context: vscode.InlineCompletionContext,
      token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
      const config = vscode.workspace.getConfiguration('deyadCopilot');
      if (!config.get<boolean>('enabled', true)) return;

      // Cancel previous request
      if (abortController) {
        abortController.abort();
      }
      abortController = new AbortController();
      const signal = abortController.signal;

      // Debounce
      const debounceMs = config.get<number>('debounceMs', 300);
      await new Promise<void>((resolve, reject) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(resolve, debounceMs);
        token.onCancellationRequested(() => reject(new Error('cancelled')));
        signal.addEventListener('abort', () => reject(new Error('cancelled')));
      }).catch(() => undefined);

      if (token.isCancellationRequested || signal.aborted) return;

      const model = config.get<string>('model', 'qwen2.5-coder:7b');
      const maxTokens = config.get<number>('maxTokens', 256);
      const temperature = config.get<number>('temperature', 0.2);
      const contextLines = config.get<number>('contextLines', 50);
      const fimEnabled = config.get<boolean>('fimEnabled', true);

      // Build context: lines before and after cursor
      const startLine = Math.max(0, position.line - contextLines);
      const endLine = Math.min(document.lineCount - 1, position.line + contextLines);

      const prefix = document.getText(
        new vscode.Range(startLine, 0, position.line, position.character)
      );
      const suffix = document.getText(
        new vscode.Range(position.line, position.character, endLine + 1, 0)
      );

      const fileName = document.fileName;
      const languageId = document.languageId;

      statusBar.setGenerating(true);

      try {
        let completion: string;

        if (fimEnabled) {
          // Fill-in-the-Middle — best for code completion
          completion = await ollama.fim(
            model, prefix, suffix, fileName, languageId,
            maxTokens, temperature, signal
          );
        } else {
          // Fallback: chat-style completion
          completion = await ollama.chatComplete(
            model, prefix, suffix, fileName, languageId,
            maxTokens, temperature, signal
          );
        }

        if (token.isCancellationRequested || signal.aborted || !completion) return;

        // Clean up the completion
        completion = cleanCompletion(completion, prefix);
        if (!completion.trim()) return;

        return [
          new vscode.InlineCompletionItem(
            completion,
            new vscode.Range(position, position)
          ),
        ];
      } catch (err: unknown) {
        const msg = (err as Error)?.message || '';
        if (!msg.includes('abort') && !msg.includes('cancel')) {
          console.error('[deyad-copilot] completion error:', err);
        }
        return;
      } finally {
        statusBar.setGenerating(false);
      }
    },
  };

  return vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    provider
  );
}

/** Remove common artifacts from model output */
function cleanCompletion(text: string, prefix: string): string {
  // Remove leading newline if cursor is mid-line
  if (prefix.length > 0 && !prefix.endsWith('\n')) {
    text = text.replace(/^\n/, '');
  }

  // Stop at natural boundaries — don't generate too many blocks
  const lines = text.split('\n');
  let blankCount = 0;
  let cutIndex = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === '') {
      blankCount++;
      if (blankCount >= 2) {
        cutIndex = i;
        break;
      }
    } else {
      blankCount = 0;
    }
  }

  return lines.slice(0, cutIndex).join('\n');
}

export function deactivate() {
  completionProvider?.dispose();
}
