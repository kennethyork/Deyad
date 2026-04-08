import { useState, useMemo } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface FileDiff {
  path: string;
  isNew: boolean;
  lines: DiffLine[];
}

interface Props {
  oldFiles: Record<string, string>;
  newFiles: Record<string, string>;
  onApply: () => void;
  onReject: () => void;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // For very large files, do a simplified line-by-line comparison
  if (m + n > 2000) {
    let oi = 0, ni = 0;
    while (oi < m || ni < n) {
      if (oi < m && ni < n && oldLines[oi] === newLines[ni]) {
        result.push({ type: 'unchanged', content: oldLines[oi], oldNum: oi + 1, newNum: ni + 1 });
        oi++; ni++;
      } else if (ni < n) {
        result.push({ type: 'added', content: newLines[ni], newNum: ni + 1 });
        ni++;
        // Try to consume matching removed line
        if (oi < m && oldLines[oi] !== newLines[ni - 1]) {
          result.splice(-1, 0, { type: 'removed', content: oldLines[oi], oldNum: oi + 1 });
          oi++;
        }
      } else {
        result.push({ type: 'removed', content: oldLines[oi], oldNum: oi + 1 });
        oi++;
      }
    }
    return result;
  }

  // Standard LCS for reasonable-sized files
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const tempResult: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      tempResult.push({ type: 'unchanged', content: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tempResult.push({ type: 'added', content: newLines[j - 1], newNum: j });
      j--;
    } else {
      tempResult.push({ type: 'removed', content: oldLines[i - 1], oldNum: i });
      i--;
    }
  }

  return tempResult.reverse();
}

export default function DiffModal({ oldFiles, newFiles, onApply, onReject }: Props) {
  const trapRef = useFocusTrap();
  const diffs = useMemo<FileDiff[]>(() => {
    return Object.entries(newFiles).map(([path, newContent]) => {
      const oldContent = oldFiles[path] || '';
      return {
        path,
        isNew: !oldFiles[path],
        lines: computeDiff(oldContent, newContent),
      };
    });
  }, [oldFiles, newFiles]);

  const [expandedFile, setExpandedFile] = useState<string | null>(diffs[0]?.path || null);

  const totalAdded = diffs.reduce((sum, d) => sum + d.lines.filter((l) => l.type === 'added').length, 0);
  const totalRemoved = diffs.reduce((sum, d) => sum + d.lines.filter((l) => l.type === 'removed').length, 0);

  return (
    <div className="modal-overlay" onClick={onReject}>
      <div ref={trapRef} className="modal diff-modal" role="dialog" aria-modal="true" aria-label="Review Changes" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Review Changes</h2>
          <div className="diff-stats">
            <span className="diff-stat-added">+{totalAdded}</span>
            <span className="diff-stat-removed">-{totalRemoved}</span>
            <span className="diff-stat-files">{diffs.length} file{diffs.length !== 1 ? 's' : ''}</span>
          </div>
          <button className="modal-close" onClick={onReject}>×</button>
        </div>

        <div className="modal-body diff-body">
          {diffs.map((diff) => {
            const added = diff.lines.filter((l) => l.type === 'added').length;
            const removed = diff.lines.filter((l) => l.type === 'removed').length;
            const isExpanded = expandedFile === diff.path;

            return (
              <div key={diff.path} className="diff-file">
                <div
                  className="diff-file-header"
                  onClick={() => setExpandedFile(isExpanded ? null : diff.path)}
                >
                  <span className="diff-file-name">
                    {diff.isNew ? '+ ' : ''}{diff.path}
                  </span>
                  <span className="diff-file-stats">
                    <span className="diff-stat-added">+{added}</span>
                    <span className="diff-stat-removed">-{removed}</span>
                  </span>
                  <span className="diff-expand">{isExpanded ? '▼' : '▶'}</span>
                </div>

                {isExpanded && (
                  <div className="diff-lines">
                    {diff.lines.map((line, i) => (
                      <div key={i} className={`diff-line diff-line-${line.type}`}>
                        <span className="diff-line-num">{line.oldNum ?? ' '}</span>
                        <span className="diff-line-num">{line.newNum ?? ' '}</span>
                        <span className="diff-line-sign">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        </span>
                        <span className="diff-line-content">{line.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onReject}>
            Reject Changes
          </button>
          <button className="btn-primary" onClick={onApply}>
            Apply {diffs.length} file{diffs.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
