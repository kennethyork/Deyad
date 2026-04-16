// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NewAppModal from './NewAppModal';

afterEach(cleanup);

describe('NewAppModal', () => {
  beforeEach(() => {
    window.deyad = {
      checkDocker: vi.fn().mockResolvedValue(true),
      listPlugins: vi.fn().mockResolvedValue([
        {
          name: 'PluginOne',
          templates: [
            {
              name: 'Plugin Template',
              description: 'From plugin',
              icon: '🔌',
              appType: 'frontend',
              prompt: 'plugin-prompt'
            }
          ]
        }
      ]),
    } as unknown as DeyadAPI;
  });

  it('shows plugin templates and uses prompt', async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewAppModal onClose={onClose} onCreate={onCreate} />);

    // plugin template should appear (wait for async load)
    const pluginCard = await screen.findByText('Plugin Template');
    expect(pluginCard).toBeTruthy();

    // select it
    fireEvent.click(pluginCard);

    // check that name/description fields updated to plugin values
    expect((screen.getByLabelText('App name') as HTMLInputElement).value).toBe('Plugin Template');
    expect((screen.getByLabelText('Description (optional)') as HTMLInputElement).value).toBe('plugin-prompt');

    // submit via button
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'MyApp' } });
    fireEvent.click(screen.getByText('Create App'));

    expect(onCreate).toHaveBeenCalledWith('MyApp', 'plugin-prompt', 'frontend', 'plugin-prompt');
  });
});

describe('NewAppModal — form validation', () => {
  beforeEach(() => {
    window.deyad = {
      listPlugins: vi.fn().mockResolvedValue([]),
    } as unknown as DeyadAPI;
  });

  it('Create App button is disabled when name is empty', () => {
    render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const btn = screen.getByText('Create App');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Create App button is enabled when name has text', () => {
    render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Test' } });
    const btn = screen.getByText('Create App');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not call onCreate when name is only whitespace', () => {
    const onCreate = vi.fn();
    render(<NewAppModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Create App'));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('trims name and description on submit', () => {
    const onCreate = vi.fn();
    render(<NewAppModal onClose={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: '  My App  ' } });
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: '  desc  ' } });
    fireEvent.click(screen.getByText('Create App'));
    expect(onCreate).toHaveBeenCalledWith('My App', 'desc', 'frontend', undefined);
  });
});

describe('NewAppModal — close / cancel', () => {
  beforeEach(() => {
    window.deyad = {
      listPlugins: vi.fn().mockResolvedValue([]),
    } as unknown as DeyadAPI;
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(<NewAppModal onClose={onClose} onCreate={() => {}} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('× button calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<NewAppModal onClose={onClose} onCreate={() => {}} />);
    const closeBtn = container.querySelector('.modal-close')!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('overlay click calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<NewAppModal onClose={onClose} onCreate={() => {}} />);
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('modal body click does not call onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<NewAppModal onClose={onClose} onCreate={() => {}} />);
    const modal = container.querySelector('.modal')!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('NewAppModal — app type toggle', () => {
  beforeEach(() => {
    window.deyad = {
      listPlugins: vi.fn().mockResolvedValue([]),
    } as unknown as DeyadAPI;
  });

  it('starts with frontend type selected', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const frontendCard = container.querySelectorAll('.type-card')[0];
    expect(frontendCard?.classList.contains('selected')).toBe(true);
  });

  it('shows fullstack info when Full Stack is selected', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    // initially no stack-info
    expect(container.querySelector('.stack-info')).toBeFalsy();
    // click Full Stack type card
    const typeCards = container.querySelectorAll('.type-card');
    fireEvent.click(typeCards[1]); // second card is Full Stack
    expect(container.querySelector('.stack-info')).toBeTruthy();
  });

  it('hides fullstack info when Frontend Only is re-selected', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const typeCards = container.querySelectorAll('.type-card');
    fireEvent.click(typeCards[1]); // Full Stack
    expect(container.querySelector('.stack-info')).toBeTruthy();
    fireEvent.click(typeCards[0]); // Frontend Only
    expect(container.querySelector('.stack-info')).toBeFalsy();
  });

  it('fullstack info mentions backend, frontend, README', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const typeCards = container.querySelectorAll('.type-card');
    fireEvent.click(typeCards[1]); // Full Stack
    const stackInfo = container.querySelector('.stack-info')!;
    expect(stackInfo.textContent).toContain('backend/');
    expect(stackInfo.textContent).toContain('frontend/');
    expect(stackInfo.textContent).toContain('README.md');
  });

  it('submits with correct appType when fullstack selected', () => {
    const onCreate = vi.fn();
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={onCreate} />);
    const typeCards = container.querySelectorAll('.type-card');
    fireEvent.click(typeCards[1]); // Full Stack
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'FS' } });
    fireEvent.click(screen.getByText('Create App'));
    expect(onCreate).toHaveBeenCalledWith('FS', '', 'fullstack', undefined);
  });
});

describe('NewAppModal — template selection', () => {
  beforeEach(() => {
    window.deyad = {
      listPlugins: vi.fn().mockResolvedValue([]),
    } as unknown as DeyadAPI;
  });

  it('renders all 27 built-in templates', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBe(27);
  });

  it('Blank App template sets name to empty', () => {
    render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.click(screen.getByText('Blank App'));
    expect((screen.getByLabelText('App name') as HTMLInputElement).value).toBe('');
  });

  it('selecting a named template sets the name', () => {
    render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.click(screen.getByText('Todo List'));
    expect((screen.getByLabelText('App name') as HTMLInputElement).value).toBe('Todo List');
  });

  it('fullstack templates show Full Stack badge', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    const badges = container.querySelectorAll('.template-badge');
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toBe('Full Stack');
  });

  it('selecting a fullstack template switches app type', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.click(screen.getByText('Blog'));
    const fullstackCard = container.querySelectorAll('.type-card')[1];
    expect(fullstackCard?.classList.contains('selected')).toBe(true);
  });

  it('template gets selected class', () => {
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    fireEvent.click(screen.getByText('Dashboard'));
    const selectedCards = container.querySelectorAll('.template-card.selected');
    expect(selectedCards.length).toBe(1);
  });
});

describe('NewAppModal — plugin failure', () => {
  it('renders built-in templates when listPlugins rejects', async () => {
    window.deyad = {
      listPlugins: vi.fn().mockRejectedValue(new Error('fail')),
    } as unknown as DeyadAPI;
    const { container } = render(<NewAppModal onClose={() => {}} onCreate={() => {}} />);
    // wait for async
    await new Promise(r => setTimeout(r, 10));
    const cards = container.querySelectorAll('.template-card');
    expect(cards.length).toBe(27);
  });
});
