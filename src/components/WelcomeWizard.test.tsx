// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WelcomeWizard from './WelcomeWizard';

beforeEach(() => {
  (window as any).dyad = {
    listModels: vi.fn().mockResolvedValue({ models: [{ name: 'llama3', details: { parameter_size: '8B' } }] }),
    setSettings: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WelcomeWizard', () => {
  it('renders welcome step initially', () => {
    render(<WelcomeWizard onComplete={() => {}} onCreateApp={() => {}} />);
    expect(screen.getByText('Welcome to Dyad')).toBeTruthy();
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
      expect(window.dyad.listModels).toHaveBeenCalled();
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
