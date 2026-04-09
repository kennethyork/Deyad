/**
 * Tests for headless browser automation (CDP-based).
 * Tests the action dispatcher and error handling without launching Chrome.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeBrowserAction, closeBrowser } from '../src/browser.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Mock the internal CDP functions by testing the public executeBrowserAction
// which validates params before attempting browser connection.

describe('executeBrowserAction — param validation', () => {
  it('rejects missing action', async () => {
    const result = await executeBrowserAction('', {}, '/tmp');
    expect(result.success).toBe(false);
  });

  it('rejects unknown action', async () => {
    const result = await executeBrowserAction('fly', {}, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown browser action');
    expect(result.output).toContain('navigate');
  });

  it('rejects navigate without url', async () => {
    const result = await executeBrowserAction('navigate', {}, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('url');
  });

  it('rejects navigate with invalid url', async () => {
    const result = await executeBrowserAction('navigate', { url: 'not-a-url' }, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Invalid URL');
  });

  it('rejects click without selector', async () => {
    const result = await executeBrowserAction('click', {}, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('selector');
  });

  it('rejects type without selector', async () => {
    const result = await executeBrowserAction('type', {}, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('selector');
  });

  it('rejects type without text', async () => {
    const result = await executeBrowserAction('type', { selector: '#input' }, '/tmp');
    expect(result.success).toBe(false);
    expect(result.output).toContain('text');
  });

  it('close succeeds even when no browser is open', async () => {
    const result = await executeBrowserAction('close', {}, '/tmp');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Browser closed');
  });
});

describe('closeBrowser', () => {
  it('can be called multiple times safely', () => {
    closeBrowser();
    closeBrowser();
    closeBrowser();
    // No errors thrown
  });
});

describe('browser tool via executeTool', () => {
  it('routes to browser action handler', async () => {
    const { executeTool } = await import('../src/tools.js');
    const result = await executeTool(
      { name: 'browser', params: { action: 'close' } },
      '/tmp',
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('Browser closed');
  });

  it('returns error for missing action', async () => {
    const { executeTool } = await import('../src/tools.js');
    const result = await executeTool(
      { name: 'browser', params: {} },
      '/tmp',
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('action');
  });
});
