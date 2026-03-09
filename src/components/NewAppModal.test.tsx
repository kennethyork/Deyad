// @vitest-environment happy-dom
// @ts-nocheck
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NewAppModal from './NewAppModal';

describe('NewAppModal', () => {
  beforeEach(() => {
    (window as any).deyad = {
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
    };
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

    expect(onCreate).toHaveBeenCalledWith('MyApp', 'plugin-prompt', 'frontend', undefined, 'plugin-prompt');
  });
});
