import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as monacoEditor } from 'monaco-editor';

interface Props {
  files: Record<string, string>;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onOpenFolder: () => void;
  onFileEdit: (path: string, content: string) => void;
}

function getLanguage(path: string): string {
  if (path.endsWith('.tsx')) return 'typescript';
  if (path.endsWith('.jsx')) return 'javascript';
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.prisma')) return 'graphql';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.sh')) return 'shell';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.dockerfile') || path.split('/').pop() === 'Dockerfile') return 'dockerfile';
  return 'plaintext';
}

function getFileIcon(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return 'TSX';
  if (path.endsWith('.ts') || path.endsWith('.js')) return 'JS';
  if (path.endsWith('.css')) return 'CSS';
  if (path.endsWith('.json')) return '{}';
  if (path.endsWith('.md')) return 'MD';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'YML';
  if (path.endsWith('.prisma')) return 'PR';
  if (path.endsWith('.env') || path.includes('.env.')) return 'ENV';
  if (path.endsWith('.html')) return 'HTML';
  return '';
}

function buildTree(files: Record<string, string>): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  tree.set('', []); // root

  for (const filePath of Object.keys(files)) {
    const parts = filePath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts.slice(0, i + 1).join('/');
      const parent = parts.slice(0, i).join('/');
      if (!tree.has(dir)) {
        tree.set(dir, []);
        const parentChildren = tree.get(parent) || [];
        if (!parentChildren.includes(dir)) {
          parentChildren.push(dir);
          tree.set(parent, parentChildren);
        }
      }
    }
    const parentDir = parts.slice(0, -1).join('/');
    const parentChildren = tree.get(parentDir) || [];
    if (!parentChildren.includes(filePath)) {
      parentChildren.push(filePath);
      tree.set(parentDir, parentChildren);
    }
  }
  return tree;
}

function FileTree({
  tree,
  dir,
  files,
  selectedFile,
  onSelectFile,
  depth,
}: {
  tree: Map<string, string[]>;
  dir: string;
  files: Record<string, string>;
  selectedFile: string | null;
  onSelectFile: (p: string) => void;
  depth: number;
}) {
  const children = tree.get(dir) || [];
  const dirs = children.filter((c) => tree.has(c) && !files[c]);
  const fileItems = children.filter((c) => files[c] !== undefined);

  return (
    <>
      {dirs.map((d) => {
        const label = d.split('/').pop() || d;
        return (
          <div key={d}>
            <div className="file-tree-dir" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
              {label}
            </div>
            <FileTree
              tree={tree}
              dir={d}
              files={files}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          </div>
        );
      })}
      {fileItems.map((f) => {
        const label = f.split('/').pop() || f;
        return (
          <div
            key={f}
            className={`file-tree-item ${selectedFile === f ? 'active' : ''}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => onSelectFile(f)}
            title={f}
          >
            <span className="file-icon">{getFileIcon(f)}</span>
            <span className="file-name">{label}</span>
          </div>
        );
      })}
    </>
  );
}

export default function EditorPanel({ files, selectedFile, onSelectFile, onOpenFolder, onFileEdit }: Props) {
  const fileCount = Object.keys(files).length;
  const [searchQuery, setSearchQuery] = useState('');

  // Filter files by search query (matches path or content)
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const query = searchQuery.toLowerCase();
    const result: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      if (path.toLowerCase().includes(query) || content.toLowerCase().includes(query)) {
        result[path] = content;
      }
    }
    return result;
  }, [files, searchQuery]);

  const filteredCount = Object.keys(filteredFiles).length;
  const tree = buildTree(filteredFiles);

  // Local edit state
  const [editContent, setEditContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);

  // Reset edit content when selected file or its persisted content changes
  useEffect(() => {
    if (selectedFile !== null && files[selectedFile] !== undefined) {
      setEditContent(files[selectedFile]);
      setIsDirty(false);
    }
  }, [selectedFile, files]);

  const handleSave = useCallback(() => {
    if (selectedFile && editorRef.current) {
      const value = editorRef.current.getValue();
      if (value !== (files[selectedFile] ?? '')) {
        onFileEdit(selectedFile, value);
        setIsDirty(false);
      }
    }
  }, [selectedFile, files, onFileEdit]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    // Add Ctrl+S / Cmd+S save action
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => handleSave(),
    });
  }, [handleSave]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    const v = value ?? '';
    setEditContent(v);
    setIsDirty(v !== (files[selectedFile ?? ''] ?? ''));
  }, [files, selectedFile]);

  return (
    <div className="editor-panel">
      {/* File tree */}
      <div className="file-tree">
        <div className="file-tree-header">
          <span>FILES ({fileCount})</span>
          <button className="btn-open-folder" onClick={onOpenFolder} title="Open in file explorer">
            Open
          </button>
        </div>
        {fileCount > 0 && (
          <div className="file-search">
            <input
              className="file-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files…"
            />
            {searchQuery && (
              <span className="file-search-count">
                {filteredCount}/{fileCount}
              </span>
            )}
          </div>
        )}
        {fileCount === 0 ? (
          <p className="file-tree-empty">No files yet</p>
        ) : filteredCount === 0 ? (
          <p className="file-tree-empty">No matches</p>
        ) : (
          <FileTree
            tree={tree}
            dir=""
            files={filteredFiles}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            depth={0}
          />
        )}
      </div>

      {/* Code editor */}
      <div className="code-viewer">
        {selectedFile ? (
          <>
            <div className="code-viewer-header">
              <span>{getFileIcon(selectedFile)} {selectedFile}</span>
              <button
                className={`btn-save-file${isDirty ? ' dirty' : ''}`}
                onClick={handleSave}
                disabled={!isDirty}
                title="Save file (Ctrl+S)"
              >
                {isDirty ? '● Save' : '✓ Saved'}
              </button>
            </div>
            <Editor
              theme="vs-dark"
              language={getLanguage(selectedFile)}
              value={editContent}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2,
                automaticLayout: true,
                padding: { top: 8 },
              }}
            />
          </>
        ) : (
          <div className="code-viewer-empty">
            <p>Select a file to view its contents</p>
          </div>
        )}
      </div>
    </div>
  );
}
