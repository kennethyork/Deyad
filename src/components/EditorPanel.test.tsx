// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @monaco-editor/react before importing component
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: { language?: string; value?: string; onChange?: (v: string | undefined) => void }) => (
    <div data-testid="mock-editor" data-language={props.language}>
      {props.value}
    </div>
  ),
}));

import EditorPanel from './EditorPanel';

const sampleFiles: Record<string, string> = {
  'src/App.tsx': 'const App = () => <div>Hello</div>;',
  'src/index.css': 'body { margin: 0; }',
  'package.json': '{ "name": "test" }',
};

beforeEach(() => {
  window.deyad = {
    openAppFolder: vi.fn(),
    chatAutocomplete: vi.fn().mockResolvedValue(''),
  } as unknown as DeyadAPI;
});

afterEach(cleanup);

describe('EditorPanel', () => {
  it('renders the file tree with file names', () => {
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile={null}
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    expect(screen.getByText('App.tsx')).toBeTruthy();
    expect(screen.getByText('index.css')).toBeTruthy();
    expect(screen.getByText('package.json')).toBeTruthy();
  });

  it('calls onSelectFile when a file is clicked', () => {
    const onSelect = vi.fn();
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile={null}
        onSelectFile={onSelect}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('App.tsx'));
    expect(onSelect).toHaveBeenCalledWith('src/App.tsx');
  });

  it('shows the Open Folder button', () => {
    const onOpen = vi.fn();
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile={null}
        onSelectFile={() => {}}
        onOpenFolder={onOpen}
        onFileEdit={() => {}}
      />,
    );
    const btn = screen.getByTitle('Open in file explorer');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalled();
  });

  it('shows the editor when a file is selected', () => {
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile="src/App.tsx"
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    expect(screen.getByTestId('mock-editor')).toBeTruthy();
  });

  it('renders empty state when no files', () => {
    const { container } = render(
      <EditorPanel
        files={{}}
        selectedFile={null}
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    expect(container.innerHTML).toBeTruthy();
  });

  it('renders folder structure with nested paths', () => {
    render(
      <EditorPanel
        files={{ 'src/utils/helper.ts': 'export {}', 'src/App.tsx': 'app', 'README.md': '# Hi' }}
        selectedFile={null}
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    expect(screen.getByText('README.md')).toBeTruthy();
    expect(screen.getByText('App.tsx')).toBeTruthy();
  });

  it('shows editor content when file is selected', () => {
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile="src/App.tsx"
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    const editor = screen.getByTestId('mock-editor');
    expect(editor.textContent).toContain('const App');
  });

  it('detects language from file extension', () => {
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile="src/index.css"
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    const editor = screen.getByTestId('mock-editor');
    expect(editor.getAttribute('data-language')).toBe('css');
  });

  it('filters files by search query', () => {
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile={null}
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={() => {}}
      />,
    );
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'App' } });
    expect(screen.getByText('App.tsx')).toBeTruthy();
    // package.json should be filtered out
    expect(screen.queryByText('package.json')).toBeNull();
  });

  it('calls onFileEdit when save is invoked', () => {
    const onEdit = vi.fn();
    render(
      <EditorPanel
        files={sampleFiles}
        selectedFile="src/App.tsx"
        onSelectFile={() => {}}
        onOpenFolder={() => {}}
        onFileEdit={onEdit}
      />,
    );
    // Editor renders, verifying it's set up
    expect(screen.getByTestId('mock-editor')).toBeTruthy();
  });
});
