import { useState, useEffect, useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  appId: string;
}

export default function PackageManagerPanel({ appId }: Props) {
  const [deps, setDeps] = useState<Record<string, string>>({});
  const [devDeps, setDevDeps] = useState<Record<string, string>>({});
  const [installName, setInstallName] = useState('');
  const [isDev, setIsDev] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  const loadDeps = useCallback(async () => {
    try {
      const result = await window.deyad.npmList(appId);
      setDeps(result.dependencies || {});
      setDevDeps(result.devDependencies || {});
    } catch { /* ignore */ }
  }, [appId]);

  useEffect(() => { loadDeps(); }, [loadDeps]);

  const handleInstall = async () => {
    const name = installName.trim();
    if (!name || installing) return;
    setInstalling(true);
    setStatus(`Installing ${name}…`);
    const result = await window.deyad.npmInstall(appId, name, isDev);
    if (result.success) {
      setStatus(`✓ Installed ${name}`);
      setInstallName('');
      loadDeps();
    } else {
      setStatus(`✗ ${result.error}`);
    }
    setInstalling(false);
    setTimeout(() => setStatus(null), 4000);
  };

  const handleUninstall = async (name: string) => {
    setConfirmTarget(name);
  };

  const handleConfirmUninstall = async () => {
    const name = confirmTarget;
    if (!name) return;
    setConfirmTarget(null);
    setStatus(`Removing ${name}…`);
    const result = await window.deyad.npmUninstall(appId, name);
    if (result.success) {
      setStatus(`✓ Removed ${name}`);
      loadDeps();
    } else {
      setStatus(`✗ ${result.error}`);
    }
    setTimeout(() => setStatus(null), 4000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleInstall();
  };

  return (
    <div className="package-manager-panel">
      <ConfirmDialog
        open={confirmTarget !== null}
        title="Uninstall Package"
        message={`Uninstall ${confirmTarget}?`}
        confirmLabel="Uninstall"
        onConfirm={handleConfirmUninstall}
        onCancel={() => setConfirmTarget(null)}
      />
      <div className="pm-install-row">
        <input
          className="pm-install-input"
          value={installName}
          onChange={(e) => setInstallName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Package name (e.g. axios)"
          disabled={installing}
        />
        <label className="pm-dev-label">
          <input type="checkbox" checked={isDev} onChange={(e) => setIsDev(e.target.checked)} />
          dev
        </label>
        <button className="btn-primary pm-install-btn" onClick={handleInstall} disabled={installing || !installName.trim()}>
          {installing ? '…' : 'Install'}
        </button>
      </div>

      {status && <div className="pm-status">{status}</div>}

      <div className="pm-section">
        <div className="pm-section-header">Dependencies ({Object.keys(deps).length})</div>
        {Object.entries(deps).map(([name, version]) => (
          <div key={name} className="pm-package">
            <span className="pm-name">{name}</span>
            <span className="pm-version">{version}</span>
            <button className="pm-remove" onClick={() => handleUninstall(name)} title="Uninstall">×</button>
          </div>
        ))}
        {Object.keys(deps).length === 0 && <p className="pm-empty">No dependencies</p>}
      </div>

      <div className="pm-section">
        <div className="pm-section-header">Dev Dependencies ({Object.keys(devDeps).length})</div>
        {Object.entries(devDeps).map(([name, version]) => (
          <div key={name} className="pm-package">
            <span className="pm-name">{name}</span>
            <span className="pm-version">{version}</span>
            <button className="pm-remove" onClick={() => handleUninstall(name)} title="Uninstall">×</button>
          </div>
        ))}
        {Object.keys(devDeps).length === 0 && <p className="pm-empty">No dev dependencies</p>}
      </div>
    </div>
  );
}
