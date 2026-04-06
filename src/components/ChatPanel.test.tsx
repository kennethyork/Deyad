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
    onAppDevLog: vi.fn().mockReturnValue(()=>{}),
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

  it('shows welcome screen when no messages',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      const welcome = container.querySelector('.chat-welcome');
      expect(welcome).toBeTruthy();
      expect(welcome!.textContent).toContain('Start building with AI');
    });
  });

  it('shows Plan and Agent toggle buttons',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      expect(container.querySelector('.btn-plan-mode')).toBeTruthy();
      expect(container.querySelector('.btn-agent-mode')).toBeTruthy();
    });
  });

  it('toggles Plan mode on click',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=> expect(container.querySelector('.btn-plan-mode')).toBeTruthy());
    const planBtn = container.querySelector('.btn-plan-mode')!;
    expect(planBtn.textContent).toBe('Plan');
    fireEvent.click(planBtn);
    expect(planBtn.textContent).toBe('Plan ON');
    expect(planBtn.classList.contains('active')).toBe(true);
    // Toggle back
    fireEvent.click(planBtn);
    expect(planBtn.textContent).toBe('Plan');
  });

  it('toggles Agent mode on click',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=> expect(container.querySelector('.btn-agent-mode')).toBeTruthy());
    const agentBtn = container.querySelector('.btn-agent-mode')!;
    expect(agentBtn.textContent).toBe('Agent');
    fireEvent.click(agentBtn);
    expect(agentBtn.textContent).toBe('Agent ON');
    expect(agentBtn.classList.contains('active')).toBe(true);
  });

  it('shows error banner with retry button',async()=>{
    (window as any).deyad.listModels = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    // loadModels retries 3 times with 1500ms delays — wait long enough
    await waitFor(()=>{
      const banner = container.querySelector('.error-banner');
      expect(banner).toBeTruthy();
    }, { timeout: 10000 });
    // Retry button should be present
    const retryBtn = container.querySelector('.btn-retry');
    expect(retryBtn).toBeTruthy();
    expect(retryBtn!.textContent).toContain('Retry');
  }, 15000);

  it('shows model selector with loaded models',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      const select = container.querySelector('.model-select') as HTMLSelectElement;
      expect(select).toBeTruthy();
      const options = select.querySelectorAll('option');
      expect(options.length).toBe(1);
      expect(options[0].value).toBe('m1');
    });
  });

  it('displays app name in header',async()=>{
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      const name = container.querySelector('.chat-app-name');
      expect(name).toBeTruthy();
      expect(name!.textContent).toBe('Test');
    });
  });

  it('shows "No models" when list is empty',async()=>{
    (window as any).deyad.listModels = vi.fn().mockResolvedValue({models:[]});
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      const noModels = container.querySelector('.no-models');
      expect(noModels).toBeTruthy();
      expect(noModels!.textContent).toBe('No models');
    });
  });

  it('shows Undo button when canRevert is true',async()=>{
    const onRevert = vi.fn();
    const {container} = render(<ChatPanel app={dummyApp} appFiles={{}} dbStatus="none" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={onRevert} canRevert={true} />);
    await waitFor(()=>{
      const undoButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Undo');
      expect(undoButton).toBeTruthy();
    });
  });

  it('shows fullstack badges for fullstack app type',async()=>{
    const fsApp = { ...dummyApp, appType:'fullstack' as const };
    const {container} = render(<ChatPanel app={fsApp} appFiles={{}} dbStatus="stopped" onFilesUpdated={vi.fn()} onDbToggle={vi.fn()} onRevert={vi.fn()} canRevert={false} />);
    await waitFor(()=>{
      const badges = container.querySelectorAll('.stack-badge');
      const texts = Array.from(badges).map(b => b.textContent);
      expect(texts).toContain('Express');
      expect(texts).toContain('Prisma');
    });
  });
});
