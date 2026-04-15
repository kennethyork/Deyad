// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatHeader, ErrorBanners } from './ChatSubComponents';
import type { AppProject } from '../App';

vi.mock('../lib/errorDetector', () => ({
  getErrorHint: vi.fn(() => null),
}));

const app: AppProject = {
  id: 'app-1', name: 'My App', description: 'A test app',
  createdAt: '', appType: 'frontend',
};

const fsApp: AppProject = { ...app, appType: 'fullstack' };

describe('ChatHeader', () => {
  const defaults = {
    app,
    tokenCount: 0,
    dbStatus: 'none' as const,
    onDbToggle: vi.fn(),
    planningMode: false,
    agentMode: false,
    setMode: vi.fn(),
    canRevert: false,
    onRevert: vi.fn(),
    models: ['model-a'],
    selectedModel: 'model-a',
    setModelState: vi.fn(),
    streaming: false,
  };

  it('renders app name and description', () => {
    render(<ChatHeader {...defaults} />);
    expect(screen.getByText('My App')).toBeTruthy();
    expect(screen.getByText('A test app')).toBeTruthy();
  });

  it('shows token counter when > 0', () => {
    render(<ChatHeader {...defaults} tokenCount={1500} />);
    expect(screen.getByText(/1\.5k tokens/)).toBeTruthy();
  });

  it('hides token counter when 0', () => {
    const { container } = render(<ChatHeader {...defaults} tokenCount={0} />);
    expect(container.querySelector('.token-counter')).toBeNull();
  });

  it('shows db controls for fullstack apps', () => {
    render(<ChatHeader {...defaults} app={fsApp} dbStatus="running" />);
    expect(screen.getByText('DB Running')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('hides db controls for frontend apps', () => {
    const { container } = render(<ChatHeader {...defaults} />);
    expect(container.querySelector('.db-status')).toBeNull();
  });

  it('shows Plan ON when in planning mode', () => {
    render(<ChatHeader {...defaults} planningMode />);
    expect(screen.getByText('Plan ON')).toBeTruthy();
  });

  it('shows Agent ON when in agent mode', () => {
    render(<ChatHeader {...defaults} agentMode />);
    expect(screen.getByText('Agent ON')).toBeTruthy();
  });

  it('shows undo button when canRevert', () => {
    render(<ChatHeader {...defaults} canRevert />);
    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('renders model selector', () => {
    const { container } = render(<ChatHeader {...defaults} models={['m1', 'm2']} selectedModel="m1" />);
    expect(container.querySelector('.model-select')).toBeTruthy();
  });

  it('shows no models text when empty', () => {
    render(<ChatHeader {...defaults} models={[]} />);
    expect(screen.getByText('No models')).toBeTruthy();
  });
});

describe('ErrorBanners', () => {
  const defaults = {
    error: null as string | null,
    detectedErrors: [] as { type: 'runtime'; message: string; source: string; raw: string }[],
    streaming: false,
    agentMode: false,
    autoFixAttemptsRef: { current: 0 },
    MAX_AUTO_FIX_ATTEMPTS: 3,
    onRetry: vi.fn(),
    onAutoFix: vi.fn(),
    onDismissErrors: vi.fn(),
  };

  it('renders nothing when no errors', () => {
    const { container } = render(<ErrorBanners {...defaults} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders error banner with retry', () => {
    render(<ErrorBanners {...defaults} error="Something broke" />);
    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('renders detected errors with auto-fix button', () => {
    const errors = [{ type: 'runtime' as const, message: 'TypeError: x is not a function', source: 'console', raw: 'TypeError: x is not a function' }];
    render(<ErrorBanners {...defaults} detectedErrors={errors} />);
    expect(screen.getByText(/1 error detected/)).toBeTruthy();
    expect(screen.getByText('🔧 Auto-fix')).toBeTruthy();
  });

  it('hides detected errors while streaming', () => {
    const errors = [{ type: 'runtime' as const, message: 'err', source: 'console', raw: 'err' }];
    const { container } = render(<ErrorBanners {...defaults} detectedErrors={errors} streaming />);
    expect(container.querySelector('.error-detection-banner')).toBeNull();
  });

  it('shows auto-fixing status in agent mode', () => {
    const errors = [{ type: 'runtime' as const, message: 'err', source: 'console', raw: 'err' }];
    render(<ErrorBanners {...defaults} detectedErrors={errors} agentMode autoFixAttemptsRef={{ current: 1 }} />);
    expect(screen.getByText(/Auto-fixing/)).toBeTruthy();
  });
});
