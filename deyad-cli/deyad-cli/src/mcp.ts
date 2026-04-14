/**
 * MCP (Model Context Protocol) client — connect to external tool servers.
 *
 * Supports stdio transport: launches an MCP server as a child process
 * and communicates via JSON-RPC 2.0 over stdin/stdout.
 *
 * Config file: .deyad/mcp.json in the project root.
 * Format:
 * {
 *   "servers": {
 *     "my-server": {
 *       "command": "npx",
 *       "args": ["-y", "@my/mcp-server"]
 *     }
 *   }
 * }
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { OllamaTool } from './ollama.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// ── MCP Server Connection ─────────────────────────────────────────────────────

class MCPConnection {
  private process: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: JSONRPCResponse) => void; reject: (e: Error) => void }>();
  private rl: readline.Interface;
  public tools: MCPToolDef[] = [];
  public serverName: string;

  constructor(name: string, config: MCPServerConfig) {
    this.serverName = name;

    // Sanitize: don't pass arbitrary env to child
    const env = { ...process.env, ...(config.env || {}) };

    this.process = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });
    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as JSONRPCResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const req = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          req.resolve(msg);
        }
      } catch { /* ignore non-JSON lines */ }
    });

    this.process.on('error', (err) => {
      if (process.env['DEYAD_DEBUG']) console.error(`[mcp] ${name} process error:`, err);
      // Reject all pending requests on spawn/process error
      for (const [, req] of this.pending) {
        req.reject(new Error(`MCP server '${name}' error: ${err.message}`));
      }
      this.pending.clear();
    });
    this.process.on('exit', () => {
      // Reject all pending requests
      for (const [, req] of this.pending) {
        req.reject(new Error(`MCP server '${name}' exited`));
      }
      this.pending.clear();
    });
  }

  private send(method: string, params?: Record<string, unknown>): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 30000);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      const msg: JSONRPCRequest = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
      try {
        this.process.stdin!.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`MCP stdin write failed: ${(err as Error).message}`));
      }
    });
  }

  async initialize(): Promise<void> {
    const resp = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'deyad-cli', version: '0.5.0' },
    });
    if (resp.error) throw new Error(`MCP init failed: ${resp.error.message}`);

    // Send initialized notification (no response expected, but send as request for simplicity)
    this.process.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');
  }

  async listTools(): Promise<MCPToolDef[]> {
    const resp = await this.send('tools/list', {});
    if (resp.error) throw new Error(`MCP tools/list failed: ${resp.error.message}`);
    const result = resp.result as { tools?: MCPToolDef[] };
    this.tools = result?.tools || [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const resp = await this.send('tools/call', { name, arguments: args });
    if (resp.error) {
      return { content: [{ type: 'text', text: resp.error.message }], isError: true };
    }
    return resp.result as MCPToolResult;
  }

  close(): void {
    try { this.rl.close(); } catch { /* ignore */ }
    try { this.process.stdin!.end(); } catch { /* ignore */ }
    try { this.process.kill('SIGTERM'); } catch { /* ignore */ }
    this.pending.clear();
  }
}

// ── MCP Manager ───────────────────────────────────────────────────────────────

const connections = new Map<string, MCPConnection>();
/** Maps "mcp__server__tool" to [connection, toolName] */
const toolMapping = new Map<string, [MCPConnection, string]>();

/**
 * Read .deyad/mcp.json from the project root and start all configured servers.
 * Returns the list of discovered MCP tools.
 */
export async function initMCP(cwd: string): Promise<MCPToolDef[]> {
  const configPath = path.join(cwd, '.deyad', 'mcp.json');
  if (!fs.existsSync(configPath)) return [];

  let config: MCPConfig;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw) as MCPConfig;
  } catch (err) {
    if (process.env['DEYAD_DEBUG']) console.error('[mcp] Invalid config:', err);
    return [];
  }

  if (!config.servers || typeof config.servers !== 'object') return [];

  const allTools: MCPToolDef[] = [];

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    // Validate config
    if (!serverConfig.command || typeof serverConfig.command !== 'string') continue;

    try {
      const conn = new MCPConnection(name, serverConfig);
      await conn.initialize();
      const tools = await conn.listTools();

      connections.set(name, conn);

      for (const tool of tools) {
        const qualifiedName = `mcp__${name}__${tool.name}`;
        toolMapping.set(qualifiedName, [conn, tool.name]);
        allTools.push({ ...tool, name: qualifiedName });
      }

      if (process.env['DEYAD_DEBUG']) {
        console.error(`[mcp] ${name}: ${tools.length} tools loaded`);
      }
    } catch (err) {
      if (process.env['DEYAD_DEBUG']) console.error(`[mcp] Failed to connect to ${name}:`, err);
    }
  }

  return allTools;
}

/**
 * Check if a tool name belongs to an MCP server.
 */
export function isMCPTool(name: string): boolean {
  return toolMapping.has(name);
}

/**
 * Execute an MCP tool call.
 */
export async function executeMCPTool(
  name: string,
  params: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  const mapping = toolMapping.get(name);
  if (!mapping) return { success: false, output: `Unknown MCP tool: ${name}` };

  const [conn, toolName] = mapping;
  try {
    const result = await conn.callTool(toolName, params);
    const text = result.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n') || '(no output)';
    return { success: !result.isError, output: text };
  } catch (err) {
    return { success: false, output: `MCP error: ${(err as Error).message}` };
  }
}

/**
 * Convert discovered MCP tools to Ollama native tool format.
 */
export function getMCPOllamaTools(): OllamaTool[] {
  const tools: OllamaTool[] = [];
  for (const [qualifiedName, [conn]] of toolMapping) {
    const toolDef = conn.tools.find(t => qualifiedName === `mcp__${conn.serverName}__${t.name}`);
    if (!toolDef) continue;

    const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
    const required: string[] = [];

    if (toolDef.inputSchema?.properties) {
      for (const [key, val] of Object.entries(toolDef.inputSchema.properties)) {
        properties[key] = { type: val.type || 'string', description: val.description };
        if (val.enum) properties[key].enum = val.enum;
      }
    }
    if (toolDef.inputSchema?.required) {
      required.push(...toolDef.inputSchema.required);
    }

    tools.push({
      type: 'function',
      function: {
        name: qualifiedName,
        description: toolDef.description || `MCP tool: ${toolDef.name}`,
        parameters: { type: 'object', properties, ...(required.length > 0 ? { required } : {}) },
      },
    });
  }
  return tools;
}

/**
 * Get MCP tool descriptions for the system prompt.
 */
export function getMCPToolsDescription(): string {
  if (toolMapping.size === 0) return '';

  const lines: string[] = ['\nMCP (EXTERNAL TOOLS):'];
  for (const [qualifiedName, [conn]] of toolMapping) {
    const toolDef = conn.tools.find(t => qualifiedName === `mcp__${conn.serverName}__${t.name}`);
    if (!toolDef) continue;
    const params = toolDef.inputSchema?.properties
      ? Object.keys(toolDef.inputSchema.properties).join(', ')
      : '';
    lines.push(`- ${qualifiedName}: ${toolDef.description || 'no description'}${params ? `. Params: ${params}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Shut down all MCP server connections.
 */
export function closeMCP(): void {
  for (const [, conn] of connections) {
    conn.close();
  }
  connections.clear();
  toolMapping.clear();
}
