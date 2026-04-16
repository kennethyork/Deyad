// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import DiffModal from './DiffModal';

afterEach(cleanup);

const oldFiles: Record<string, string> = {
  'src/App.tsx': 'const x = 1;\nconsole.log(x);\n',
};

const newFiles: Record<string, string> = {
  'src/App.tsx': 'const x = 2;\nconsole.log(x);\nconsole.log("added");\n',
  'src/utils.ts': 'export function hello() { return "hi"; }\n',
};

describe('DiffModal', () => {
  it('renders diff modal with file names', () => {
    render(<DiffModal oldFiles={oldFiles} newFiles={newFiles} onApply={() => {}} onReject={() => {}} />);
    expect(screen.getByText(/src\/App\.tsx/)).toBeTruthy();
    expect(screen.getByText(/src\/utils\.ts/)).toBeTruthy();
  });

  it('shows Review Changes heading', () => {
    render(<DiffModal oldFiles={oldFiles} newFiles={newFiles} onApply={() => {}} onReject={() => {}} />);
    expect(screen.getByText('Review Changes')).toBeTruthy();
  });

  it('calls onApply when Apply button is clicked', () => {
    const onApply = vi.fn();
    render(<DiffModal oldFiles={oldFiles} newFiles={newFiles} onApply={onApply} onReject={() => {}} />);
    fireEvent.click(screen.getByText(/Apply/));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('calls onReject when Reject button is clicked', () => {
    const onReject = vi.fn();
    render(<DiffModal oldFiles={oldFiles} newFiles={newFiles} onApply={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByText(/Reject/));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('handles all-new files (no old content)', () => {
    render(
      <DiffModal oldFiles={{}} newFiles={{ 'new.ts': 'hello' }} onApply={() => {}} onReject={() => {}} />,
    );
    expect(screen.getByText(/new\.ts/)).toBeTruthy();
  });

  it('handles empty diff', () => {
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{}} onApply={() => {}} onReject={() => {}} />,
    );
    expect(container.innerHTML).toBeTruthy();
  });
});

describe('DiffModal — stats display', () => {
  it('displays correct +N/-N total counts', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{ 'a.ts': 'line1\nline2' }}
        newFiles={{ 'a.ts': 'line1\nline3\nline4' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const added = container.querySelector('.diff-stat-added');
    const removed = container.querySelector('.diff-stat-removed');
    expect(added?.textContent).toMatch(/\+\d/);
    expect(removed?.textContent).toMatch(/-\d/);
  });

  it('displays correct file count', () => {
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x', 'b.ts': 'y' }} onApply={() => {}} onReject={() => {}} />,
    );
    const filesStat = container.querySelector('.diff-stat-files');
    expect(filesStat?.textContent).toBe('2 files');
  });

  it('singular file text for single file', () => {
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x' }} onApply={() => {}} onReject={() => {}} />,
    );
    const filesStat = container.querySelector('.diff-stat-files');
    expect(filesStat?.textContent).toBe('1 file');
  });
});

describe('DiffModal — expand / collapse', () => {
  it('first file is expanded by default', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'first.ts': 'line1', 'second.ts': 'line2' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const diffFiles = container.querySelectorAll('.diff-file');
    const firstLines = diffFiles[0]?.querySelector('.diff-lines');
    expect(firstLines).toBeTruthy();
    const secondLines = diffFiles[1]?.querySelector('.diff-lines');
    expect(secondLines).toBeFalsy();
  });

  it('clicking a collapsed file header expands it', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'a.ts': 'x', 'b.ts': 'y' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const headers = container.querySelectorAll('.diff-file-header');
    fireEvent.click(headers[1]); // expand second
    const lines = container.querySelectorAll('.diff-file')[1]?.querySelector('.diff-lines');
    expect(lines).toBeTruthy();
  });

  it('clicking an expanded file header collapses it', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'a.ts': 'x' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const header = container.querySelector('.diff-file-header')!;
    // First file should be expanded
    expect(container.querySelector('.diff-lines')).toBeTruthy();
    fireEvent.click(header); // collapse
    expect(container.querySelector('.diff-lines')).toBeFalsy();
  });
});

