import { useState, useEffect, useCallback } from 'react';

interface Props {
  appId: string;
  onFilesChanged?: () => void;
}

export default function GitPanel({ appId, onFilesChanged }: Props) {
  const [remoteUrl, setRemoteUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [currentBranch, setCurrentBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [commitMsg, setCommitMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [remote, branchInfo] = await Promise.all([
        window.deyad.gitRemoteGet(appId),
        window.deyad.gitBranch(appId),
      ]);
      setRemoteUrl(remote || '');
      setInputUrl(remote || '');
      setCurrentBranch(branchInfo.current);
      setBranches(branchInfo.branches);
    } catch (err) { console.debug('ignore:', err); }
  }, [appId]);

  useEffect(() => { refresh(); }, [refresh]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleSetRemote = async () => {
    if (!inputUrl.trim()) return;
    setLoading('remote');
    const res = await window.deyad.gitRemoteSet(appId, inputUrl.trim());
    if (res.success) {
      setRemoteUrl(inputUrl.trim());
      showMsg('success', 'Remote origin saved');
    } else {
      showMsg('error', res.error || 'Failed to set remote');
    }
    setLoading(null);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setLoading('commit');
    try {
      // Use safe IPC handler (execFileSync) — no shell injection risk
      const res = await window.deyad.gitCommitAgent(appId, commitMsg.trim());
      if (res.success) {
        setCommitMsg('');
        showMsg('success', 'Committed');
        refresh();
      } else {
        showMsg('error', res.error || 'Commit failed');
      }
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : String(err));
    }
    setLoading(null);
  };

  const handlePush = async () => {
    if (!remoteUrl) { showMsg('error', 'Set a remote URL first'); return; }
    setLoading('push');
    const res = await window.deyad.gitPush(appId);
    if (res.success) {
      showMsg('success', 'Pushed to remote');
    } else {
      showMsg('error', res.error || 'Push failed');
    }
    setLoading(null);
  };

  const handlePull = async () => {
    if (!remoteUrl) { showMsg('error', 'Set a remote URL first'); return; }
    setLoading('pull');
    const res = await window.deyad.gitPull(appId);
    if (res.success) {
      showMsg('success', 'Pulled from remote');
      onFilesChanged?.();
    } else {
      showMsg('error', res.error || 'Pull failed');
    }
    setLoading(null);
  };

  const handleCreateBranch = async () => {
    if (!newBranch.trim()) return;
    setLoading('branch');
    const res = await window.deyad.gitBranchCreate(appId, newBranch.trim());
    if (res.success) {
      showMsg('success', `Created branch ${newBranch.trim()}`);
      setNewBranch('');
      refresh();
      onFilesChanged?.();
    } else {
      showMsg('error', res.error || 'Failed to create branch');
    }
    setLoading(null);
  };

  const handleSwitchBranch = async (name: string) => {
    if (name === currentBranch) return;
    setLoading('branch');
    const res = await window.deyad.gitBranchSwitch(appId, name);
    if (res.success) {
      showMsg('success', `Switched to ${name}`);
      refresh();
      onFilesChanged?.();
    } else {
      showMsg('error', res.error || 'Failed to switch branch');
    }
    setLoading(null);
  };

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <h3>Git / GitHub</h3>
        <span className="git-branch-badge">{currentBranch}</span>
      </div>

      {message && (
        <div className={`git-msg git-msg-${message.type}`}>{message.text}</div>
      )}

      {/* Remote URL */}
      <section className="git-section">
        <label className="git-label">Remote Origin</label>
        <div className="git-remote-row">
          <input
            className="git-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            onKeyDown={(e) => e.key === 'Enter' && handleSetRemote()}
          />
          <button
            className="btn-git"
            onClick={handleSetRemote}
            disabled={loading === 'remote' || !inputUrl.trim()}
          >
            {loading === 'remote' ? '...' : 'Save'}
          </button>
        </div>
      </section>

      {/* Commit */}
      <section className="git-section">
        <label className="git-label">Commit</label>
        <div className="git-remote-row">
          <input
            className="git-input"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
          />
          <button
            className="btn-git"
            onClick={handleCommit}
            disabled={loading === 'commit' || !commitMsg.trim()}
          >
            {loading === 'commit' ? '...' : 'Commit'}
          </button>
        </div>
      </section>

      {/* Push / Pull */}
      <section className="git-section">
        <label className="git-label">Sync</label>
        <div className="git-actions-row">
          <button
            className="btn-git btn-git-push"
            onClick={handlePush}
            disabled={loading === 'push' || !remoteUrl}
          >
            {loading === 'push' ? 'Pushing...' : '⬆ Push'}
          </button>
          <button
            className="btn-git btn-git-pull"
            onClick={handlePull}
            disabled={loading === 'pull' || !remoteUrl}
          >
            {loading === 'pull' ? 'Pulling...' : '⬇ Pull'}
          </button>
        </div>
      </section>

      {/* Branches */}
      <section className="git-section">
        <label className="git-label">Branches</label>
        <div className="git-branch-list">
          {branches.map((b) => (
            <button
              key={b}
              className={`git-branch-item ${b === currentBranch ? 'active' : ''}`}
              onClick={() => handleSwitchBranch(b)}
              disabled={loading === 'branch'}
            >
              {b === currentBranch && '● '}{b}
            </button>
          ))}
        </div>
        <div className="git-remote-row" style={{ marginTop: 6 }}>
          <input
            className="git-input"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="New branch name..."
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
          />
          <button
            className="btn-git"
            onClick={handleCreateBranch}
            disabled={loading === 'branch' || !newBranch.trim()}
          >
            {loading === 'branch' ? '...' : 'Create'}
          </button>
        </div>
      </section>

      <div className="git-hint">
        Or just type <strong>git push</strong>, <strong>git pull</strong>,
        or any git command in the chat — the AI will handle it.
      </div>
    </div>
  );
}
