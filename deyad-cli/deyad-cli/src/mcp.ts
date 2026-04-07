export class McpManager {
  async connect(_cwd: string, _log?: (msg: string) => void): Promise<void> {
    return;
  }

  getTools(): Array<string> {
    return [];
  }

  getToolsDescription(): string {
    return '';
  }

  getStatus(): Array<string> {
    return [];
  }

  isMcpTool(_name: string): boolean {
    return false;
  }

  async disconnect(): Promise<void> {
    return;
  }
}
