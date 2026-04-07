// @vitest-environment happy-dom
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SearchPanel from './SearchPanel';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.deyad = {
    searchFiles: vi.fn().mockResolvedValue([]),
  } as unknown as DeyadAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SearchPanel', () => {
  it('renders with search input', () => {
    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toContain('Search across all files');
  });

  it('debounces search input by 300ms', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    Object.assign(window.deyad, { searchFiles: searchFn });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
    });
    expect(searchFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(searchFn).toHaveBeenCalledWith('app1', 'test');
    });
  });

  it('searches immediately on Enter', async () => {
    const searchFn = vi.fn().mockResolvedValue([{ file: 'a.ts', line: 1, text: 'hello' }]);
    Object.assign(window.deyad, { searchFiles: searchFn });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'hello' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(searchFn).toHaveBeenCalledWith('app1', 'hello');
    });
  });

  it('displays results grouped by file', async () => {
    const searchFn = vi.fn().mockResolvedValue([
      { file: 'src/a.ts', line: 5, text: 'const x = 1' },
      { file: 'src/a.ts', line: 10, text: 'const y = 2' },
      { file: 'src/b.ts', line: 1, text: 'import z' },
    ]);
    Object.assign(window.deyad, { searchFiles: searchFn });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      const text = container.textContent || '';
      expect(text).toContain('src/a.ts');
      expect(text).toContain('src/b.ts');
      expect(text).toContain('3 result');
    });
  });

  it('shows "No results found" when search returns empty', async () => {
    const searchFn = vi.fn().mockResolvedValue([]);
    Object.assign(window.deyad, { searchFiles: searchFn });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'nonexistent' } });
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('No results found');
    });
  });

  it('shows result count with limit warning at 200', async () => {
    const results = Array.from({ length: 200 }, (_, i) => ({
      file: `file${i}.ts`,
      line: 1,
      text: `match ${i}`,
    }));
    Object.assign(window.deyad, { searchFiles: vi.fn().mockResolvedValue(results) });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'match' } });
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('200 results');
      expect(container.textContent).toContain('limit reached');
    });
  });

  it('calls onSelectFile when clicking a result', async () => {
    const onSelectFile = vi.fn();
    Object.assign(window.deyad, { searchFiles: vi.fn().mockResolvedValue([
      { file: 'src/index.ts', line: 3, text: 'found it' },
    ]) });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={onSelectFile} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'found' } });
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('src/index.ts');
    });

    const resultLine = container.querySelector('.search-result-line') as HTMLElement;
    fireEvent.click(resultLine);
    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('clears results when query is emptied', async () => {
    Object.assign(window.deyad, { searchFiles: vi.fn().mockResolvedValue([
      { file: 'a.ts', line: 1, text: 'match' },
    ]) });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'match' } });
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(container.textContent).toContain('a.ts');
    });

    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      vi.advanceTimersByTime(300);
    });

    // Results should be cleared, no "No results found" since we haven't searched
    expect(container.textContent).not.toContain('a.ts');
    expect(container.textContent).not.toContain('No results found');
  });

  it('handles search errors gracefully', async () => {
    Object.assign(window.deyad, { searchFiles: vi.fn().mockRejectedValue(new Error('Network error')) });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      vi.advanceTimersByTime(300);
    });

    // Should not crash, results should be empty
    await waitFor(() => {
      expect(container.querySelector('.search-input')).toBeTruthy();
    });
  });

  it('shows "Searching..." indicator while loading', async () => {
    let resolveSearch: (v: Array<{ file: string; line: number; text: string }>) => void;
    Object.assign(window.deyad, { searchFiles: vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveSearch = resolve; }),
    ) });

    const { container } = render(<SearchPanel appId="app1" onSelectFile={vi.fn()} />);
    const input = container.querySelector('.search-input') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      vi.advanceTimersByTime(300);
    });

    // Should show searching indicator while promise is pending
    await waitFor(() => {
      expect(container.textContent).toContain('Searching');
    });

    await act(async () => {
      resolveSearch!([]);
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain('Searching');
    });
  });
});
