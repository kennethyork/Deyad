/**
 * Tests for debugLog utility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debugLog } from '../src/debug.js';

describe('debugLog', () => {
  const originalEnv = process.env['DEYAD_DEBUG'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['DEYAD_DEBUG'] = originalEnv;
    } else {
      delete process.env['DEYAD_DEBUG'];
    }
    vi.restoreAllMocks();
  });

  it('does not log when DEYAD_DEBUG is unset', () => {
    delete process.env['DEYAD_DEBUG'];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugLog('should not appear');
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs to stderr when DEYAD_DEBUG is set', () => {
    process.env['DEYAD_DEBUG'] = '1';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugLog('test message');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain('[deyad:debug]');
    expect(spy.mock.calls[0]![0]).toContain('test message');
  });

  it('passes extra arguments through', () => {
    process.env['DEYAD_DEBUG'] = '1';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugLog('msg %s', 'arg1', 42);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![1]).toBe('arg1');
    expect(spy.mock.calls[0]![2]).toBe(42);
  });

  it('works with empty string DEYAD_DEBUG', () => {
    process.env['DEYAD_DEBUG'] = '';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    debugLog('nope');
    expect(spy).not.toHaveBeenCalled();
  });
});
