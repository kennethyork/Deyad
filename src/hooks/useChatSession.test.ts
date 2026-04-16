// @vitest-environment happy-dom
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatSession } from './useChatSession';
import type { UiMessage } from './useChatSession';

// ---- Mocks ----

vi.mock('../lib/contextBuilder', () => ({
  buildSmartContext: vi.fn(() => 'mocked context'),
}));

vi.mock('../lib/codeParser', () => ({
  FRONTEND_SYSTEM_PROMPT: 'SYSTEM_FE',
  PLANNING_SYSTEM_PROMPT: 'SYSTEM_PLAN',
  PLAN_EXECUTION_PROMPT: 'Execute the plan.',
  getFullStackSystemPrompt: () => 'SYSTEM_FS',
  extractFilesFromResponse: vi.fn(() => []),
}));

vi.mock('../lib/agentLoop', () => ({
  runAgentLoop: vi.fn(() => vi.fn()),
}));

vi.mock('../lib/agentTools', () => ({
  stripToolMarkup: vi.fn((t: string) => t),
}));

vi.mock('../lib/errorDetector', () => ({
  detectErrors: vi.fn(() => []),
  buildErrorFixPrompt: vi.fn(() => 'fix these errors'),
}));

// ---- Helpers ----

function makeDeyadMock(): DeyadAPI {
  return {
    listModels: vi.fn().mockResolvedValue({ models: [{ name: 'llama3', modified_at: '', size: 0 }] }),
    getSettings: vi.fn().mockResolvedValue({ defaultModel: 'llama3', ollamaHost: '' }),
    chatStream: vi.fn().mockResolvedValue(undefined),
    onStreamToken: vi.fn().mockReturnValue(() => {}),
    onStreamDone: vi.fn().mockReturnValue(() => {}),
    onStreamError: vi.fn().mockReturnValue(() => {}),
    onStreamToolCalls: vi.fn().mockReturnValue(() => {}),
    onAppDevLog: vi.fn().mockReturnValue(() => {}),
    loadMessages: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(true),
    readFiles: vi.fn().mockResolvedValue({ 'src/App.tsx': 'export default () => <div/>' }),
    dbDescribe: vi.fn().mockResolvedValue({ tables: [] }),
  } as unknown as DeyadAPI;
}

const defaultProps = () => ({
  app: { id: 'a1', name: 'Test', description: '', createdAt: new Date().toISOString(), appType: 'frontend' as const },
  appFiles: { 'src/App.tsx': 'code' },
  selectedFile: null,
  dbStatus: 'none' as const,
  onFilesUpdated: vi.fn(),
  initialPrompt: null as string | null,
  onInitialPromptConsumed: vi.fn(),
});

// ---- Tests ----

