import { useState, useEffect } from 'react';
import type { PluginManifest, RegistryPlugin } from '../types/deyad';

interface Props {
  onClose: () => void;
}

export default function PluginMarketplace({ onClose }: Props) {
  const [tab, setTab] = useState<'browse' | 'installed'>('browse');
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [installed, setInstalled] = useState<PluginManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [reg, inst] = await Promise.all([
        window.deyad.pluginRegistryList(),
        window.deyad.listPlugins(),
      ]);
      setRegistry(reg);
      setInstalled(inst);
    } catch (err) {
      setError('Failed to load plugin data');
      console.warn('loadData:', err);
    }
    setLoading(false);
  };

  const handleInstall = async (plugin: RegistryPlugin) => {
    setInstalling(plugin.name);
    setError(null);
    const res = await window.deyad.pluginInstall(plugin.repo);
    if (res.success) {
      const inst = await window.deyad.listPlugins();
      setInstalled(inst);
    } else {
      setError(res.error ?? 'Install failed');
    }
    setInstalling(null);
  };

  const handleUninstall = async (pluginName: string) => {
    setUninstalling(pluginName);
    setError(null);
    const res = await window.deyad.pluginUninstall(pluginName);
    if (res.success) {
      const inst = await window.deyad.listPlugins();
      setInstalled(inst);
    } else {
      setError(res.error ?? 'Uninstall failed');
    }
    setUninstalling(null);
  };

  const installedNames = new Set(installed.map((p) => p.name));

  const filtered = registry.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q)
      || p.author.toLowerCase().includes(q)
      || (p.tags ?? []).some((t) => t.toLowerCase().includes(q));
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal marketplace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🧩 Plugin Marketplace</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="marketplace-tabs">
          <button
            className={`marketplace-tab ${tab === 'browse' ? 'active' : ''}`}
            onClick={() => setTab('browse')}
          >
            Browse Registry
          </button>
          <button
            className={`marketplace-tab ${tab === 'installed' ? 'active' : ''}`}
            onClick={() => setTab('installed')}
          >
            Installed ({installed.length})
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="marketplace-error">{error}</div>
          )}

          {tab === 'browse' && (
            <>
              <div className="form-field">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search plugins…"
                  autoFocus
                />
              </div>

              {loading ? (
                <div className="marketplace-loading">Loading registry…</div>
              ) : filtered.length === 0 ? (
                <div className="marketplace-empty">
                  {registry.length === 0
                    ? 'No plugins in registry yet. Check back soon!'
                    : 'No plugins match your search.'}
                </div>
              ) : (
                <div className="marketplace-grid">
                  {filtered.map((plugin) => (
                    <div key={plugin.name} className="marketplace-card">
                      <div className="marketplace-card-header">
                        <span className="marketplace-card-name">{plugin.name}</span>
                        <span className="marketplace-card-version">v{plugin.version}</span>
                      </div>
                      <p className="marketplace-card-desc">{plugin.description}</p>
                      <div className="marketplace-card-meta">
                        <span className="marketplace-card-author">by {plugin.author}</span>
                        {plugin.tags && plugin.tags.length > 0 && (
                          <div className="marketplace-card-tags">
                            {plugin.tags.map((t) => (
                              <span key={t} className="marketplace-tag">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="marketplace-card-actions">
                        {installedNames.has(plugin.name) ? (
                          <span className="marketplace-installed-badge">✓ Installed</span>
                        ) : (
                          <button
                            className="btn-primary btn-sm"
                            onClick={() => handleInstall(plugin)}
                            disabled={installing === plugin.name}
                          >
                            {installing === plugin.name ? 'Installing…' : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'installed' && (
            <>
              {installed.length === 0 ? (
                <div className="marketplace-empty">
                  No plugins installed. Browse the registry to get started!
                </div>
              ) : (
                <div className="marketplace-grid">
                  {installed.map((plugin) => (
                    <div key={plugin.name} className="marketplace-card">
                      <div className="marketplace-card-header">
                        <span className="marketplace-card-name">{plugin.name}</span>
                      </div>
                      {plugin.description && (
                        <p className="marketplace-card-desc">{plugin.description}</p>
                      )}
                      <div className="marketplace-card-meta">
                        {plugin.templates && plugin.templates.length > 0 && (
                          <span className="marketplace-card-count">{plugin.templates.length} templates</span>
                        )}
                        {plugin.agentTools && plugin.agentTools.length > 0 && (
                          <span className="marketplace-card-count">{plugin.agentTools.length} tools</span>
                        )}
                        {plugin.agents && plugin.agents.length > 0 && (
                          <span className="marketplace-card-count">{plugin.agents.length} agents</span>
                        )}
                        {plugin.themes && plugin.themes.length > 0 && (
                          <span className="marketplace-card-count">{plugin.themes.length} themes</span>
                        )}
                      </div>
                      <div className="marketplace-card-actions">
                        <button
                          className="btn-secondary btn-sm btn-danger"
                          onClick={() => handleUninstall(plugin.name)}
                          disabled={uninstalling === plugin.name}
                        >
                          {uninstalling === plugin.name ? 'Removing…' : 'Uninstall'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
