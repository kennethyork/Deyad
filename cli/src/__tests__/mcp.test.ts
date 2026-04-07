/**
 * Tests for MCP module — config loading, tool description formatting, param coercion.
 * Does NOT connect to real MCP servers — tests the pure logic functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpManager } from '../mcp.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-mcp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('McpManager', () => {
  it('starts with no tools', () => {
    const mgr = new McpManager();
    expect(mgr.getTools()).toEqual([]);
    expect(mgr.getStatus()).toEqual([]);
  });

  it('isMcpTool returns false for unknown tools', () => {
    const mgr = new McpManager();
    expect(mgr.isMcpTool('mcp_github_list_repos')).toBe(false);
    expect(mgr.isMcpTool('read_file')).toBe(false);
  });

  it('getToolsDescription returns empty string with no tools', () => {
    const mgr = new McpManager();
    expect(mgr.getToolsDescription()).toBe('');
  });

  it('callTool returns error for unknown tool', async () => {
    const mgr = new McpManager();
    const result = await mgr.callTool('mcp_nonexistent_tool', { foo: 'bar' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown MCP tool');
  });

  it('connect with no config does nothing', async () => {
    const mgr = new McpManager();
    const onStatus = vi.fn();
    await mgr.connect(tmpDir, onStatus);
    expect(mgr.getTools()).toEqual([]);
    // No status calls since no servers configured
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('connect reads .deyad.json config', async () => {
    // Write config with an invalid server (won't actually connect but tests config loading)
    const config = {
      mcpServers: {
        test: {
          command: 'nonexistent-binary-xyz',
          args: ['--stdio'],
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, '.deyad.json'), JSON.stringify(config));

    const mgr = new McpManager();
    const onStatus = vi.fn();
    await mgr.connect(tmpDir, onStatus);

    // Should have attempted connection and reported failure
    expect(onStatus).toHaveBeenCalledWith('Connecting to MCP server: test...');
    // The connection should fail since the binary doesn't exist
    const failCall = onStatus.mock.calls.find(
      (c: string[]) => typeof c[0] === 'string' && c[0].includes('✗ test'),
    );
    expect(failCall).toBeTruthy();
  });

  it('connect reads deyad.json config (alternative name)', async () => {
    const config = { mcpServers: { alt: { command: 'no-such-binary' } } };
    fs.writeFileSync(path.join(tmpDir, 'deyad.json'), JSON.stringify(config));

    const mgr = new McpManager();
    const onStatus = vi.fn();
    await mgr.connect(tmpDir, onStatus);

    expect(onStatus).toHaveBeenCalledWith('Connecting to MCP server: alt...');
  });

  it('connect skips invalid JSON config gracefully', async () => {
    fs.writeFileSync(path.join(tmpDir, '.deyad.json'), 'not valid json {{{');

    const mgr = new McpManager();
    const onStatus = vi.fn();
    await mgr.connect(tmpDir, onStatus);

    // Should not crash, just skip
    expect(mgr.getTools()).toEqual([]);
  });

  it('connect with empty mcpServers does nothing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.deyad.json'), JSON.stringify({ mcpServers: {} }));

    const mgr = new McpManager();
    const onStatus = vi.fn();
    await mgr.connect(tmpDir, onStatus);

    expect(onStatus).not.toHaveBeenCalled();
    expect(mgr.getTools()).toEqual([]);
  });

  it('disconnect on empty manager does not throw', async () => {
    const mgr = new McpManager();
    await expect(mgr.disconnect()).resolves.toBeUndefined();
  });
});
