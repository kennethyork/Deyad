// @vitest-environment happy-dom
// @ts-nocheck
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChatPanel from './ChatPanel';

// minimal app stub
const dummyApp = {
  id: 'app1',
  name: 'Test',
  description: '',
  createdAt: new Date().toISOString(),
  appType: 'frontend',
};

describe('ChatPanel', () => {
  beforeEach(() => {
    // reset globals
    (window as any).deyad = {
      getSettings: vi.fn().mockResolvedValue({ ollamaHost: '', defaultModel: '' }),
      listModels: vi.fn().mockResolvedValue({ models: [{ name: 'm1', modified_at: '', size: 0 }] }),
      chatStream: vi.fn().mockResolvedValue(undefined),
      saveMessages: vi.fn(),
      loadMessages: vi.fn().mockResolvedValue([]),
      onStreamToken: vi.fn().mockReturnValue(() => {}),
      onStreamDone: vi.fn().mockReturnValue(() => {}),
      onStreamError: vi.fn().mockReturnValue(() => {}),
      checkDocker: vi.fn().mockResolvedValue(true),
      onDeployLog: vi.fn().mockReturnValue(() => {}),
    };
  });

  it('auto-sends initialPrompt when provided', async () => {
    const onConsumed = vi.fn();
    render(
      <ChatPanel
        app={dummyApp}
        appFiles={{}}
        dbStatus="none"
        onFilesUpdated={vi.fn()}
        onDbToggle={vi.fn()}
        onRevert={vi.fn()}
        canRevert={false}
        initialPrompt="hello world"
        onInitialPromptConsumed={onConsumed}
      />
    );

    // chatStream should eventually be called with the prompt
    await waitFor(() => {
      expect(window.deyad.chatStream).toHaveBeenCalled();
    });

    // verify the consumed callback was invoked
    expect(onConsumed).toHaveBeenCalled();
  });
});
