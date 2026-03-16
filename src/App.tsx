import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import EditorPanel from './components/EditorPanel';
import PreviewPanel from './components/PreviewPanel';
import TerminalPanel from './components/TerminalPanel';
import DatabasePanel from './components/DatabasePanel';
import NewAppModal from './components/NewAppModal';
import ImportModal from './components/ImportModal';
import SettingsModal from './components/SettingsModal';
import DeployModal from './components/DeployModal';
import WelcomeWizard from './components/WelcomeWizard';
import TaskQueuePanel from './components/TaskQueuePanel';
import DiffModal from './components/DiffModal';
import VersionHistoryPanel from './components/VersionHistoryPanel';
import PackageManagerPanel from './components/PackageManagerPanel';
import EnvVarsPanel from './components/EnvVarsPanel';
import GitPanel from './components/GitPanel';
import SearchPanel from './components/SearchPanel';
import ConfirmDialog from './components/ConfirmDialog';
import { taskQueue } from './lib/taskQueue';

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'postgresql';
  /** Host port for the database (unique per app). */
  dbPort?: number;
  /** Host port for the admin GUI — pgAdmin (unique per app). */
  guiPort?: number;
}

type RightTab = 'editor' | 'preview' | 'terminal' | 'database' | 'envvars' | 'packages' | 'git' | 'search';

/** Per-app state that persists across app switches. */
interface PerAppState {
  appFiles: Record<string, string>;
  selectedFile: string | null;
  dbStatus: 'none' | 'running' | 'stopped';
  rightTab: RightTab;
  canRevert: boolean;
  pendingDiffFiles: Record<string, string> | null;
  preAgentFiles: Record<string, string> | null;
}

const defaultPerAppState: PerAppState = {
  appFiles: {},
  selectedFile: null,
  dbStatus: 'none',
  rightTab: 'editor',
  canRevert: false,
  pendingDiffFiles: null,
  preAgentFiles: null,
};

