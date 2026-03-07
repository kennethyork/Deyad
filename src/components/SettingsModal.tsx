import { useState, useEffect } from 'react';

type AiProvider = 'ollama' | 'openai' | 'anthropic' | 'google';

interface Props {
  onClose: () => void;
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  ollama: '🦙 Ollama (Local)',
  openai: '🟢 OpenAI',
  anthropic: '🟠 Anthropic',
  google: '🔵 Google Gemini',
};

export default function SettingsModal({ onClose }: Props) {
  const [ollamaHost, setOllamaHost] = useState('http://localhost:11434');
  const [defaultModel, setDefaultModel] = useState('');
  const [aiProvider, setAiProvider] = useState<AiProvider>('ollama');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');
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
    setAiProvider((settings.aiProvider as AiProvider) || 'ollama');
    setOpenaiApiKey(settings.openaiApiKey || '');
    setAnthropicApiKey(settings.anthropicApiKey || '');
    setGoogleApiKey(settings.googleApiKey || '');
    loadModels();
  };

  const loadModels = async () => {
    try {
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
    } catch { /* Provider not available */ }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await window.deyad.setSettings({
      ollamaHost: ollamaHost.trim(),
      defaultModel,
      aiProvider,
      openaiApiKey: openaiApiKey.trim(),
      anthropicApiKey: anthropicApiKey.trim(),
      googleApiKey: googleApiKey.trim(),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTestResult('testing');
    try {
      // Save current settings first so the backend uses them
      await window.deyad.setSettings({
        ollamaHost: ollamaHost.trim(),
        aiProvider,
        openaiApiKey: openaiApiKey.trim(),
        anthropicApiKey: anthropicApiKey.trim(),
        googleApiKey: googleApiKey.trim(),
      });
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
      setTestResult('success');
    } catch {
      setTestResult('error');
    }
    setTimeout(() => setTestResult('idle'), 3000);
  };

  const handleProviderChange = async (provider: AiProvider) => {
    setAiProvider(provider);
    setDefaultModel('');
    setModels([]);
    // Save provider choice and reload models
    await window.deyad.setSettings({ aiProvider: provider });
    try {
      const { models: list } = await window.deyad.listModels();
      setModels(list.map((m) => m.name));
      if (list.length > 0) setDefaultModel(list[0].name);
    } catch { /* Provider not available */ }
  };

  /** Mask an API key for display (show first 4 and last 4 chars). */
  const maskKey = (key: string) => {
    if (key.length <= 8) return key ? '••••••••' : '';
    return key;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* AI Provider selector */}
          <div className="form-field">
            <label>AI Provider</label>
            <div className="provider-cards">
              {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`provider-card ${aiProvider === p ? 'selected' : ''}`}
                  onClick={() => handleProviderChange(p)}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Ollama settings */}
          {aiProvider === 'ollama' && (
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
                  {testResult === 'testing' ? '⏳' : testResult === 'success' ? '✅' : testResult === 'error' ? '❌' : '🔌'} Test
                </button>
              </div>
              <span className="form-hint">
                The URL where Ollama is running. Override with OLLAMA_HOST env var.
              </span>
            </div>
          )}

          {/* OpenAI API Key */}
          {aiProvider === 'openai' && (
            <div className="form-field">
              <label htmlFor="openai-key">OpenAI API Key</label>
              <div className="settings-host-row">
                <input
                  id="openai-key"
                  type="password"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder="sk-..."
                />
                <button className="btn-secondary btn-test" onClick={handleTest} disabled={testResult === 'testing'}>
                  {testResult === 'testing' ? '⏳' : testResult === 'success' ? '✅' : testResult === 'error' ? '❌' : '🔌'} Test
                </button>
              </div>
              <span className="form-hint">
                Your OpenAI API key. Get one at platform.openai.com.
              </span>
            </div>
          )}

          {/* Anthropic API Key */}
          {aiProvider === 'anthropic' && (
            <div className="form-field">
              <label htmlFor="anthropic-key">Anthropic API Key</label>
              <div className="settings-host-row">
                <input
                  id="anthropic-key"
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                />
                <button className="btn-secondary btn-test" onClick={handleTest} disabled={testResult === 'testing'}>
                  {testResult === 'testing' ? '⏳' : testResult === 'success' ? '✅' : testResult === 'error' ? '❌' : '🔌'} Test
                </button>
              </div>
              <span className="form-hint">
                Your Anthropic API key. Get one at console.anthropic.com.
              </span>
            </div>
          )}

          {/* Google API Key */}
          {aiProvider === 'google' && (
            <div className="form-field">
              <label htmlFor="google-key">Google AI API Key</label>
              <div className="settings-host-row">
                <input
                  id="google-key"
                  type="password"
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  placeholder="AIza..."
                />
                <button className="btn-secondary btn-test" onClick={handleTest} disabled={testResult === 'testing'}>
                  {testResult === 'testing' ? '⏳' : testResult === 'success' ? '✅' : testResult === 'error' ? '❌' : '🔌'} Test
                </button>
              </div>
              <span className="form-hint">
                Your Google AI Studio API key. Get one at aistudio.google.com.
              </span>
            </div>
          )}

          {/* Default model */}
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
            <span className="form-hint">
              The model to select by default when opening a new chat.
            </span>
          </div>

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
