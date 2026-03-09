// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChatPanel from './ChatPanel';

const dummyApp = { id:'a',name:'Test',description:'',createdAt:new Date().toISOString(),appType:'frontend' as const };

beforeEach(()=>{
  (window as any).deyad={
    getSettings: vi.fn().mockResolvedValue({ollamaHost:'',defaultModel:''}),
    listModels: vi.fn().mockResolvedValue({models:[{name:'m1',modified_at:'',size:0}]}),
    chatStream: vi.fn().mockResolvedValue(undefined),
    onStreamToken: vi.fn().mockReturnValue(()=>{}),
    onStreamDone: vi.fn().mockReturnValue(()=>{}),
    onStreamError: vi.fn().mockReturnValue(()=>{}),
    loadMessages: vi.fn().mockResolvedValue([]),
    saveMessages: vi.fn().mockResolvedValue(true),
  };
});

describe('ChatPanel',()=>{
  it('renders and sends message',async()=>{
    const {getByPlaceholderText,container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    // Wait for models to load so selectedModel is set
    await waitFor(()=>{
      const select = container.querySelector('.model-select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.value).toBe('m1');
    });
    const input = getByPlaceholderText(/describe what you want/i);
    fireEvent.change(input,{target:{value:'hi'}});
    const btn = container.querySelector('.btn-send') as HTMLElement;
    fireEvent.click(btn);
    await waitFor(()=>{
      const msg = container.querySelector('.message-user');
      expect(msg?.textContent).toContain('hi');
    });
  });
});
