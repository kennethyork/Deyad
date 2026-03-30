import { useState, useEffect } from 'react';

interface Props {
  onComplete: () => void;
  onCreateApp: () => void;
}

type Step = 'welcome' | 'ollama' | 'model' | 'ready';

interface OllamaModel {
  name: string;
  details?: { parameter_size: string };
}

export default function WelcomeWizard({ onComplete, onCreateApp }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [checking, setChecking] = useState(false);

  const checkOllama = async () => {
    setChecking(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await window.deyad.listModels();
        setModels(res.models ?? []);
        setOllamaOk(true);
        if (res.models?.length) {
          setSelectedModel(res.models[0].name);
        }
        setChecking(false);
        return;
      } catch (err) {
        console.debug('Handled error:', err);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    setOllamaOk(false);
    setModels([]);
    setChecking(false);
  };

  useEffect(() => {
    if (step === 'ollama') {
      checkOllama();
    }
  }, [step]);

  const handleSelectModel = async () => {
    if (selectedModel) {
      await window.deyad.setSettings({ defaultModel: selectedModel });
    }
    setStep('ready');
  };

  const handleFinish = () => {
    onComplete();
  };

  const handleFinishAndCreate = () => {
    onComplete();
    onCreateApp();
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        {/* Progress dots */}
        <div className="wizard-progress">
          {(['welcome', 'ollama', 'model', 'ready'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`wizard-dot ${step === s ? 'active' : ''} ${
                ['welcome', 'ollama', 'model', 'ready'].indexOf(step) > i ? 'done' : ''
              }`}
            />
          ))}
        </div>

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="wizard-step">
            <div className="wizard-icon">&#x1F3D7;&#xFE0F;</div>
            <h2>Welcome to Deyad</h2>
            <p>Build full-stack apps with local AI — powered by Ollama.</p>
            <p className="wizard-detail">
              Your code stays on your machine. No API keys needed. Just describe what you want to build, and Deyad generates it.
            </p>
            <div className="wizard-actions">
              <button className="btn-primary" onClick={() => setStep('ollama')}>
                Get Started
              </button>
              <button className="btn-secondary wizard-skip" onClick={onComplete}>
                Skip Setup
              </button>
            </div>
          </div>
        )}

        {/* Step: Ollama Check */}
        {step === 'ollama' && (
          <div className="wizard-step">
            <div className="wizard-icon">&#x1F50C;</div>
            <h2>Connect to Ollama</h2>
            <p>Deyad uses Ollama to run AI models locally on your machine.</p>

            {checking && (
              <div className="wizard-status checking">
                <span className="preview-spinner" /> Checking connection...
              </div>
            )}

            {ollamaOk === true && !checking && (
              <div className="wizard-status success">
                Ollama is running — {models.length} model{models.length !== 1 ? 's' : ''} found.
              </div>
            )}

            {ollamaOk === false && !checking && (
              <div className="wizard-status error">
                <p>Could not connect to Ollama.</p>
                <p className="wizard-detail">
                  Make sure Ollama is installed and running. Visit{' '}
                  <strong>ollama.com</strong> to download it, then run <code>ollama serve</code>.
                </p>
                <button className="btn-secondary" onClick={checkOllama}>
                  Retry Connection
                </button>
              </div>
            )}

            <div className="wizard-actions">
              <button className="btn-secondary" onClick={() => setStep('welcome')}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={() => setStep('model')}
                disabled={!ollamaOk}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step: Select Model */}
        {step === 'model' && (
          <div className="wizard-step">
            <div className="wizard-icon">&#x1F9E0;</div>
            <h2>Choose a Model</h2>
            <p>Select the default model Deyad will use for code generation.</p>

            {models.length > 0 ? (
              <div className="wizard-model-list">
                {models.map((m) => (
                  <button
                    key={m.name}
                    className={`wizard-model-item ${selectedModel === m.name ? 'selected' : ''}`}
                    onClick={() => setSelectedModel(m.name)}
                  >
                    <span className="wizard-model-name">{m.name}</span>
                    {m.details?.parameter_size && (
                      <span className="wizard-model-size">{m.details.parameter_size}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="wizard-status error">
                <p>No models found. Pull a model first:</p>
                <code>ollama pull llama3.1</code>
              </div>
            )}

            <div className="wizard-actions">
              <button className="btn-secondary" onClick={() => setStep('ollama')}>
                Back
              </button>
              <button
                className="btn-primary"
                onClick={handleSelectModel}
                disabled={!selectedModel}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step: Ready */}
        {step === 'ready' && (
          <div className="wizard-step">
            <div className="wizard-icon">&#x1F680;</div>
            <h2>You&apos;re All Set!</h2>
            <p>
              Deyad is ready to go. Create your first app and start building with AI.
            </p>
            <ul className="wizard-tips">
              <li>Describe what you want to build in the chat</li>
              <li>Use <strong>Agent Mode</strong> for autonomous multi-step tasks</li>
              <li>Preview your app live and publish it when ready</li>
            </ul>
            <div className="wizard-actions">
              <button className="btn-secondary" onClick={handleFinish}>
                Close
              </button>
              <button className="btn-primary" onClick={handleFinishAndCreate}>
                Create First App
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
