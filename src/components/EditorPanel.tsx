interface Props {
  files: Record<string, string>;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onOpenFolder: () => void;
}

function getFileIcon(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) return '⚛️';
  if (path.endsWith('.ts') || path.endsWith('.js')) return '📜';
  if (path.endsWith('.css')) return '🎨';
  if (path.endsWith('.json')) return '{}';
  if (path.endsWith('.md')) return '📝';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return '🐳';
  if (path.endsWith('.prisma')) return '🔷';
  if (path.endsWith('.env') || path.includes('.env.')) return '🔒';
  if (path.endsWith('.html')) return '🌐';
  return '📄';
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
              📁 {label}
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

export default function EditorPanel({ files, selectedFile, onSelectFile, onOpenFolder }: Props) {
  const fileCount = Object.keys(files).length;
  const tree = buildTree(files);

  return (
    <div className="editor-panel">
      {/* File tree */}
      <div className="file-tree">
        <div className="file-tree-header">
          <span>FILES ({fileCount})</span>
          <button className="btn-open-folder" onClick={onOpenFolder} title="Open in file explorer">
            📂
          </button>
        </div>
        {fileCount === 0 ? (
          <p className="file-tree-empty">No files yet</p>
        ) : (
          <FileTree
            tree={tree}
            dir=""
            files={files}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            depth={0}
          />
        )}
      </div>

      {/* Code viewer */}
      <div className="code-viewer">
        {selectedFile ? (
          <>
            <div className="code-viewer-header">
              <span>{getFileIcon(selectedFile)} {selectedFile}</span>
            </div>
            <pre className="code-content">
              <code>{files[selectedFile] || ''}</code>
            </pre>
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
