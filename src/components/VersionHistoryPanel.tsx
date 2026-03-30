import { useState, useEffect, useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

interface DiffEntry {
  status: string;
  path: string;
}

interface Props {
  appId: string;
  onClose: () => void;
  onRestore: () => void;
}

export default function VersionHistoryPanel({ appId, onClose, onRestore }: Props) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(null);
  const [changedFiles, setChangedFiles] = useState<DiffEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [appId]);

  const loadHistory = async () => {
    try {
      const log = await window.dyad.gitLog(appId);
      setCommits(log);
    } catch (err) { console.debug('Handled error:', err); setCommits([]); }
  };

  const selectCommit = useCallback(async (commit: GitLogEntry) => {
    setSelectedCommit(commit);
    setViewingFile(null);
    setFileContent(null);
    setLoading(true);
    try {
      const files = await window.dyad.gitDiffStat(appId, commit.hash);
      setChangedFiles(files);
    } catch (err) { console.debug('Handled error:', err); setChangedFiles([]); }
    setLoading(false);
  }, [appId]);

  const viewFile = useCallback(async (filePath: string) => {
    if (!selectedCommit) return;
    setViewingFile(filePath);
    setLoading(true);
    try {
      const content = await window.dyad.gitShow(appId, selectedCommit.hash, filePath);
      setFileContent(content);
    } catch (err) { console.debug('Handled error:', err); setFileContent(null); }
    setLoading(false);
  }, [appId, selectedCommit]);

  const handleRestore = useCallback(async () => {
    if (!selectedCommit) return;
    setConfirmOpen(true);
  }, [selectedCommit]);

  const handleConfirmRestore = useCallback(async () => {
    if (!selectedCommit) return;
    setConfirmOpen(false);
    setRestoring(true);
    try {
      const result = await window.dyad.gitCheckout(appId, selectedCommit.hash);
      if (result.success) {
        onRestore();
        onClose();
      } else {
        setErrorMsg(`Restore failed: ${result.error}`);
      }
    } catch (err) {
      setErrorMsg(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setRestoring(false);
  }, [appId, selectedCommit, onRestore, onClose]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (err) { console.debug('Handled error:', err); return dateStr; }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal version-history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Version History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {errorMsg && (
          <div className="error-banner">
            <span>{errorMsg}</span>
            <button className="btn-retry" onClick={() => setErrorMsg(null)}>✕</button>
          </div>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title="Restore Version"
          message={`Restore all files to commit "${selectedCommit?.message}"? This will overwrite current files.`}
          confirmLabel="Restore"
          onConfirm={handleConfirmRestore}
          onCancel={() => setConfirmOpen(false)}
        />

        <div className="modal-body version-history-body">
          {/* Timeline */}
          <div className="vh-timeline">
            <div className="vh-timeline-header">Commits</div>
            {commits.length === 0 ? (
              <p className="vh-empty">No commits yet</p>
            ) : (
              commits.map((c) => (
                <div
                  key={c.hash}
                  className={`vh-commit ${selectedCommit?.hash === c.hash ? 'active' : ''}`}
                  onClick={() => selectCommit(c)}
                >
                  <div className="vh-commit-dot" />
                  <div className="vh-commit-info">
                    <span className="vh-commit-msg">{c.message}</span>
                    <span className="vh-commit-date">{formatDate(c.date)}</span>
                    <span className="vh-commit-hash">{c.hash.slice(0, 7)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Details */}
          <div className="vh-details">
            {selectedCommit ? (
              <>
                <div className="vh-details-header">
                  <h3>{selectedCommit.message}</h3>
                  <button
                    className="btn-primary btn-restore"
                    onClick={handleRestore}
                    disabled={restoring}
                  >
                    {restoring ? 'Restoring…' : 'Restore This Version'}
                  </button>
                </div>

                {loading ? (
                  <p className="vh-loading">Loading…</p>
                ) : viewingFile && fileContent !== null ? (
                  <div className="vh-file-view">
                    <div className="vh-file-view-header">
                      <button className="btn-secondary" onClick={() => { setViewingFile(null); setFileContent(null); }}>
                        ← Back
                      </button>
                      <span>{viewingFile}</span>
                    </div>
                    <pre className="vh-file-content">{fileContent}</pre>
                  </div>
                ) : (
                  <div className="vh-changed-files">
                    <div className="vh-files-header">Changed Files ({changedFiles.length})</div>
                    {changedFiles.map((f) => (
                      <div
                        key={f.path}
                        className="vh-changed-file"
                        onClick={() => viewFile(f.path)}
                      >
                        <span className={`vh-status vh-status-${f.status}`}>
                          {f.status === 'A' ? '+' : f.status === 'D' ? '-' : '~'}
                        </span>
                        <span className="vh-file-path">{f.path}</span>
                      </div>
                    ))}
                    {changedFiles.length === 0 && <p className="vh-empty">No file changes found</p>}
                  </div>
                )}
              </>
            ) : (
              <div className="vh-empty-detail">
                <p>Select a commit to see details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
