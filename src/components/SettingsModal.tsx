import { useState, useEffect } from 'react';

interface Props {
  onClose: () => void;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
}

export default function SettingsModal({ onClose, theme, onThemeChange }: Props) {
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [defaultModel, setDefaultModel] = useState('');
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [completionModel, setCompletionModel] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [repeatPenalty, setRepeatPenalty] = useState(1.1);
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
    setEmbedModel(settings.embedModel ?? '');
    setTemperature(settings.temperature ?? 0.7);
    setTopP(settings.topP ?? 0.9);
    setRepeatPenalty(settings.repeatPenalty ?? 1.1);
    loadModels();
  };

  const loadModels = async () => {
    try {
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
    } catch (err) { console.debug('not available:', err); }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await window.deyad.setSettings({
      ollamaHost: ollamaHost.trim(),
      defaultModel,
      autocompleteEnabled,
      completionModel,
      embedModel,
      temperature,
      topP,
      repeatPenalty,
      theme,
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
    } catch (err) {
      console.debug('Handled error:', err);
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
          {/* ── Theme Toggle ──────────────────────────────────────── */}
          <div className="form-field">
            <label>Theme</label>
            <div className="settings-theme-toggle">
              <button
                className={`btn-secondary settings-theme-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => onThemeChange('dark')}
                type="button"
              >
                🌙 Dark
              </button>
              <button
                className={`btn-secondary settings-theme-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => onThemeChange('light')}
                type="button"
              >
                ☀️ Light
              </button>
            </div>
          </div>

          <hr className="settings-divider" />

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

          <hr className="settings-divider" />

          <div className="form-field">
            <label htmlFor="embed-model">Embedding Model (RAG)</label>
            <select
              id="embed-model"
              className="model-select settings-model-select"
              value={embedModel}
              onChange={(e) => setEmbedModel(e.target.value)}
            >
              <option value="">None (TF-IDF only)</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <span className="settings-hint">Enable RAG for smarter context. Use nomic-embed-text or similar embedding model.</span>
          </div>

          <hr className="settings-divider" />

          <div className="form-field">
            <label>Model Parameters</label>
            <span className="settings-hint">Fine-tune how the AI generates responses.</span>
          </div>

          <div className="form-field">
            <div className="settings-slider-row">
              <label htmlFor="temperature">Temperature</label>
              <input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span className="settings-slider-value">{temperature.toFixed(1)}</span>
            </div>
            <span className="settings-hint">Higher = more creative, lower = more focused (default: 0.7)</span>
          </div>

          <div className="form-field">
            <div className="settings-slider-row">
              <label htmlFor="top-p">Top P</label>
              <input
                id="top-p"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
              />
              <span className="settings-slider-value">{topP.toFixed(2)}</span>
            </div>
            <span className="settings-hint">Nucleus sampling threshold (default: 0.9)</span>
          </div>

          <div className="form-field">
            <div className="settings-slider-row">
              <label htmlFor="repeat-penalty">Repeat Penalty</label>
              <input
                id="repeat-penalty"
                type="range"
                min="1"
                max="2"
                step="0.05"
                value={repeatPenalty}
                onChange={(e) => setRepeatPenalty(parseFloat(e.target.value))}
              />
              <span className="settings-slider-value">{repeatPenalty.toFixed(2)}</span>
            </div>
            <span className="settings-hint">Penalize repetition in output (default: 1.1)</span>
          </div>

          <hr className="settings-divider" />

        </div>

        <div className="modal-actions settings-modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