describe('useChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.deyad = makeDeyadMock();
  });

  it('initializes with empty messages and no streaming', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.streaming).toBe(false);
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.input).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('loads models on mount', async () => {
    renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(window.deyad.listModels).toHaveBeenCalled();
      expect(window.deyad.getSettings).toHaveBeenCalled();
    });
  });

  it('sets error when models fail to load after retries', async () => {
    window.deyad.listModels = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.error).toBe('Could not connect to Ollama. Make sure it is running.');
    }, { timeout: 10000 });
  });

  it('loads saved messages when app changes', async () => {
    const saved: UiMessage[] = [{ id: '1', role: 'user', content: 'hello' }];
    window.deyad.loadMessages = vi.fn().mockResolvedValue(saved);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.messages).toEqual(saved);
    });
  });

  it('falls back to empty on loadMessages error', async () => {
    window.deyad.loadMessages = vi.fn().mockRejectedValue(new Error('corrupt'));

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
    });
  });

  it('tokenCount returns approximate token estimation', async () => {
    const saved: UiMessage[] = [
      { id: '1', role: 'user', content: 'a'.repeat(400) },
      { id: '2', role: 'assistant', content: 'b'.repeat(400) },
    ];
    window.deyad.loadMessages = vi.fn().mockResolvedValue(saved);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      // 800 chars / 4 = 200 tokens
      expect(result.current.tokenCount).toBe(200);
    });
  });

  it('tokenCount is 0 with no messages', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.tokenCount).toBe(0);
    });
  });

  it('mode defaults to chat', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    expect(result.current.mode).toBe('chat');
    expect(result.current.planningMode).toBe(false);
    expect(result.current.agentMode).toBe(false);
  });

  it('setMode switches between modes', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    act(() => result.current.setMode('planning'));
    expect(result.current.mode).toBe('planning');
    expect(result.current.planningMode).toBe(true);
    expect(result.current.agentMode).toBe(false);

    act(() => result.current.setMode('agent'));
    expect(result.current.mode).toBe('agent');
    expect(result.current.planningMode).toBe(false);
    expect(result.current.agentMode).toBe(true);
  });

  it('setInput updates input state', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    act(() => result.current.setInput('hello world'));
    expect(result.current.input).toBe('hello world');
  });

  it('pendingPlan is null initially', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    expect(result.current.pendingPlan).toBeNull();
  });

  it('handleRejectPlan clears pendingPlan', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    // Can call handleRejectPlan without error
    act(() => result.current.handleRejectPlan());
    expect(result.current.pendingPlan).toBeNull();
  });

  it('handleDismissErrors clears detectedErrors', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    act(() => result.current.handleDismissErrors());
    expect(result.current.detectedErrors).toEqual([]);
  });

  it('handleStopAgent sets error and stops streaming', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    act(() => result.current.handleStopAgent());
    expect(result.current.error).toBe('Agent stopped by user');
  });

  it('handleSend does nothing when input is empty', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.models.length).toBeGreaterThan(0);
    });

    act(() => result.current.setInput(''));
    act(() => result.current.handleSend());
    // No message added
    expect(result.current.messages).toEqual([]);
  });

  it('handleSend in chat mode calls chatStream', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('Build a form'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(window.deyad.chatStream).toHaveBeenCalled();
    });

    // User message should appear
    const userMsgs = result.current.messages.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    expect(userMsgs[0].content).toBe('Build a form');
  });

  it('handleSend detects git commands and uses agent mode', async () => {
    const { runAgentLoop } = await import('../lib/agentLoop');
    const mockRunAgentLoop = vi.mocked(runAgentLoop);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('git commit -m "test"'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(mockRunAgentLoop).toHaveBeenCalled();
    });
  });

  it('handleSend in agent mode uses runAgentLoop', async () => {
    const { runAgentLoop } = await import('../lib/agentLoop');
    const mockRunAgentLoop = vi.mocked(runAgentLoop);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setMode('agent'));
    act(() => result.current.setInput('Refactor the component'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(mockRunAgentLoop).toHaveBeenCalled();
    });
  });

  it('clears input after sendMessage', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('hello'));
    act(() => result.current.handleSend());

    expect(result.current.input).toBe('');
  });

  it('handleSend shows error when no model selected', async () => {
    window.deyad.listModels = vi.fn().mockResolvedValue({ models: [] });
    window.deyad.getSettings = vi.fn().mockResolvedValue({ defaultModel: '' });

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('');
    });

    act(() => result.current.setInput('test prompt'));
    act(() => result.current.handleSend());

    expect(result.current.error).toContain('No model selected');
  });

  it('handleRetry resets error and reloads models', async () => {
    window.deyad.listModels = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue({ models: [{ name: 'm1', modified_at: '', size: 0 }] });

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    }, { timeout: 10000 });

    act(() => result.current.handleRetry());

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
  });

  it('setModelState updates models and selectedModel', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    act(() => result.current.setModelState({ models: ['a', 'b'], selectedModel: 'b' }));
    expect(result.current.models).toEqual(['a', 'b']);
    expect(result.current.selectedModel).toBe('b');
  });

  it('agentSteps is empty initially', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    expect(result.current.agentSteps).toEqual([]);
  });

  it('imageAttachment is null initially', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    expect(result.current.imageAttachment).toBeNull();
  });

  it('setImageAttachment updates imageAttachment', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    act(() => result.current.setImageAttachment('data:image/png;base64,abc'));
    expect(result.current.imageAttachment).toBe('data:image/png;base64,abc');
  });

  it('MAX_AUTO_FIX_ATTEMPTS is 3', () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    expect(result.current.MAX_AUTO_FIX_ATTEMPTS).toBe(3);
  });

  it('handleAutoFix calls sendMessage with error fix prompt', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    // Should clear detected errors
    act(() => result.current.handleAutoFix());
    expect(result.current.detectedErrors).toEqual([]);
  });

  it('handleApprovePlan triggers sendMessage', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.handleApprovePlan());

    await waitFor(() => {
      // Should add a user message "Execute the plan above."
      const userMsgs = result.current.messages.filter((m) => m.role === 'user');
      expect(userMsgs.some((m) => m.content.includes('Execute the plan above'))).toBe(true);
    });
  });

  it('consumes initialPrompt and sends message', async () => {
    const consumed = vi.fn();
    const props = {
      ...defaultProps(),
      initialPrompt: 'Create a todo app',
      onInitialPromptConsumed: consumed,
    };

    renderHook(() => useChatSession(props));

    await waitFor(() => {
      expect(consumed).toHaveBeenCalled();
    });
  });

  it('registers onAppDevLog listener', () => {
    renderHook(() => useChatSession(defaultProps()));
    expect(window.deyad.onAppDevLog).toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useChatSession(defaultProps()));
    // Should not throw
    unmount();
  });

  it('handles fullstack app with DB schema context', async () => {
    window.deyad.dbDescribe = vi.fn().mockResolvedValue({
      tables: [{ name: 'users', columns: ['id', 'name', 'email'] }],
    });

    const props = {
      ...defaultProps(),
      app: { id: 'a2', name: 'FS App', description: '', createdAt: new Date().toISOString(), appType: 'fullstack' as const },
      dbStatus: 'running' as const,
    };

    const { result } = renderHook(() => useChatSession(props));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('Add a login page'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(window.deyad.dbDescribe).toHaveBeenCalledWith('a2');
    });
  });

  it('handleSend with agent mode and git push uses agent loop', async () => {
    const { runAgentLoop } = await import('../lib/agentLoop');
    const mockLoop = vi.mocked(runAgentLoop);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('git push origin main'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(mockLoop).toHaveBeenCalled();
    });
  });

  it('handleSend detects git pull as agent command', async () => {
    const { runAgentLoop } = await import('../lib/agentLoop');
    const mockLoop = vi.mocked(runAgentLoop);

    const { result } = renderHook(() => useChatSession(defaultProps()));

    await waitFor(() => {
      expect(result.current.selectedModel).toBe('llama3');
    });

    act(() => result.current.setInput('git pull origin main'));
    act(() => result.current.handleSend());

    await waitFor(() => {
      expect(mockLoop).toHaveBeenCalled();
    });
  });

  /* ── Mode switching ────────────────────────────────── */

  it('mode defaults to chat', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.selectedModel).toBe('llama3'));
    expect(result.current.mode).toBe('chat');
  });

  it('setMode switches between chat, agent, and planning', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.selectedModel).toBe('llama3'));

    act(() => result.current.setMode('agent'));
    expect(result.current.mode).toBe('agent');

    act(() => result.current.setMode('planning'));
    expect(result.current.mode).toBe('planning');

    act(() => result.current.setMode('chat'));
    expect(result.current.mode).toBe('chat');
  });

  /* ── Input management ──────────────────────────────── */

  it('setInput updates the input value', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.selectedModel).toBe('llama3'));

    act(() => result.current.setInput('hello world'));
    expect(result.current.input).toBe('hello world');
  });

  /* ── Error dismissal ───────────────────────────────── */

  it('dismissError clears the error state', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.selectedModel).toBe('llama3'));
    expect(result.current.error).toBeNull();
    // handleDismissErrors should not crash when no error
    act(() => result.current.handleDismissErrors());
    expect(result.current.error).toBeNull();
  });

  /* ── Message persistence ───────────────────────────── */

  it('loads saved messages on mount', async () => {
    const saved: UiMessage[] = [
      { role: 'user', content: 'saved question', id: 'saved1' },
      { role: 'assistant', content: 'saved answer', id: 'saved2' },
    ];
    window.deyad = {
      ...makeDeyadMock(),
      loadMessages: vi.fn().mockResolvedValue(saved),
    } as unknown as DeyadAPI;

    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.messages.length).toBe(2));
    expect(result.current.messages[0].content).toBe('saved question');
  });

  /* ── Empty send rejected ───────────────────────────── */

  it('handleSend with empty input does nothing', async () => {
    const { result } = renderHook(() => useChatSession(defaultProps()));
    await waitFor(() => expect(result.current.selectedModel).toBe('llama3'));

    act(() => result.current.setInput(''));
    act(() => result.current.handleSend());

    // No message should be added
    expect(result.current.messages.length).toBe(0);
  });
});
