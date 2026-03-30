import { useState, useEffect, useCallback } from 'react';

interface Props {
  appId: string;
}

export default function EnvVarsPanel({ appId }: Props) {
  const [envFiles, setEnvFiles] = useState<Record<string, Record<string, string>>>({});
  const [activeFile, setActiveFile] = useState<string>('.env');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadEnv = useCallback(async () => {
    try {
      const result = await window.dyad.envRead(appId);
      setEnvFiles(result);
      const files = Object.keys(result);
      if (files.length > 0 && !result[activeFile]) {
        setActiveFile(files[0]);
      }
    } catch (err) { console.debug('ignore:', err); }
  }, [appId, activeFile]);

  useEffect(() => { loadEnv(); }, [loadEnv]);

  const activeVars = envFiles[activeFile] || {};

  const handleSave = useCallback(async (vars: Record<string, string>) => {
    setSaving(true);
    const result = await window.dyad.envWrite(appId, activeFile, vars);
    if (result.success) {
      setStatus('✓ Saved');
      loadEnv();
    } else {
      setStatus(`✗ ${result.error}`);
    }
    setSaving(false);
    setTimeout(() => setStatus(null), 2000);
  }, [appId, activeFile, loadEnv]);

  const handleAdd = () => {
    const key = newKey.trim().toUpperCase();
    if (!key) return;
    const updated = { ...activeVars, [key]: newValue };
    handleSave(updated);
    setNewKey('');
    setNewValue('');
  };

  const handleDelete = (key: string) => {
    const updated = { ...activeVars };
    delete updated[key];
    handleSave(updated);
  };

  const handleEdit = (key: string, value: string) => {
    const updated = { ...activeVars, [key]: value };
    handleSave(updated);
  };

  const [newEnvFileName, setNewEnvFileName] = useState('');
  const [showNewFileInput, setShowNewFileInput] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  const handleNewFile = () => {
    if (!showNewFileInput) {
      setShowNewFileInput(true);
      setNewEnvFileName('.env.');
      return;
    }
    const name = newEnvFileName.trim();
    if (!name) { setShowNewFileInput(false); return; }
    if (!name.startsWith('.env')) {
      setEnvError('File name must start with .env');
      setTimeout(() => setEnvError(null), 3000);
      return;
    }
    setActiveFile(name);
    setEnvFiles((prev) => ({ ...prev, [name]: {} }));
    setShowNewFileInput(false);
    setNewEnvFileName('');
  };

  const fileNames = Object.keys(envFiles);

  return (
    <div className="env-vars-panel">
      <div className="env-tabs">
        {fileNames.map((f) => (
          <button
            key={f}
            className={`env-tab ${activeFile === f ? 'active' : ''}`}
            onClick={() => setActiveFile(f)}
          >
            {f}
          </button>
        ))}
        <button className="env-tab env-tab-add" onClick={handleNewFile}>+</button>
        {showNewFileInput && (
          <input
            className="env-key-input"
            value={newEnvFileName}
            onChange={(e) => setNewEnvFileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNewFile(); if (e.key === 'Escape') setShowNewFileInput(false); }}
            onBlur={() => setShowNewFileInput(false)}
            placeholder=".env.local"
            autoFocus
          />
        )}
      </div>

      {envError && <div className="env-status" style={{ color: '#ef4444' }}>{envError}</div>}

      {status && <div className="env-status">{status}</div>}

      <div className="env-list">
        {Object.entries(activeVars).map(([key, value]) => (
          <div key={key} className="env-row">
            <span className="env-key">{key}</span>
            <input
              className="env-value-input"
              value={value}
              onChange={(e) => {
                setEnvFiles((prev) => ({
                  ...prev,
                  [activeFile]: { ...prev[activeFile], [key]: e.target.value },
                }));
              }}
              onBlur={(e) => handleEdit(key, e.target.value)}
            />
            <button className="env-delete" onClick={() => handleDelete(key)}>×</button>
          </div>
        ))}
      </div>

      <div className="env-add-row">
        <input
          className="env-key-input"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="KEY"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input
          className="env-value-input"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-primary env-add-btn" onClick={handleAdd} disabled={saving || !newKey.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
