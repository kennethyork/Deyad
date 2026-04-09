/**
 * Tests for MCP client — config parsing, tool routing, error handling.
 * Tests without requiring actual MCP servers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initMCP, closeMCP, isMCPTool, executeMCPTool, getMCPOllamaTools, getMCPToolsDescription } from '../src/mcp.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-mcp-test-'));
});

afterEach(() => {
  closeMCP();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initMCP', () => {
  it('returns empty array when no config file exists', async () => {
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });

  it('returns empty array for invalid JSON config', async () => {
    const dir = path.join(tmpDir, '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), 'not json');
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });

  it('returns empty array for config with no servers', async () => {
    const dir = path.join(tmpDir, '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ servers: {} }));
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });

  it('returns empty array for config with missing servers key', async () => {
    const dir = path.join(tmpDir, '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ other: 'stuff' }));
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });

  it('skips servers with invalid command', async () => {
    const dir = path.join(tmpDir, '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
      servers: {
        bad: { command: '' },
        worse: { command: 123 },
      },
    }));
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });

  it('handles server that fails to start', async () => {
    const dir = path.join(tmpDir, '.deyad');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
      servers: {
        ghost: { command: 'nonexistent-command-xyz-12345' },
      },
    }));
    const tools = await initMCP(tmpDir);
    expect(tools).toEqual([]);
  });
});

describe('isMCPTool', () => {
  it('returns false for non-MCP tools', () => {
    expect(isMCPTool('read_file')).toBe(false);
    expect(isMCPTool('browser')).toBe(false);
    expect(isMCPTool('mcp__unknown__tool')).toBe(false);
  });
});

describe('executeMCPTool', () => {
  it('returns error for unknown MCP tool', async () => {
    const result = await executeMCPTool('mcp__fake__tool', {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown MCP tool');
  });
});

describe('getMCPOllamaTools', () => {
  it('returns empty array when no MCP servers loaded', () => {
    const tools = getMCPOllamaTools();
    expect(tools).toEqual([]);
  });
});

describe('getMCPToolsDescription', () => {
  it('returns empty string when no MCP servers loaded', () => {
    expect(getMCPToolsDescription()).toBe('');
  });
});

describe('closeMCP', () => {
  it('can be called multiple times safely', () => {
    closeMCP();
    closeMCP();
    closeMCP();
  });
});

describe('MCP tool routing via executeTool', () => {
  it('returns error for unknown MCP-prefixed tool', async () => {
    const { executeTool } = await import('../src/tools.js');
    const result = await executeTool(
      { name: 'mcp__nonexistent__tool', params: {} },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown');
  });
});