describe('DiffModal — line types', () => {
  it('new file lines have added class', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'new.ts': 'const a = 1;' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const addedLines = container.querySelectorAll('.diff-line-added');
    expect(addedLines.length).toBeGreaterThan(0);
  });

  it('unchanged lines get unchanged class', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{ 'a.ts': 'same\nchanged' }}
        newFiles={{ 'a.ts': 'same\nnew' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const unchanged = container.querySelectorAll('.diff-line-unchanged');
    expect(unchanged.length).toBeGreaterThan(0);
  });

  it('removed lines get removed class', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{ 'a.ts': 'old line\nkept' }}
        newFiles={{ 'a.ts': 'kept' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const removed = container.querySelectorAll('.diff-line-removed');
    expect(removed.length).toBeGreaterThan(0);
  });

  it('line signs are + for added and - for removed', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{ 'a.ts': 'old' }}
        newFiles={{ 'a.ts': 'new' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const signs = container.querySelectorAll('.diff-line-sign');
    const texts = Array.from(signs).map(s => s.textContent?.trim());
    expect(texts).toContain('+');
    expect(texts).toContain('-');
  });
});

describe('DiffModal — isNew badge', () => {
  it('prefixes new file name with +', () => {
    render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'brand-new.ts': 'x' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText(/\+\s*brand-new\.ts/)).toBeTruthy();
  });

  it('does not prefix existing file name with +', () => {
    render(
      <DiffModal
        oldFiles={{ 'existing.ts': 'x' }}
        newFiles={{ 'existing.ts': 'y' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const fileNames = screen.getAllByText(/existing\.ts/);
    const hasPlusPrefix = fileNames.some(el => el.textContent?.startsWith('+ '));
    expect(hasPlusPrefix).toBe(false);
  });
});

describe('DiffModal — overlay click', () => {
  it('calls onReject when overlay is clicked', () => {
    const onReject = vi.fn();
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x' }} onApply={() => {}} onReject={onReject} />,
    );
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('does not call onReject when modal body is clicked', () => {
    const onReject = vi.fn();
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x' }} onApply={() => {}} onReject={onReject} />,
    );
    const modal = container.querySelector('.modal')!;
    fireEvent.click(modal);
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('DiffModal — Apply button text', () => {
  it('says "Apply 1 file" for single file', () => {
    render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x' }} onApply={() => {}} onReject={() => {}} />,
    );
    expect(screen.getByText('Apply 1 file')).toBeTruthy();
  });

  it('says "Apply 3 files" for three files', () => {
    render(
      <DiffModal
        oldFiles={{}}
        newFiles={{ 'a.ts': 'x', 'b.ts': 'y', 'c.ts': 'z' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText('Apply 3 files')).toBeTruthy();
  });
});

describe('DiffModal — identical files', () => {
  it('shows +0 / -0 for unchanged content', () => {
    const same = 'const x = 1;\n';
    const { container } = render(
      <DiffModal oldFiles={{ 'a.ts': same }} newFiles={{ 'a.ts': same }} onApply={() => {}} onReject={() => {}} />,
    );
    const stats = container.querySelectorAll('.diff-file-stats');
    const text = stats[0]?.textContent ?? '';
    expect(text).toContain('+0');
    expect(text).toContain('-0');
  });
});

describe('DiffModal — multiple files per-file stats', () => {
  it('each file has its own stat badges', () => {
    const { container } = render(
      <DiffModal
        oldFiles={{ 'a.ts': 'old' }}
        newFiles={{ 'a.ts': 'new', 'b.ts': 'brand new' }}
        onApply={() => {}}
        onReject={() => {}}
      />,
    );
    const stats = container.querySelectorAll('.diff-file-stats');
    expect(stats.length).toBe(2);
  });
});

describe('DiffModal — close button', () => {
  it('× button calls onReject', () => {
    const onReject = vi.fn();
    const { container } = render(
      <DiffModal oldFiles={{}} newFiles={{ 'a.ts': 'x' }} onApply={() => {}} onReject={onReject} />,
    );
    const closeBtn = container.querySelector('.modal-close')!;
    fireEvent.click(closeBtn);
    expect(onReject).toHaveBeenCalledOnce();
  });
});
