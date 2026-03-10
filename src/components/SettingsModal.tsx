import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [defaultModel, setDefaultModel] = useState('');
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [completionModel, setCompletionModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const settings = await window.deyad.getSettings();
    setOllamaHost(settings.ollamaHost);
    setDefaultModel(settings.defaultModel);
    setAutocompleteEnabled(settings.autocompleteEnabled ?? false);
    setCompletionModel(settings.completionModel ?? '');
    loadModels();
  };

  const loadModels = async () => {
    try {
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
    } catch { /* not available */ }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await window.deyad.setSettings({
      ollamaHost: ollamaHost.trim(),
      defaultModel,
      autocompleteEnabled,
      completionModel,
    });
    setSaving(false);
    setSaved(true);
    loadModels();
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTestResult('testing');
    try {
      await window.deyad.setSettings({
        ollamaHost: ollamaHost.trim(),
      });
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
      setTestResult('success');
    } catch {
      setTestResult('error');
    }
    setTimeout(() => setTestResult('idle'), 3000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label htmlFor="ollama-host">Ollama Host URL</label>
            <div className="settings-host-row">
              <input
                id="ollama-host"
                value={ollamaHost}
                onChange={(e) => setOllamaHost(e.target.value)}
                placeholder="http://localhost:11434"
              />
              <button className="btn-secondary btn-test" onClick={handleTest} disabled={testResult === 'testing'}>
                {testResult === 'testing' ? 'Testing…' : testResult === 'success' ? 'Success' : testResult === 'error' ? 'Error' : 'Test'}
              </button>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="default-model">Default Model</label>
            <select
              id="default-model"
              className="model-select settings-model-select"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            >
              <option value="">Auto (use first available)</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <hr className="settings-divider" />

          <div className="form-field">
            <label className="settings-toggle-label">
              <input
                type="checkbox"
                checked={autocompleteEnabled}
                onChange={(e) => setAutocompleteEnabled(e.target.checked)}
              />
              Enable inline autocomplete
            </label>
            <span className="settings-hint">AI-powered code suggestions as you type (uses Ollama FIM)</span>
          </div>

          {autocompleteEnabled && (
            <div className="form-field">
              <label htmlFor="completion-model">Completion Model</label>
              <select
                id="completion-model"
                className="model-select settings-model-select"
                value={completionModel}
                onChange={(e) => setCompletionModel(e.target.value)}
              >
                <option value="">Same as default</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="settings-hint">Smaller/faster models like qwen2.5-coder:1.5b work best for autocomplete</span>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
