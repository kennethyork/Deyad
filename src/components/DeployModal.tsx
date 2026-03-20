import { useState, useEffect, useRef } from 'react';

interface Props {
  appId: string;
  appName: string;
  appType: 'frontend' | 'fullstack' | 'nextjs' | 'python' | 'go';
  onClose: () => void;
}

type FrontendProvider = 'netlify' | 'vercel' | 'surge';
type FullstackProvider = 'railway' | 'flyio';
type Provider = FrontendProvider | FullstackProvider;

interface ProviderInfo {
  id: Provider;
  name: string;
  desc: string;
  type: 'frontend' | 'fullstack' | 'both';
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'vercel', name: 'Vercel', desc: 'Best for frontend apps. Free tier.', type: 'both' },
  { id: 'netlify', name: 'Netlify', desc: 'Great for static sites & SPAs. Free tier.', type: 'both' },
  { id: 'surge', name: 'Surge', desc: 'Simple static hosting. Free.', type: 'frontend' },
  { id: 'railway', name: 'Railway', desc: 'Full-stack deploy with DB. Usage-based pricing.', type: 'fullstack' },
  { id: 'flyio', name: 'Fly.io', desc: 'Container-based deploy. Free tier.', type: 'fullstack' },
];

export default function DeployModal({ appId, appName, appType, onClose }: Props) {
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState('');
  const [result, setResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const [mobileStatus, setMobileStatus] = useState<string | null>(null);
  const [mobileWorking, setMobileWorking] = useState(false);
  const [mobilePlatform, setMobilePlatform] = useState<'android' | 'ios'>('android');
  const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [liveReload, setLiveReload] = useState(false);
  const [liveReloadActive, setLiveReloadActive] = useState(false);
  const [desktopPlatform, setDesktopPlatform] = useState<'linux' | 'win' | 'mac'>('linux');
  const [desktopWorking, setDesktopWorking] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState<string | null>(null);
  const [vpsHost, setVpsHost] = useState('');
  const [vpsUser, setVpsUser] = useState('');
  const [vpsPath, setVpsPath] = useState('/var/www/html');
  const [vpsPort, setVpsPort] = useState('22');
  const [vpsDomain, setVpsDomain] = useState('');
  const [vpsWorking, setVpsWorking] = useState(false);
  const [vpsStatus, setVpsStatus] = useState<string | null>(null);
  const [oauthTokens, setOauthTokens] = useState<Record<string, string | null>>({});
  const [oauthInput, setOauthInput] = useState<string | null>(null);
  const [oauthToken, setOauthToken] = useState('');

  useEffect(() => {
    checkCLIs();
    // Load saved OAuth tokens
    Promise.all([
      window.deyad.deployTokenGet('vercel'),
      window.deyad.deployTokenGet('netlify'),
    ]).then(([vToken, nToken]) => {
      setOauthTokens({ vercel: vToken, netlify: nToken });
    }).catch(() => {});
    const unsub = window.deyad.onDeployLog(({ appId: id, data }) => {
      if (id === appId) {
        setLogs((prev) => prev + data);
      }
    });
    return unsub;
  }, [appId]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const checkCLIs = async () => {
    setChecking(true);
    const checks = await window.deyad.deployCheck();
    setAvailable(checks);
    setChecking(false);
  };

  const filteredProviders = PROVIDERS.filter((p) => {
    if (appType === 'fullstack') return true; // show all
    return p.type === 'frontend' || p.type === 'both';
  });

  const handleDeploy = async () => {
    if (!selected) return;
    setDeploying(true);
    setLogs('');
    setResult(null);

    const isFullstackDeploy = selected === 'railway' || selected === 'flyio';

    const res = isFullstackDeploy
      ? await window.deyad.deployFullstack(appId, selected as FullstackProvider)
      : await window.deyad.deploy(appId, selected as FrontendProvider);

    setResult(res);
    setDeploying(false);
  };

type OAuthProvider = 'vercel' | 'netlify';

  const handleOauthSave = async (provider: OAuthProvider) => {
    if (!oauthToken.trim()) return;
    await window.deyad.deployTokenSet(provider, oauthToken.trim());
    setOauthTokens((prev) => ({ ...prev, [provider]: oauthToken.trim() }));
    setOauthInput(null);
    setOauthToken('');
  };

  const handleOauthDisconnect = async (provider: OAuthProvider) => {
    await window.deyad.deployTokenClear(provider);
    setOauthTokens((prev) => ({ ...prev, [provider]: null }));
  };

  const handleOauthDeploy = async (provider: OAuthProvider) => {
    const token = oauthTokens[provider];
    if (!token) return;
    setDeploying(true);
    setLogs('');
    setResult(null);
    const res = await window.deyad.deployOAuth(appId, provider, token);
    setResult(res);
    setDeploying(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal deploy-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Deploy {appName}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {checking ? (
            <div className="deploy-checking">Checking available deploy tools...</div>
          ) : (
            <>
              <p className="deploy-hint">
                Select a deployment provider. CLIs must be installed and authenticated.
              </p>

              <div className="deploy-providers">
                {filteredProviders.map((p) => {
                  const isAvailable = available[p.id] ?? false;
                  return (
                    <button
                      key={p.id}
                      className={`deploy-provider ${selected === p.id ? 'selected' : ''} ${!isAvailable ? 'unavailable' : ''}`}
                      onClick={() => isAvailable && setSelected(p.id)}
                      disabled={deploying}
                    >
                      <div className="deploy-provider-name">
                        {p.name}
                        {!isAvailable && <span className="deploy-cli-missing">CLI not found</span>}
                        {isAvailable && <span className="deploy-cli-ready">Ready</span>}
                      </div>
                      <div className="deploy-provider-desc">{p.desc}</div>
                    </button>
                  );
                })}
              </div>

              {Object.values(available).every((v) => !v) && (
                <div className="deploy-install-hint">
                  No deploy CLIs detected. Install one:
                  <code>npm i -g vercel</code> or <code>npm i -g netlify-cli</code>
                </div>
              )}

              {/* One-click OAuth deploy (no CLI needed) */}
              <div style={{ marginTop: '1rem' }}>
                <p className="deploy-hint" style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                  One-click deploy (no CLI needed)
                </p>
                {(['vercel', 'netlify'] as const).map((provider) => (
                  <div key={provider} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ width: 70, fontWeight: 500, textTransform: 'capitalize' }}>{provider}</span>
                    {oauthTokens[provider] ? (
                      <>
                        <span className="deploy-cli-ready">Connected</span>
                        <button
                          className="btn-primary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                          onClick={() => handleOauthDeploy(provider)}
                          disabled={deploying}
                        >
                          Deploy
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => handleOauthDisconnect(provider)}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : oauthInput === provider ? (
                      <>
                        <input
                          type="password"
                          placeholder="Paste access token"
                          value={oauthToken}
                          onChange={(e) => setOauthToken(e.target.value)}
                          style={{ flex: 1, fontSize: '0.8rem' }}
                        />
                        <button
                          className="btn-primary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => handleOauthSave(provider)}
                        >
                          Save
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => { setOauthInput(null); setOauthToken(''); }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
                        onClick={() => setOauthInput(provider)}
                      >
                        Connect with Token
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {logs && (
                <pre ref={logRef} className="deploy-logs">{logs}</pre>
              )}

              {result && (
                <div className={`deploy-result ${result.success ? 'success' : 'error'}`}>
                  {result.success ? (
                    <>
                      Deployed successfully!
                      {result.url && (
                        <button
                          className="deploy-url-btn"
                          onClick={() => navigator.clipboard.writeText(result.url!)}
                        >
                          {result.url} (click to copy)
                        </button>
                      )}
                    </>
                  ) : (
                    <>Deploy failed: {result.error}</>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Mobile / Capacitor ──────────────────────────────────── */}
          <div className="deploy-mobile-section">
            <h3>Mobile (Capacitor)</h3>

            {/* Row 1: Init + Platform selector */}
            <div className="deploy-mobile-row">
              <button
                className="btn-secondary"
                disabled={mobileWorking}
                onClick={async () => {
                  setMobileWorking(true);
                  setMobileStatus(null);
                  const res = await window.deyad.capacitorInit(appId);
                  if (res.alreadyInitialized) setMobileStatus('Capacitor already initialized.');
                  else if (res.success) setMobileStatus('Capacitor initialized successfully!');
                  else setMobileStatus(`Init failed: ${res.error}`);
                  setMobileWorking(false);
                }}
              >
                {mobileWorking ? 'Working…' : 'Initialize'}
              </button>

              <select
                className="deploy-mobile-select"
                value={mobilePlatform}
                onChange={(e) => {
                  setMobilePlatform(e.target.value as 'android' | 'ios');
                  setDevices([]);
                  setSelectedDevice('');
                }}
              >
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>

              <button
                className="btn-secondary"
                disabled={mobileWorking}
                onClick={async () => {
                  setMobileWorking(true);
                  setMobileStatus(null);
                  const res = await window.deyad.capacitorOpen(appId, mobilePlatform);
                  setMobileStatus(res.success ? `${mobilePlatform === 'android' ? 'Android Studio' : 'Xcode'} opened.` : `Error: ${res.error}`);
                  setMobileWorking(false);
                }}
              >
                Open IDE
              </button>
            </div>

            {/* Row 2: Device detection + Run on Device */}
            <div className="deploy-mobile-row">
              <button
                className="btn-secondary"
                disabled={loadingDevices || mobileWorking}
                onClick={async () => {
                  setLoadingDevices(true);
                  setMobileStatus(null);
                  const res = await window.deyad.capacitorListDevices(appId, mobilePlatform);
                  if (res.success && res.devices.length > 0) {
                    setDevices(res.devices);
                    setSelectedDevice(res.devices[0].id);
                  } else if (res.success) {
                    setMobileStatus('No devices/emulators found. Start an emulator or connect a device.');
                  } else {
                    setMobileStatus(`Error: ${res.error}`);
                  }
                  setLoadingDevices(false);
                }}
              >
                {loadingDevices ? 'Scanning…' : 'Detect Devices'}
              </button>

              {devices.length > 0 && (
                <select
                  className="deploy-mobile-select deploy-mobile-device-select"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}

              <button
                className="btn-primary"
                disabled={!selectedDevice || mobileWorking}
                onClick={async () => {
                  setMobileWorking(true);
                  setMobileStatus('Building & deploying to device…');
                  const res = await window.deyad.capacitorRun(appId, mobilePlatform, selectedDevice);
                  setMobileStatus(res.success ? 'App launched on device!' : `Error: ${res.error}`);
                  setMobileWorking(false);
                }}
              >
                Run on Device
              </button>
            </div>

            {/* Row 3: Live Reload toggle */}
            <div className="deploy-mobile-row deploy-mobile-livereload">
              <label className="deploy-mobile-toggle">
                <input
                  type="checkbox"
                  checked={liveReload}
                  disabled={mobileWorking}
                  onChange={async (e) => {
                    const enable = e.target.checked;
                    setMobileWorking(true);
                    setMobileStatus(enable ? 'Enabling live reload…' : 'Disabling live reload…');
                    const res = await window.deyad.capacitorLiveReload(appId, mobilePlatform, enable);
                    if (res.success) {
                      setLiveReload(enable);
                      setLiveReloadActive(enable);
                      setMobileStatus(enable ? `Live reload enabled! Device will connect to ${res.ip}. Start your dev server then re-run on device.` : 'Live reload disabled.');
                    } else {
                      setMobileStatus(`Error: ${res.error}`);
                    }
                    setMobileWorking(false);
                  }}
                />
                Live Reload
              </label>
              {liveReloadActive && <span className="deploy-mobile-live-badge">LIVE</span>}
              <span className="deploy-hint" style={{ margin: 0, fontSize: 11 }}>
                Edits in Deyad update the device in real-time via your local network.
              </span>
            </div>

            {mobileStatus && <div className="deploy-mobile-status">{mobileStatus}</div>}
          </div>

          {/* ── VPS (SSH + rsync) ───────────────────────────────────── */}
          <div className="deploy-mobile-section">
            <h3>VPS (SSH + rsync)</h3>
            <p className="deploy-hint" style={{ margin: '0 0 8px' }}>
              Deploy built files to any VPS via SSH. Requires rsync and SSH key auth.
            </p>

            <div className="deploy-mobile-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <input
                className="deploy-vps-input"
                placeholder="user"
                value={vpsUser}
                onChange={(e) => setVpsUser(e.target.value)}
                disabled={vpsWorking}
                style={{ width: 80 }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>@</span>
              <input
                className="deploy-vps-input"
                placeholder="host or IP"
                value={vpsHost}
                onChange={(e) => setVpsHost(e.target.value)}
                disabled={vpsWorking}
                style={{ width: 140 }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>:</span>
              <input
                className="deploy-vps-input"
                placeholder="/var/www/html"
                value={vpsPath}
                onChange={(e) => setVpsPath(e.target.value)}
                disabled={vpsWorking}
                style={{ width: 150 }}
              />
              <input
                className="deploy-vps-input"
                placeholder="port"
                value={vpsPort}
                onChange={(e) => setVpsPort(e.target.value)}
                disabled={vpsWorking}
                style={{ width: 50 }}
              />
            </div>

            <div className="deploy-mobile-row" style={{ gap: 6, marginTop: 6 }}>
              <input
                className="deploy-vps-input"
                placeholder="domain (optional, e.g. myapp.com)"
                value={vpsDomain}
                onChange={(e) => setVpsDomain(e.target.value)}
                disabled={vpsWorking}
                style={{ flex: 1 }}
              />
              <span className="deploy-hint" style={{ margin: 0, fontSize: 11 }}>
                Sets up nginx + free SSL via Let's Encrypt
              </span>
            </div>

            <div className="deploy-mobile-row" style={{ marginTop: 6 }}>
              <button
                className="btn-primary"
                disabled={vpsWorking || !vpsHost || !vpsUser}
                onClick={async () => {
                  setVpsWorking(true);
                  setVpsStatus('Deploying to VPS…');
                  setLogs('');
                  const res = await window.deyad.deployVps(appId, {
                    host: vpsHost,
                    user: vpsUser,
                    path: vpsPath,
                    port: parseInt(vpsPort, 10) || 22,
                    domain: vpsDomain.trim() || undefined,
                  });
                  if (res.success) {
                    setVpsStatus(`Deployed! ${res.url}`);
                  } else {
                    setVpsStatus(`Failed: ${res.error}`);
                  }
                  setVpsWorking(false);
                }}
              >
                {vpsWorking ? 'Deploying…' : 'Deploy to VPS'}
              </button>
            </div>

            {vpsStatus && <div className="deploy-mobile-status">{vpsStatus}</div>}
          </div>

          {/* ── Desktop / Electron ──────────────────────────────────── */}
          <div className="deploy-mobile-section">
            <h3>Desktop (Electron + Ollama)</h3>
            <p className="deploy-hint" style={{ margin: '0 0 8px' }}>
              Package this app as a standalone desktop application with built-in Ollama AI support.
            </p>

            <div className="deploy-mobile-row">
              <select
                className="deploy-mobile-select"
                value={desktopPlatform}
                onChange={(e) => setDesktopPlatform(e.target.value as 'linux' | 'win' | 'mac')}
                disabled={desktopWorking}
              >
                <option value="linux">Linux (AppImage)</option>
                <option value="win">Windows (exe)</option>
                <option value="mac">macOS (dmg)</option>
              </select>

              <button
                className="btn-primary"
                disabled={desktopWorking}
                onClick={async () => {
                  setDesktopWorking(true);
                  setDesktopStatus('Building desktop app…');
                  setLogs('');
                  const res = await window.deyad.deployElectron(appId, desktopPlatform);
                  if (res.success) {
                    setDesktopStatus(`Desktop app built! Output: ${res.outputDir}`);
                  } else {
                    setDesktopStatus(`Build failed: ${res.error}`);
                  }
                  setDesktopWorking(false);
                }}
              >
                {desktopWorking ? 'Building…' : 'Build Desktop App'}
              </button>
            </div>

            {desktopStatus && <div className="deploy-mobile-status">{desktopStatus}</div>}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={deploying}>
              {result?.success ? 'Done' : 'Cancel'}
            </button>
            {!result?.success && (
              <button
                className="btn-primary btn-deploy"
                onClick={handleDeploy}
                disabled={!selected || deploying}
              >
                {deploying ? 'Deploying…' : 'Deploy Now'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