export default function App() {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [perApp, setPerApp] = useState<Record<string, PerAppState>>({});
  const perAppRef = useRef(perApp);
  perAppRef.current = perApp;
  const [openedApps, setOpenedApps] = useState<string[]>([]);
  // sidebar width resizer
  const [showNewAppModal, setShowNewAppModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showTaskQueue, setShowTaskQueue] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [showPackageManager, setShowPackageManager] = useState(false);
  const [activeTasks, setActiveTasks] = useState(0);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'chat' | 'right'>('chat');
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [completionModel, setCompletionModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [exportConfirm, setExportConfirm] = useState<{ open: boolean; appId: string }>({ open: false, appId: '' });
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('deyad-theme') as 'dark' | 'light') || 'dark';
  });

  // Helper to update per-app state
  const updatePerApp = useCallback((appId: string, updates: Partial<PerAppState>) => {
    setPerApp(prev => ({
      ...prev,
      [appId]: { ...(prev[appId] ?? defaultPerAppState), ...updates },
    }));
  }, []);

  // Derived state for the currently selected app
  const cur = selectedApp ? (perApp[selectedApp.id] ?? defaultPerAppState) : defaultPerAppState;

  // resizable panels (persist sizes in localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = localStorage.getItem('sidebarWidth');
    const n = stored ? parseInt(stored, 10) : NaN;
    return isNaN(n) ? 220 : n;
  });
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const stored = localStorage.getItem('rightWidth');
    const n = stored ? parseInt(stored, 10) : NaN;
    return isNaN(n) ? 340 : n;
  });

  // Load app list on mount
  useEffect(() => {
    loadApps();
    // Load autocomplete settings
    window.deyad.getSettings().then((s) => {
      setAutocompleteEnabled(s.autocompleteEnabled ?? false);
      setCompletionModel(s.completionModel ?? '');
      setDefaultModel(s.defaultModel ?? '');
      if (s.theme) {
        setTheme(s.theme);
        localStorage.setItem('deyad-theme', s.theme);
      }
      if (!s.hasCompletedWizard) setShowWizard(true);
    }).catch((err) => console.warn('Failed to load settings:', err));
  }, []);

  // Subscribe to task queue changes for activity badge
  useEffect(() => {
    const unsub = taskQueue.subscribe(() => {
      const active = taskQueue.getAll().filter((t) => t.status === 'running' || t.status === 'queued');
      setActiveTasks(active.length);
    });
    // Set initial count
    setActiveTasks(taskQueue.getAll().filter((t) => t.status === 'running' || t.status === 'queued').length);
    return unsub;
  }, []);

  // Auto-refresh file tree when a background task completes (any app)
  useEffect(() => {
    taskQueue.setOnFilesChanged(async (appId) => {
      const files = await window.deyad.readFiles(appId);
      updatePerApp(appId, { appFiles: files });
    });
    return () => taskQueue.setOnFilesChanged(null);
  }, [updatePerApp]);

  // persist when sizes change (sidebar & right panel) and update CSS variables
  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('rightWidth', rightWidth.toString());
    document.documentElement.style.setProperty('--editor-width', `${rightWidth}px`);
  }, [rightWidth]);

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('deyad-theme', theme);
  }, [theme]);

  // Subscribe to DB status events (any app)
  useEffect(() => {
    const unsub = window.deyad.onDbStatus(({ appId, status }) => {
      setPerApp(prev => {
        if (!prev[appId]) return prev;
        return {
          ...prev,
          [appId]: { ...prev[appId], dbStatus: status as 'running' | 'stopped' },
        };
      });
    });
    return unsub;
  }, []);

  const loadApps = async () => {
    const list = await window.deyad.listApps();
    setApps(list);
  };

  const selectApp = useCallback(async (app: AppProject) => {
    setSelectedApp(app);
    setOpenedApps(prev => prev.includes(app.id) ? prev : [...prev, app.id]);

    try {
      const files = await window.deyad.readFiles(app.id);
      const hasSnap = await window.deyad.hasSnapshot(app.id);

      let dbSt: 'none' | 'running' | 'stopped' = 'none';
      if (app.appType === 'fullstack') {
        const result = await window.deyad.dbStatus(app.id);
        dbSt = result.status as 'none' | 'running' | 'stopped';
      }

      // Update files and status but preserve other per-app state (selectedFile, rightTab, etc.)
      setPerApp(prev => {
        const existing = prev[app.id] ?? defaultPerAppState;
        return {
          ...prev,
          [app.id]: { ...existing, appFiles: files, canRevert: hasSnap, dbStatus: dbSt },
        };
      });
    } catch (err) {
      console.error('Failed to load app:', err);
      setSelectedApp(null);
    }
  }, []);

  const handleFilesUpdated = useCallback((appId: string, newFiles: Record<string, string>) => {
    setPerApp(prev => {
      const s = prev[appId] ?? defaultPerAppState;
      const newPending = s.pendingDiffFiles
        ? { ...s.pendingDiffFiles, ...newFiles }
        : newFiles;
      const newPreAgent = s.pendingDiffFiles
        ? s.preAgentFiles
        : { ...s.appFiles };
      return {
        ...prev,
        [appId]: { ...s, pendingDiffFiles: newPending, preAgentFiles: newPreAgent },
      };
    });
    // Trigger preview iframe refresh after agent writes files
    setPreviewRefreshKey(k => k + 1);
  }, []);

  const handleApplyDiff = useCallback(async () => {
    if (!selectedApp) return;
    const appId = selectedApp.id;
    const s = perAppRef.current[appId] ?? defaultPerAppState;
    if (!s.pendingDiffFiles) return;

    if (s.preAgentFiles) {
      await window.deyad.snapshotFiles(appId, s.preAgentFiles);
    }
    const freshFiles = await window.deyad.readFiles(appId);
    const firstKey = Object.keys(s.pendingDiffFiles)[0];
    const updates: Partial<PerAppState> = {
      appFiles: freshFiles,
      canRevert: true,
      pendingDiffFiles: null,
      preAgentFiles: null,
    };
    if (firstKey) updates.selectedFile = firstKey;
    updatePerApp(appId, updates);
  }, [selectedApp, updatePerApp]);

  const handleRejectDiff = useCallback(async () => {
    if (!selectedApp) return;
    const appId = selectedApp.id;
    const s = perAppRef.current[appId] ?? defaultPerAppState;
    if (!s.preAgentFiles || !s.pendingDiffFiles) {
      updatePerApp(appId, { pendingDiffFiles: null, preAgentFiles: null });
      return;
    }

    const revertMap: Record<string, string> = {};
    for (const filePath of Object.keys(s.pendingDiffFiles)) {
      if (filePath in s.preAgentFiles) {
        revertMap[filePath] = s.preAgentFiles[filePath];
      }
    }
    if (Object.keys(revertMap).length > 0) {
      await window.deyad.writeFiles(appId, revertMap);
    }
    updatePerApp(appId, {
      appFiles: s.preAgentFiles,
      pendingDiffFiles: null,
      preAgentFiles: null,
    });
  }, [selectedApp, updatePerApp]);

  const handleFileEdit = useCallback(async (filePath: string, content: string) => {
    if (!selectedApp) return;
    const appId = selectedApp.id;
    await window.deyad.writeFiles(appId, { [filePath]: content });
    setPerApp(prev => {
      const s = prev[appId] ?? defaultPerAppState;
      return {
        ...prev,
        [appId]: { ...s, appFiles: { ...s.appFiles, [filePath]: content } },
      };
    });
  }, [selectedApp]);



  // global context menu support
  useEffect(() => {
    const handleContext = (e: MouseEvent) => {
      e.preventDefault();
      // if right-click happened inside terminal, we let TerminalPanel handle it;
      // otherwise show a generic global menu (copy/paste/select all).
      const el = e.target as HTMLElement;
      if (!el.closest('.terminal-panel')) {
        window.deyad.showContextMenu('global');
      }
    };
    window.addEventListener('contextmenu', handleContext);
    return () => window.removeEventListener('contextmenu', handleContext);
  }, []);

  // drag resizing helpers
  const startDrag = (type: 'sidebar' | 'right', startX: number) => {
    const initSidebar = sidebarWidth;
    const initRight = rightWidth;
    const move = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (type === 'sidebar') {
        setSidebarWidth(Math.max(100, initSidebar + dx));
      } else {
        setRightWidth(Math.max(200, initRight - dx));
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };


  const handleCreateApp = async (name: string, description: string, appType: 'frontend' | 'fullstack', templatePrompt?: string) => {
    const app = await window.deyad.createApp(name, description, appType, 'postgresql');
    setShowNewAppModal(false);
    await loadApps();

    if (appType === 'fullstack') {
      // Write scaffold files with randomly-generated DB credentials
      const { generateFullStackScaffold } = await import('./lib/scaffoldGenerator');
      const { generatePassword } = await import('./lib/crypto');
      const settings = await window.deyad.getSettings();
      const scaffold = generateFullStackScaffold({
        appName: name,
        description,
        dbName: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_db',
        dbUser: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_user',
        dbPassword: generatePassword(24),
        dbPort: app.dbPort,
        guiPort: app.guiPort,
        pgAdminEmail: settings.pgAdminEmail,
        pgAdminPassword: settings.pgAdminPassword,
      });
      await window.deyad.writeFiles(app.id, scaffold);
    } else {
      // Write a minimal runnable Vite scaffold so the app can be previewed right away
      const { generateFrontendScaffold } = await import('./lib/scaffoldGenerator');
      const scaffold = generateFrontendScaffold({ appName: name, description });
      await window.deyad.writeFiles(app.id, scaffold);
    }

    // If a template prompt was selected, queue it for auto-send in ChatPanel
    if (templatePrompt) {
      setPendingPrompt(templatePrompt);
    }

    await selectApp({ ...app });
  };

  const handleImportApp = async (name: string) => {
    setShowImportModal(false);
    const app = await window.deyad.importApp(name);
    if (app) {
      await loadApps();
      await selectApp(app);
    }
  };

  const handleDeleteApp = async (appId: string) => {
    // Stop dev server if running before deleting
    await window.deyad.appDevStop(appId).catch((err) => console.warn('appDevStop:', err));
    await window.deyad.deleteApp(appId);
    if (selectedApp?.id === appId) {
      setSelectedApp(null);
    }
    // Clean up per-app state and opened apps list
    setPerApp(prev => {
      const next = { ...prev };
      delete next[appId];
      return next;
    });
    setOpenedApps(prev => prev.filter(id => id !== appId));
    await loadApps();
  };

  const handleRenameApp = useCallback(async (appId: string, newName: string) => {
    await window.deyad.renameApp(appId, newName);
    setApps((prev) => prev.map((a) => a.id === appId ? { ...a, name: newName } : a));
    if (selectedApp?.id === appId) {
      setSelectedApp((prev) => prev ? { ...prev, name: newName } : prev);
    }
  }, [selectedApp]);

  const handleDuplicateApp = async (appId: string) => {
    const app = await window.deyad.duplicateApp(appId);
    if (app) {
      await loadApps();
      await selectApp(app as AppProject);
    }
  };

  const handleDbToggle = useCallback(async (appId: string) => {
    const s = perAppRef.current[appId] ?? defaultPerAppState;
    if (s.dbStatus === 'running') {
      updatePerApp(appId, { dbStatus: 'stopped' });
      const result = await window.deyad.dbStop(appId);
      if (!result.success) updatePerApp(appId, { dbStatus: 'running' });
    } else {
      updatePerApp(appId, { dbStatus: 'stopped' }); // optimistic
      const result = await window.deyad.dbStart(appId);
      if (result.success) {
        updatePerApp(appId, { dbStatus: 'running' });
      } else {
        alert(`Failed to start database:\n${result.error}`);
      }
    }
  }, [updatePerApp]);

  const handleRevert = useCallback(async (appId: string) => {
    const result = await window.deyad.revertFiles(appId);
    if (result.success) {
      const files = await window.deyad.readFiles(appId);
      updatePerApp(appId, { appFiles: files, selectedFile: null, canRevert: false });
    }
  }, [updatePerApp]);

  const handleExportApp = async (appId: string) => {
    setExportConfirm({ open: true, appId });
  };

  const doExport = async (mobile: boolean) => {
    const appId = exportConfirm.appId;
    setExportConfirm({ open: false, appId: '' });
    const result = await window.deyad.exportApp(appId, mobile ? 'mobile' : 'zip');
    if (result.success && result.path) {
      setExportResult(`${mobile ? 'Mobile export created at' : 'Exported to'} ${result.path}`);
    } else if (!result.success && result.error !== 'Cancelled') {
      setExportResult(`Export failed: ${result.error}`);
    }
  };

  return (
    <div
      className={`app-layout mobile-show-${mobilePanel}`}
      style={{
        gridTemplateColumns: `${sidebarWidth}px 4px 1fr 4px ${rightWidth}px`,
      }}
    >
      {/* sidebar */}
      <aside className={`sidebar ${sidebarVisible ? '' : 'hidden'}`}>
        <Sidebar
          apps={apps}
          selectedApp={selectedApp}
          onSelectApp={selectApp}
          onNewApp={() => setShowNewAppModal(true)}
          onDeleteApp={handleDeleteApp}
          onRenameApp={handleRenameApp}
          onDuplicateApp={handleDuplicateApp}
          onExportApp={handleExportApp}
          onDeployApp={() => setShowDeployModal(true)}
          onImportApp={() => setShowImportModal(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenTaskQueue={() => setShowTaskQueue(true)}
          onOpenVersionHistory={() => setShowVersionHistory(true)}
          activeTasks={activeTasks}
        />
      </aside>

      {/* menu button for narrow screens (hidden while modals open) */}
      {!(showNewAppModal || showSettings || showImportModal) && (
        <button
          className="btn-toggle-sidebar"
          onClick={() => setSidebarVisible((v) => !v)}
          title="Toggle sidebar"
        >
          ☰
        </button>
      )}
      {/* resizer between sidebar and centre */}
      <div
        className="resizer"
        data-side="sidebar"
        onMouseDown={(e) => startDrag('sidebar', e.clientX)}
      />

      {/* centre: chat panels (kept alive across app switches) or empty state */}
      {selectedApp ? (
        <div className="chat-wrapper">
          {openedApps.map(appId => {
            const appObj = apps.find(a => a.id === appId);
            if (!appObj) return null;
            const appState = perApp[appId] ?? defaultPerAppState;
            const isSelected = selectedApp?.id === appId;
            return (
              <div
                key={appId}
                style={{
                  display: isSelected ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: '100%',
                  width: '100%',
                }}
              >
                <ChatPanel
                  app={appObj}
                  appFiles={appState.appFiles}
                  selectedFile={appState.selectedFile}
                  dbStatus={appState.dbStatus}
                  onFilesUpdated={(newFiles) => handleFilesUpdated(appId, newFiles)}
                  onDbToggle={() => handleDbToggle(appId)}
                  onRevert={() => handleRevert(appId)}
                  canRevert={appState.canRevert}
                  initialPrompt={isSelected ? pendingPrompt : null}
                  onInitialPromptConsumed={() => setPendingPrompt(null)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-content">
            <div className="empty-logo"></div>
            <h2>Welcome to Deyad</h2>
            <p>A local AI app builder powered exclusively by Ollama.</p>
            <p className="empty-hint">Create a new app to get started →</p>
            <button className="btn-primary" onClick={() => setShowNewAppModal(true)}>
              + New App
            </button>
          </div>
        </div>
      )}

      {/* resizer between centre and right (always present) */}
      <div
        className="resizer"
        data-side="right"
        onMouseDown={(e) => startDrag('right', e.clientX)}
      />

      {/* right panel (always present so widths are always measurable) */}
      <div className="right-panel">
        {selectedApp && (
          <>
            <div className="right-panel-tabs">
              <button
                className={`right-tab ${cur.rightTab === 'editor' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'editor' })}
              >
                Files
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'preview' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'preview' })}
              >
                Preview
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'terminal' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'terminal' })}
              >
                Terminal
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'packages' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'packages' })}
              >
                Packages
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'envvars' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'envvars' })}
              >
                Env
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'search' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'search' })}
              >
                Search
              </button>
              <button
                className={`right-tab ${cur.rightTab === 'git' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'git' })}
              >
                Git
              </button>
              {selectedApp?.appType === 'fullstack' && (
                <button
                  className={`right-tab ${cur.rightTab === 'database' ? 'active' : ''}`}
                  onClick={() => updatePerApp(selectedApp.id, { rightTab: 'database' })}
                >
                  Database
                </button>
              )}
            </div>

            {cur.rightTab === 'editor' ? (
              <EditorPanel
                files={cur.appFiles}
                selectedFile={cur.selectedFile}
                onSelectFile={(file) => updatePerApp(selectedApp.id, { selectedFile: file })}
                onOpenFolder={() => window.deyad.openAppFolder(selectedApp.id)}
                onFileEdit={handleFileEdit}
                autocompleteEnabled={autocompleteEnabled}
                completionModel={completionModel || defaultModel}
              />
            ) : cur.rightTab === 'terminal' ? (
              <TerminalPanel appId={selectedApp.id} />
            ) : cur.rightTab === 'packages' ? (
              <PackageManagerPanel appId={selectedApp.id} />
            ) : cur.rightTab === 'envvars' ? (
              <EnvVarsPanel appId={selectedApp.id} />
            ) : cur.rightTab === 'git' ? (
              <GitPanel
                appId={selectedApp.id}
                onFilesChanged={async () => {
                  const files = await window.deyad.readFiles(selectedApp.id);
                  updatePerApp(selectedApp.id, { appFiles: files });
                }}
              />
            ) : cur.rightTab === 'search' ? (
              <SearchPanel
                appId={selectedApp.id}
                onSelectFile={(file) => updatePerApp(selectedApp.id, { selectedFile: file, rightTab: 'editor' })}
              />
            ) : cur.rightTab === 'database' ? (
              <DatabasePanel app={selectedApp} dbStatus={cur.dbStatus} onDbToggle={() => handleDbToggle(selectedApp.id)} />
            ) : null}
            {/* Keep PreviewPanel mounted so it maintains HMR/WebSocket connection */}
            <div style={{ display: cur.rightTab === 'preview' ? 'contents' : 'none' }}>
              <PreviewPanel app={selectedApp} onPublish={() => setShowDeployModal(true)} refreshKey={previewRefreshKey} />
            </div>
          </>
        )}
      </div>

      {showNewAppModal && (
        <NewAppModal
          onClose={() => setShowNewAppModal(false)}
          onCreate={handleCreateApp}
        />
      )}

      {showSettings && (
        <SettingsModal
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => {
            setShowSettings(false);
            // Reload settings to pick up autocomplete changes
            window.deyad.getSettings().then((s) => {
              setAutocompleteEnabled(s.autocompleteEnabled ?? false);
              setCompletionModel(s.completionModel ?? '');
              setDefaultModel(s.defaultModel ?? '');
              if (s.theme) setTheme(s.theme);
            }).catch((err) => console.warn('getSettings:', err));
          }}
        />
      )}

      {cur.pendingDiffFiles && (
        <DiffModal
          oldFiles={cur.preAgentFiles ?? cur.appFiles}
          newFiles={cur.pendingDiffFiles}
          onApply={handleApplyDiff}
          onReject={handleRejectDiff}
        />
      )}

      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImport={handleImportApp}
        />
      )}

      {showDeployModal && selectedApp && (
        <DeployModal
          appId={selectedApp.id}
          appName={selectedApp.name}
          appType={selectedApp.appType}
          onClose={() => setShowDeployModal(false)}
        />
      )}

      {showVersionHistory && selectedApp && (
        <VersionHistoryPanel
          appId={selectedApp.id}
          onClose={() => setShowVersionHistory(false)}
          onRestore={async () => {
            const files = await window.deyad.readFiles(selectedApp.id);
            updatePerApp(selectedApp.id, { appFiles: files, selectedFile: null });
          }}
        />
      )}

      {showTaskQueue && selectedApp && (
        <TaskQueuePanel
          appId={selectedApp.id}
          appName={selectedApp.name}
          appType={selectedApp.appType}
          dbProvider={selectedApp.dbProvider}
          dbStatus={cur.dbStatus}
          model={defaultModel}
          onClose={() => setShowTaskQueue(false)}
          onRefreshFiles={async () => {
            const files = await window.deyad.readFiles(selectedApp.id);
            updatePerApp(selectedApp.id, { appFiles: files });
          }}
        />
      )}

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        <button
          className={`mobile-nav-btn ${mobilePanel === 'sidebar' ? 'active' : ''}`}
          onClick={() => setMobilePanel('sidebar')}
        >
          <span className="mobile-nav-icon">☰</span>
          <span className="mobile-nav-label">Apps</span>
        </button>
        <button
          className={`mobile-nav-btn ${mobilePanel === 'chat' ? 'active' : ''}`}
          onClick={() => setMobilePanel('chat')}
        >
          <span className="mobile-nav-icon">💬</span>
          <span className="mobile-nav-label">Chat</span>
        </button>
        <button
          className={`mobile-nav-btn ${mobilePanel === 'right' ? 'active' : ''}`}
          onClick={() => setMobilePanel('right')}
        >
          <span className="mobile-nav-icon">📁</span>
          <span className="mobile-nav-label">{cur.rightTab === 'preview' ? 'Preview' : cur.rightTab === 'terminal' ? 'Term' : cur.rightTab === 'database' ? 'DB' : 'Files'}</span>
        </button>
      </nav>

      {showWizard && (
        <WelcomeWizard
          onComplete={() => {
            setShowWizard(false);
            window.deyad.setSettings({ hasCompletedWizard: true }).then((s) => {
              setDefaultModel(s.defaultModel ?? '');
            }).catch((err) => console.warn('setSettings:', err));
          }}
          onCreateApp={() => setShowNewAppModal(true)}
        />
      )}

      <ConfirmDialog
        open={exportConfirm.open}
        title="Export App"
        message="Create a mobile/PWA export or a plain ZIP?"
        confirmLabel="Mobile/PWA"
        cancelLabel="ZIP"
        onConfirm={() => doExport(true)}
        onCancel={() => doExport(false)}
      />

      <ConfirmDialog
        open={!!exportResult}
        title="Export"
        message={exportResult || ''}
        confirmLabel="OK"
        cancelLabel=""
        onConfirm={() => setExportResult(null)}
        onCancel={() => setExportResult(null)}
      />
    </div>
  );
}
