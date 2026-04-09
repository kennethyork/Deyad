import * as vscode from 'vscode';

/**
 * Status bar item showing Deyad Copilot state:
 *  ✦ Deyad (idle & enabled)
 *  ⟳ Deyad (generating)
 *  ✦ Deyad (off) (disabled)
 *  ⚠ Deyad (error)
 */
export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private generating = false;
  private enabled = true;
  private error: string | undefined;
  private model: string | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'deyadCopilot.toggle';
    this.refresh();
    this.item.show();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.error = undefined;
    this.refresh();
  }

  setGenerating(generating: boolean) {
    this.generating = generating;
    this.refresh();
  }

  setError(message: string) {
    this.error = message;
    this.refresh();
  }

  setModel(model: string) {
    this.model = model;
    this.refresh();
  }

  refresh() {
    const config = vscode.workspace.getConfiguration('deyadCopilot');
    this.enabled = config.get<boolean>('enabled', true);
    this.model = this.model || config.get<string>('model', 'qwen2.5-coder:7b');

    if (this.error) {
      this.item.text = '$(warning) Deyad';
      this.item.tooltip = `Deyad Copilot: ${this.error}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (!this.enabled) {
      this.item.text = '$(circle-slash) Deyad';
      this.item.tooltip = 'Deyad Copilot: Disabled (click to enable)';
      this.item.backgroundColor = undefined;
    } else if (this.generating) {
      this.item.text = '$(loading~spin) Deyad';
      this.item.tooltip = `Deyad Copilot: Generating... (${this.model})`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = '$(sparkle) Deyad';
      this.item.tooltip = `Deyad Copilot: Ready (${this.model}) — click to toggle`;
      this.item.backgroundColor = undefined;
    }
  }

  dispose() {
    this.item.dispose();
  }
}
