export function getLanguage(path: string): string {
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

export function getFileIcon(path: string): string {
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

export function buildTree(files: Record<string, string>): Map<string, string[]> {
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

interface FileTreeProps {
  tree: Map<string, string[]>;
  dir: string;
  files: Record<string, string>;
  selectedFile: string | null;
  onSelectFile: (p: string) => void;
  depth: number;
}

export function FileTree({ tree, dir, files, selectedFile, onSelectFile, depth }: FileTreeProps) {
  const children = tree.get(dir) || [];
  const dirs = children.filter((c) => tree.has(c) && !files[c]);
  const fileItems = children.filter((c) => files[c] !== undefined);

  return (
    <>
      {dirs.map((d) => {
        const label = d.split('/').pop() || d;
        return (
          <div key={d} role="treeitem" aria-expanded={true}>
            <div className="file-tree-dir" style={{ paddingLeft: `${depth * 12 + 8}px` }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); } }}>
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
            role="treeitem"
            tabIndex={0}
            aria-selected={selectedFile === f}
            className={`file-tree-item ${selectedFile === f ? 'active' : ''}`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => onSelectFile(f)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectFile(f); } }}
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
