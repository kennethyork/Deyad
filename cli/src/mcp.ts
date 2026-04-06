/**
 * MCP (Model Context Protocol) server integration for the CLI.
 *
 * Reads config from .deyad.json or deyad.json, connects to MCP servers via stdio,
 * discovers tools, and routes tool calls to the appropriate server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Types ───────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface McpTool {
  /** Server name this tool belongs to */
  server: string;
  /** Full tool name exposed to the model: mcp_<server>_<tool> */
  qualifiedName: string;
  /** Original tool name from the MCP server */
  originalName: string;
  /** Tool description from the MCP server */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
}

// ── Manager ─────────────────────────────────────────────────────────

export class McpManager {
  private servers: ConnectedServer[] = [];

  /** Load config and connect to all configured MCP servers. */
  async connect(cwd: string, onStatus?: (msg: string) => void): Promise<void> {
    const config = loadConfig(cwd);
    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) return;

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        onStatus?.(`Connecting to MCP server: ${name}...`);
        const connected = await connectServer(name, serverConfig, cwd);
        this.servers.push(connected);
        onStatus?.(`  ✓ ${name} (${connected.tools.length} tools)`);
      } catch (err) {
        onStatus?.(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Get all discovered MCP tools. */
  getTools(): McpTool[] {
    return this.servers.flatMap(s => s.tools);
  }

  /** Build tool description text for the system prompt. */
  getToolsDescription(): string {
    const tools = this.getTools();
    if (tools.length === 0) return '';

    const lines: string[] = ['\n\nMCP SERVER TOOLS (call the same way as built-in tools):\n'];
    let idx = 16; // continue numbering after built-in tools
    for (const tool of tools) {
      const params = formatInputSchema(tool.inputSchema);
      lines.push(`${idx}. **${tool.qualifiedName}** — ${tool.description || '(no description)'}`);
      if (params) lines.push(`   ${params}`);
      idx++;
    }
    return lines.join('\n');
  }

  /** Check if a tool name belongs to an MCP server. */
  isMcpTool(toolName: string): boolean {
    return this.getTools().some(t => t.qualifiedName === toolName);
  }

  /** Execute an MCP tool call. */
  async callTool(toolName: string, params: Record<string, string>): Promise<{ success: boolean; output: string }> {
    const tool = this.getTools().find(t => t.qualifiedName === toolName);
    if (!tool) return { success: false, output: `Unknown MCP tool: ${toolName}` };

    const server = this.servers.find(s => s.name === tool.server);
    if (!server) return { success: false, output: `MCP server "${tool.server}" not connected.` };

    try {
      // Convert string params to proper types based on input schema
      const typedArgs = coerceParams(params, tool.inputSchema);
      const result = await server.client.callTool({ name: tool.originalName, arguments: typedArgs });

      // Extract text content from the result
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join('\n');

      const isError = result.isError === true;
      const output = text || (isError ? '(tool returned an error with no message)' : '(no output)');
      return { success: !isError, output: output.length > 20000 ? output.slice(0, 20000) + '\n... (truncated)' : output };
    } catch (err) {
      return { success: false, output: `MCP call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Get a summary of connected servers. */
  getStatus(): string[] {
    return this.servers.map(s => `${s.name}: ${s.tools.length} tools (${s.tools.map(t => t.originalName).join(', ')})`);
  }

  /** Disconnect all servers. */
  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.transport.close();
      } catch { /* ignore cleanup errors */ }
    }
    this.servers = [];
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Load MCP config from .deyad.json, deyad.json, or ~/.config/deyad/mcp.json */
function loadConfig(cwd: string): McpConfig {
  const candidates = [
    path.join(cwd, '.deyad.json'),
    path.join(cwd, 'deyad.json'),
  ];

  // Global config fallback
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    candidates.push(path.join(home, '.config', 'deyad', 'mcp.json'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf-8');
        return JSON.parse(raw) as McpConfig;
      } catch { /* skip invalid JSON */ }
    }
  }
  return {};
}

/** Connect to a single MCP server and discover its tools. */
async function connectServer(name: string, config: McpServerConfig, cwd: string): Promise<ConnectedServer> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
    cwd: config.cwd || cwd,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'deyad-cli', version: '1.0.0' });

  await client.connect(transport);

  // Discover tools
  const toolsResult = await client.listTools();
  const tools: McpTool[] = (toolsResult.tools || []).map(t => ({
    server: name,
    qualifiedName: `mcp_${name}_${t.name}`,
    originalName: t.name,
    description: t.description || '',
    inputSchema: (t.inputSchema || {}) as Record<string, unknown>,
  }));

  return { name, client, transport, tools };
}

/** Format input schema as parameter hints for the system prompt. */
function formatInputSchema(schema: Record<string, unknown>): string {
  const props = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
  if (!props || Object.keys(props).length === 0) return '';

  const required = new Set((schema.required as string[]) || []);
  return Object.entries(props)
    .map(([key, val]) => {
      const req = required.has(key) ? '' : ' (optional)';
      const desc = val.description ? ` — ${val.description}` : '';
      return `<param name="${key}">...${req}${desc}</param>`;
    })
    .join('\n   ');
}

/** Coerce string params to proper types based on JSON Schema. */
function coerceParams(params: Record<string, string>, schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties as Record<string, { type?: string }> | undefined;
  if (!props) return params;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const propType = props[key]?.type;
    if (propType === 'number' || propType === 'integer') {
      const num = Number(value);
      result[key] = isNaN(num) ? value : num;
    } else if (propType === 'boolean') {
      result[key] = value === 'true';
    } else if (propType === 'array' || propType === 'object') {
      try { result[key] = JSON.parse(value); } catch { result[key] = value; }
    } else {
      result[key] = value;
    }
  }
  return result;
}
