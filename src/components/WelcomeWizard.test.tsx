// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WelcomeWizard from './WelcomeWizard';

beforeEach(() => {
  window.deyad = {
    listModels: vi.fn().mockResolvedValue({ models: [{ name: 'llama3', details: { parameter_size: '8B' } }] }),
    setSettings: vi.fn().mockResolvedValue(undefined),
  } as unknown as DeyadAPI;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WelcomeWizard', () => {
  it('renders welcome step initially', () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    expect(screen.getByText('Welcome to Deyad')).toBeTruthy();
  });

  it('has progress dots', () => {
    const { container } = render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    const dots = container.querySelectorAll('.wizard-dot');
    expect(dots.length).toBe(4);
  });

  it('navigates to ollama step', () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    // Should show Ollama connection step
    expect(screen.getByText('Connect to Ollama')).toBeTruthy();
  });

  it('checks Ollama connection on ollama step', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => {
      expect(window.deyad.listModels).toHaveBeenCalled();
    });
  });

  it('completes full wizard flow', async () => {
    const onComplete = vi.fn();
    render(<WelcomeWizard onComplete={onComplete} onCreateApp={() => {}} />);
    // welcome → get started
    fireEvent.click(screen.getByText('Get Started'));
    // ollama step — wait for connection check
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    // model step — wait for model list
    await waitFor(() => expect(screen.getByText('Choose a Model')).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    // ready step
    await waitFor(() => expect(screen.getByText(/All Set/)).toBeTruthy());
    fireEvent.click(screen.getByText('Close'));
    expect(onComplete).toHaveBeenCalled();
  });
});

describe('WelcomeWizard — Skip Setup', () => {
  it('Skip Setup calls onComplete immediately', () => {
    const onComplete = vi.fn();
    render(<WelcomeWizard onComplete={onComplete} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Skip Setup'));
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe('WelcomeWizard — Create First App', () => {
  it('Create First App calls both onComplete and onCreateApp', async () => {
    const onComplete = vi.fn();
    const onCreateApp = vi.fn();
    render(<WelcomeWizard onComplete={onComplete} onCreateApp={onCreateApp} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Choose a Model')).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Create First App')).toBeTruthy());
    fireEvent.click(screen.getByText('Create First App'));
    expect(onComplete).toHaveBeenCalled();
    expect(onCreateApp).toHaveBeenCalled();
  });
});

describe('WelcomeWizard — Ollama failure path', () => {
  it('shows error when Ollama connection fails', async () => {
    window.deyad = {
      listModels: vi.fn().mockRejectedValue(new Error('connection refused')),
      setSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Could not connect to Ollama/)).toBeTruthy(), { timeout: 10000 });
  });

  it('shows Retry Connection button on failure', async () => {
    window.deyad = {
      listModels: vi.fn().mockRejectedValue(new Error('nope')),
      setSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText('Retry Connection')).toBeTruthy(), { timeout: 10000 });
  });

  it('Next is disabled when Ollama not connected', async () => {
    window.deyad = {
      listModels: vi.fn().mockRejectedValue(new Error('nope')),
      setSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText('Retry Connection')).toBeTruthy(), { timeout: 10000 });
    const nextBtn = screen.getByText('Next');
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('WelcomeWizard — Back navigation', () => {
  it('Back from ollama returns to welcome', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText('Connect to Ollama')).toBeTruthy());
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Welcome to Deyad')).toBeTruthy();
  });

  it('Back from model returns to ollama', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Choose a Model')).toBeTruthy());
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Connect to Ollama')).toBeTruthy();
  });
});

describe('WelcomeWizard — model selection', () => {
  it('first model is auto-selected', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('llama3')).toBeTruthy());
    const modelBtn = screen.getByText('llama3').closest('button');
    expect(modelBtn?.classList.contains('selected')).toBe(true);
  });

  it('selecting a model calls setSettings on next', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('llama3')).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => {
      expect(window.deyad.setSettings).toHaveBeenCalledWith({ defaultModel: 'llama3' });
    });
  });

  it('shows parameter_size badge', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('8B')).toBeTruthy());
  });

  it('shows no models hint if list is empty', async () => {
    window.deyad = {
      listModels: vi.fn().mockResolvedValue({ models: [] }),
      setSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText(/No models found/)).toBeTruthy());
  });

  it('Next disabled when no model selected', async () => {
    window.deyad = {
      listModels: vi.fn().mockResolvedValue({ models: [] }),
      setSettings: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText(/No models found/)).toBeTruthy());
    const btns = screen.getAllByText('Next');
    const nextBtn = btns[btns.length - 1];
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('WelcomeWizard — progress dots', () => {
  it('first dot is active on welcome step', () => {
    const { container } = render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    const dots = container.querySelectorAll('.wizard-dot');
    expect(dots[0].classList.contains('active')).toBe(true);
  });

  it('second dot is active on ollama step', () => {
    const { container } = render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    const dots = container.querySelectorAll('.wizard-dot');
    expect(dots[1].classList.contains('active')).toBe(true);
    expect(dots[0].classList.contains('done')).toBe(true);
  });
});

describe('WelcomeWizard — ready step content', () => {
  it('shows tips list on ready step', async () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    fireEvent.click(screen.getByText('Get Started'));
    await waitFor(() => expect(screen.getByText(/Ollama is running/)).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Choose a Model')).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => {
      expect(screen.getByText(/Agent Mode/)).toBeTruthy();
      expect(screen.getByText(/Preview your app/)).toBeTruthy();
    });
  });
});
