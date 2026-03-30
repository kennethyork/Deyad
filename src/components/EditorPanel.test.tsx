// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @monaco-editor/react before importing component
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: any) => (
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
  (window as any).dyad = {
    openAppFolder: vi.fn(),
    chatAutocomplete: vi.fn().mockResolvedValue(''),
  };
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
});
