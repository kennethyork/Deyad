import { useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import ConfirmDialog from './components/ConfirmDialog';
import CommandPalette from './components/CommandPalette';
import type { Command } from './components/CommandPalette';
import { ToastProvider, useToast } from './components/ToastContainer';
import { taskQueue } from './lib/taskQueue';
import { useAppReducer, defaultPerAppState } from './hooks/useAppReducer';
import type { PerAppState } from './hooks/useAppReducer';
import { useModals } from './hooks/useModals';
import { useLayout } from './hooks/useLayout';
import { useSettings } from './hooks/useSettings';

// Lazy-loaded heavy components (Monaco editor, xterm.js, etc.)
const EditorPanel = lazy(() => import('./components/EditorPanel'));
const PreviewPanel = lazy(() => import('./components/PreviewPanel'));
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));
const DatabasePanel = lazy(() => import('./components/DatabasePanel'));
const NewAppModal = lazy(() => import('./components/NewAppModal'));
const ImportModal = lazy(() => import('./components/ImportModal'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const DeployModal = lazy(() => import('./components/DeployModal'));
const WelcomeWizard = lazy(() => import('./components/WelcomeWizard'));
const TaskQueuePanel = lazy(() => import('./components/TaskQueuePanel'));
const DiffModal = lazy(() => import('./components/DiffModal'));
const VersionHistoryPanel = lazy(() => import('./components/VersionHistoryPanel'));
const PackageManagerPanel = lazy(() => import('./components/PackageManagerPanel'));
const EnvVarsPanel = lazy(() => import('./components/EnvVarsPanel'));
const GitPanel = lazy(() => import('./components/GitPanel'));
const SearchPanel = lazy(() => import('./components/SearchPanel'));

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'sqlite';
  /** Host port for Prisma Studio (the DB viewer GUI, unique per app). */
  guiPort?: number;
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const { addToast } = useToast();

  // ── State: core app state via useReducer ──
  const { state, dispatch, perAppRef, updatePerApp, cur } = useAppReducer();
  const { apps, selectedApp, perApp, openedApps, previewRefreshKey, pendingPrompt, activeTasks } = state;

  // ── State: modals ──
  const modals = useModals();

  // ── State: layout (sidebar/right widths, mobile panel) ──
  const layout = useLayout();

  // ── State: settings (theme, autocomplete, models) ──
  const settings = useSettings();

  // Load app list on mount
  useEffect(() => {
    loadApps();
    settings.loadSettings().then((s) => {
      if (s && !s.hasCompletedWizard) modals.setShowWizard(true);
    });
  }, []);

  // Subscribe to task queue changes for activity badge
  useEffect(() => {
    const unsub = taskQueue.subscribe(() => {
      const active = taskQueue.getAll().filter((t) => t.status === 'running' || t.status === 'queued');
      dispatch({ type: 'SET_ACTIVE_TASKS', count: active.length });
    });
    dispatch({
      type: 'SET_ACTIVE_TASKS',
      count: taskQueue.getAll().filter((t) => t.status === 'running' || t.status === 'queued').length,
    });
    return unsub;
  }, []);

  // Auto-refresh file tree when a background task completes (any app)
  useEffect(() => {
    taskQueue.setOnFilesChanged(async (appId) => {
      const files = await window.deyad.readFiles(appId);
      updatePerApp(appId, { appFiles: files });
      dispatch({ type: 'REFRESH_PREVIEW' });
    });
    return () => taskQueue.setOnFilesChanged(null);
  }, [updatePerApp]);

  // Command palette & search keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        modals.setShowCommandPalette((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (selectedApp) {
          updatePerApp(selectedApp.id, { rightTab: 'search' });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedApp]);

  // Subscribe to DB status events (any app)
  useEffect(() => {
    const unsub = window.deyad.onDbStatus(({ appId, status }) => {
      // Only update if we have per-app state for this app
      if (perAppRef.current[appId]) {
        updatePerApp(appId, { dbStatus: status as 'running' | 'stopped' });
      }
    });
    return unsub;
  }, []);

  // global context menu support
  useEffect(() => {
    const handleContext = (e: MouseEvent) => {
      e.preventDefault();
      const el = e.target as HTMLElement;
      if (!el.closest('.terminal-panel')) {
        window.deyad.showContextMenu('global');
      }
    };
    window.addEventListener('contextmenu', handleContext);
    return () => window.removeEventListener('contextmenu', handleContext);
  }, []);

  const loadApps = async () => {
    try {
      const list = await window.deyad.listApps();
      dispatch({ type: 'SET_APPS', apps: list });
    } catch (err) {
      console.error('Failed to load apps:', err);
    }
  };

  const selectApp = useCallback(async (app: AppProject) => {
    dispatch({ type: 'SELECT_APP', app });
    dispatch({ type: 'OPEN_APP', appId: app.id });

    try {
      const files = await window.deyad.readFiles(app.id);
      const hasSnap = await window.deyad.hasSnapshot(app.id);

      let dbSt: 'none' | 'running' | 'stopped' = 'none';
      if (app.appType === 'fullstack') {
        const result = await window.deyad.dbStatus(app.id);
        dbSt = result.status as 'none' | 'running' | 'stopped';
      }

      updatePerApp(app.id, { appFiles: files, canRevert: hasSnap, dbStatus: dbSt });
    } catch (err) {
      console.error('Failed to load app:', err);
      dispatch({ type: 'SELECT_APP', app: null });
    }
  }, [updatePerApp]);

  const handleFilesUpdated = useCallback((appId: string, newFiles: Record<string, string>) => {
    const s = perAppRef.current[appId] ?? defaultPerAppState;
    const newPending = s.pendingDiffFiles
      ? { ...s.pendingDiffFiles, ...newFiles }
      : newFiles;
    const newPreAgent = s.pendingDiffFiles
      ? s.preAgentFiles
      : { ...s.appFiles };
    updatePerApp(appId, { pendingDiffFiles: newPending, preAgentFiles: newPreAgent });
    dispatch({ type: 'REFRESH_PREVIEW' });
  }, [updatePerApp]);

  const handleApplyDiff = useCallback(async () => {
    if (!selectedApp) return;
    const appId = selectedApp.id;
    const s = perAppRef.current[appId] ?? defaultPerAppState;
    if (!s.pendingDiffFiles) return;

    if (s.preAgentFiles) {
      await window.deyad.snapshotFiles(appId, s.preAgentFiles);
    }
    await window.deyad.writeFiles(appId, s.pendingDiffFiles);
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
    dispatch({ type: 'REFRESH_PREVIEW' });
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
    const newFilePaths: string[] = [];
    for (const filePath of Object.keys(s.pendingDiffFiles)) {
      if (filePath in s.preAgentFiles) {
        revertMap[filePath] = s.preAgentFiles[filePath];
      } else {
        newFilePaths.push(filePath);
      }
    }
    if (Object.keys(revertMap).length > 0) {
      await window.deyad.writeFiles(appId, revertMap);
    }
    if (newFilePaths.length > 0) {
      await window.deyad.deleteFiles(appId, newFilePaths);
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
    updatePerApp(appId, { appFiles: { ...(perAppRef.current[appId]?.appFiles ?? {}), [filePath]: content } });
    dispatch({ type: 'REFRESH_PREVIEW' });
  }, [selectedApp, updatePerApp]);

  const handleCreateApp = async (name: string, description: string, appType: 'frontend' | 'fullstack', templatePrompt?: string) => {
    const app = await window.deyad.createApp(name, description, appType, 'sqlite');
    modals.setShowNewAppModal(false);
    await loadApps();

    if (appType === 'fullstack') {
      const { generateFullStackScaffold } = await import('./lib/scaffoldGenerator');
      const scaffold = generateFullStackScaffold({ appName: name, description, guiPort: app.guiPort });
      await window.deyad.writeFiles(app.id, scaffold);
    } else {
      const { generateFrontendScaffold } = await import('./lib/scaffoldGenerator');
      const scaffold = generateFrontendScaffold({ appName: name, description });
      await window.deyad.writeFiles(app.id, scaffold);
    }

    if (templatePrompt) {
      dispatch({ type: 'SET_PENDING_PROMPT', prompt: templatePrompt });
    }

    await selectApp({ ...app });
    addToast('success', `Created ${appType} app "${name}"`);
  };

  const handleImportApp = async (name: string) => {
    modals.setShowImportModal(false);
    try {
      const app = await window.deyad.importApp(name);
      if (app) {
        await loadApps();
        await selectApp(app);
        addToast('success', `Imported "${name}"`);
      }
    } catch (err) {
      console.error('Import failed:', err);
      addToast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteApp = async (appId: string) => {
    await window.deyad.appDevStop(appId).catch((err) => console.warn('appDevStop:', err));
    await window.deyad.deleteApp(appId);
    dispatch({ type: 'DELETE_APP_STATE', appId });
    await loadApps();
    addToast('success', 'App deleted');
  };

  const handleRenameApp = useCallback(async (appId: string, newName: string) => {
    await window.deyad.renameApp(appId, newName);
    dispatch({ type: 'RENAME_APP', appId, newName });
    addToast('success', `Renamed to "${newName}"`);
  }, []);

  const handleDuplicateApp = async (appId: string) => {
    const app = await window.deyad.duplicateApp(appId);
    if (app) {
      await loadApps();
      await selectApp(app as AppProject);
      addToast('success', 'App duplicated');
    }
  };

  const dbToggling = useRef<Set<string>>(new Set());
  const handleDbToggle = useCallback(async (appId: string) => {
    if (dbToggling.current.has(appId)) return;
    dbToggling.current.add(appId);
    try {
      const s = perAppRef.current[appId] ?? defaultPerAppState;
      if (s.dbStatus === 'running') {
        updatePerApp(appId, { dbStatus: 'stopped' });
        const result = await window.deyad.dbStop(appId);
        if (!result.success) updatePerApp(appId, { dbStatus: 'running' });
        else addToast('info', 'Database stopped');
      } else {
        const prevStatus = s.dbStatus;
        updatePerApp(appId, { dbStatus: 'stopped' });
        const result = await window.deyad.dbStart(appId);
        if (result.success) {
          updatePerApp(appId, { dbStatus: 'running' });
          addToast('success', 'Database started');
        } else {
          updatePerApp(appId, { dbStatus: prevStatus });
          addToast('error', `Failed to start database: ${result.error}`);
        }
      }
    } finally {
      dbToggling.current.delete(appId);
    }
  }, [updatePerApp]);

  const handleRevert = useCallback(async (appId: string) => {
    const result = await window.deyad.revertFiles(appId);
    if (result.success) {
      const files = await window.deyad.readFiles(appId);
      updatePerApp(appId, { appFiles: files, selectedFile: null, canRevert: false });
      dispatch({ type: 'REFRESH_PREVIEW' });
      addToast('success', 'Changes reverted');
    }
  }, [updatePerApp]);

  const handleExportApp = async (appId: string) => {
    modals.setExportConfirm({ open: true, appId });
  };

  const doExport = async (mobile: boolean) => {
    const appId = modals.exportConfirm.appId;
    modals.setExportConfirm({ open: false, appId: '' });
    const result = await window.deyad.exportApp(appId, mobile ? 'mobile' : 'zip');
    if (result.success && result.path) {
      modals.setExportResult(`${mobile ? 'Mobile export created at' : 'Exported to'} ${result.path}`);
      addToast('success', mobile ? 'Mobile export created' : 'Exported as ZIP');
    } else if (!result.success && result.error !== 'Cancelled') {
      modals.setExportResult(`Export failed: ${result.error}`);
      addToast('error', `Export failed: ${result.error}`);
    }
  };

  const paletteCommands: Command[] = [
    { id: 'app.new', name: 'New App', icon: '➕', shortcut: 'Ctrl+N', run: () => modals.setShowNewAppModal(true) },
    { id: 'app.import', name: 'Import Project', icon: '📂', run: () => modals.setShowImportModal(true) },
    { id: 'settings', name: 'Settings', icon: '⚙️', run: () => modals.setShowSettings(true) },
    ...(selectedApp ? [
      { id: 'deploy', name: 'Deploy App', icon: '🚀', run: () => modals.setShowDeployModal(true) },
      { id: 'history', name: 'Version History', icon: '🕐', run: () => modals.setShowVersionHistory(true) },
      { id: 'tasks', name: 'Task Queue', icon: '📋', run: () => modals.setShowTaskQueue(true) },
      { id: 'tab.editor', name: 'Show Editor', icon: '✏️', run: () => updatePerApp(selectedApp.id, { rightTab: 'editor' }) },
      { id: 'tab.preview', name: 'Show Preview', icon: '👁️', run: () => updatePerApp(selectedApp.id, { rightTab: 'preview' }) },
      { id: 'tab.terminal', name: 'Show Terminal', icon: '💻', run: () => updatePerApp(selectedApp.id, { rightTab: 'terminal' }) },
      { id: 'tab.database', name: 'Show Database', icon: '🗄️', run: () => updatePerApp(selectedApp.id, { rightTab: 'database' }) },
      { id: 'tab.packages', name: 'Show Packages', icon: '📦', run: () => updatePerApp(selectedApp.id, { rightTab: 'packages' }) },
      { id: 'tab.git', name: 'Show Git', icon: '🔀', run: () => updatePerApp(selectedApp.id, { rightTab: 'git' }) },
      { id: 'tab.search', name: 'Search Files', icon: '🔍', shortcut: 'Ctrl+Shift+F', run: () => updatePerApp(selectedApp.id, { rightTab: 'search' }) },
      { id: 'tab.env', name: 'Environment Variables', icon: '🔑', run: () => updatePerApp(selectedApp.id, { rightTab: 'envvars' }) },
      { id: 'app.folder', name: 'Open in File Manager', icon: '📁', run: () => { window.deyad.openAppFolder(selectedApp.id); } },
    ] : []),
  ];

  return (
    <Suspense fallback={<div className="app-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8' }}>Loading…</div>}>
    <a href="#main-content" className="skip-to-content">Skip to content</a>
    <div
      className={`app-layout mobile-show-${layout.mobilePanel}`}
      style={{
        gridTemplateColumns: `${layout.sidebarWidth}px 4px 1fr 4px ${layout.rightWidth}px`,
      }}
    >
      {/* sidebar */}
      <aside className={`sidebar ${layout.sidebarVisible ? '' : 'hidden'}`}>
        <Sidebar
          apps={apps}
          selectedApp={selectedApp}
          onSelectApp={selectApp}
          onNewApp={() => modals.setShowNewAppModal(true)}
          onDeleteApp={handleDeleteApp}
          onRenameApp={handleRenameApp}
          onDuplicateApp={handleDuplicateApp}
          onExportApp={handleExportApp}
          onDeployApp={() => modals.setShowDeployModal(true)}
          onImportApp={() => modals.setShowImportModal(true)}
          onOpenSettings={() => modals.setShowSettings(true)}
          onOpenTaskQueue={() => modals.setShowTaskQueue(true)}
          onOpenVersionHistory={() => modals.setShowVersionHistory(true)}
          activeTasks={activeTasks}
        />
      </aside>

      {/* menu button for narrow screens (hidden while modals open) */}
      {!(modals.showNewAppModal || modals.showSettings || modals.showImportModal) && (
        <button
          className="btn-toggle-sidebar"
          onClick={() => layout.setSidebarVisible((v) => !v)}
          title="Toggle sidebar"
        >
          ☰
        </button>
      )}
      {/* resizer between sidebar and centre */}
      <div
        className="resizer"
        data-side="sidebar"
        onMouseDown={(e) => layout.startDrag('sidebar', e.clientX)}
      />

      {/* centre: chat panels (kept alive across app switches) or empty state */}
      {selectedApp ? (
        <div id="main-content" className="chat-wrapper">
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
                  onInitialPromptConsumed={() => dispatch({ type: 'SET_PENDING_PROMPT', prompt: null })}
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
            <button className="btn-primary" onClick={() => modals.setShowNewAppModal(true)}>
              + New App
            </button>
          </div>
        </div>
      )}

      {/* resizer between centre and right (always present) */}
      <div
        className="resizer"
        data-side="right"
        onMouseDown={(e) => layout.startDrag('right', e.clientX)}
      />

      {/* right panel (always present so widths are always measurable) */}
      <div className="right-panel">
        {selectedApp && (
          <>
            <div className="right-panel-tabs" role="tablist" aria-label="Right panel tabs">
              <button
                role="tab"
                aria-selected={cur.rightTab === 'editor'}
                aria-controls="tabpanel-editor"
                id="tab-editor"
                className={`right-tab ${cur.rightTab === 'editor' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'editor' })}
              >
                Files
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'preview'}
                aria-controls="tabpanel-preview"
                id="tab-preview"
                className={`right-tab ${cur.rightTab === 'preview' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'preview' })}
              >
                Preview
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'terminal'}
                aria-controls="tabpanel-terminal"
                id="tab-terminal"
                className={`right-tab ${cur.rightTab === 'terminal' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'terminal' })}
              >
                Terminal
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'packages'}
                aria-controls="tabpanel-packages"
                id="tab-packages"
                className={`right-tab ${cur.rightTab === 'packages' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'packages' })}
              >
                Packages
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'envvars'}
                aria-controls="tabpanel-envvars"
                id="tab-envvars"
                className={`right-tab ${cur.rightTab === 'envvars' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'envvars' })}
              >
                Env
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'search'}
                aria-controls="tabpanel-search"
                id="tab-search"
                className={`right-tab ${cur.rightTab === 'search' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'search' })}
              >
                Search
              </button>
              <button
                role="tab"
                aria-selected={cur.rightTab === 'git'}
                aria-controls="tabpanel-git"
                id="tab-git"
                className={`right-tab ${cur.rightTab === 'git' ? 'active' : ''}`}
                onClick={() => updatePerApp(selectedApp.id, { rightTab: 'git' })}
              >
                Git
              </button>
              {selectedApp?.appType === 'fullstack' && (
                <button
                  role="tab"
                  aria-selected={cur.rightTab === 'database'}
                  aria-controls="tabpanel-database"
                  id="tab-database"
                  className={`right-tab ${cur.rightTab === 'database' ? 'active' : ''}`}
                  onClick={() => updatePerApp(selectedApp.id, { rightTab: 'database' })}
                >
                  Database
                </button>
              )}
            </div>

            {cur.rightTab === 'editor' ? (
              <div role="tabpanel" id="tabpanel-editor" aria-labelledby="tab-editor" style={{ display: 'contents' }}>
              <EditorPanel
                files={cur.appFiles}
                selectedFile={cur.selectedFile}
                onSelectFile={(file) => updatePerApp(selectedApp.id, { selectedFile: file })}
                onOpenFolder={() => window.deyad.openAppFolder(selectedApp.id)}
                onFileEdit={handleFileEdit}
                autocompleteEnabled={settings.autocompleteEnabled}
                completionModel={settings.completionModel || settings.defaultModel}
              />
              </div>
            ) : cur.rightTab === 'terminal' ? (
              <div role="tabpanel" id="tabpanel-terminal" aria-labelledby="tab-terminal" style={{ display: 'contents' }}>
              <TerminalPanel appId={selectedApp.id} />
              </div>
            ) : cur.rightTab === 'packages' ? (
              <div role="tabpanel" id="tabpanel-packages" aria-labelledby="tab-packages" style={{ display: 'contents' }}>
              <PackageManagerPanel appId={selectedApp.id} />
              </div>
            ) : cur.rightTab === 'envvars' ? (
              <div role="tabpanel" id="tabpanel-envvars" aria-labelledby="tab-envvars" style={{ display: 'contents' }}>
              <EnvVarsPanel appId={selectedApp.id} />
              </div>
            ) : cur.rightTab === 'git' ? (
              <div role="tabpanel" id="tabpanel-git" aria-labelledby="tab-git" style={{ display: 'contents' }}>
              <GitPanel
                appId={selectedApp.id}
                onFilesChanged={async () => {
                  const files = await window.deyad.readFiles(selectedApp.id);
                  updatePerApp(selectedApp.id, { appFiles: files });
                  dispatch({ type: 'REFRESH_PREVIEW' });
                }}
              />
              </div>
            ) : cur.rightTab === 'search' ? (
              <div role="tabpanel" id="tabpanel-search" aria-labelledby="tab-search" style={{ display: 'contents' }}>
              <SearchPanel
                appId={selectedApp.id}
                onSelectFile={(file) => updatePerApp(selectedApp.id, { selectedFile: file, rightTab: 'editor' })}
              />
              </div>
            ) : cur.rightTab === 'database' ? (
              <div role="tabpanel" id="tabpanel-database" aria-labelledby="tab-database" style={{ display: 'contents' }}>
              <DatabasePanel app={selectedApp} dbStatus={cur.dbStatus} onDbToggle={() => handleDbToggle(selectedApp.id)} />
              </div>
            ) : null}
            {/* Keep PreviewPanel mounted so it maintains HMR/WebSocket connection */}
            <div role="tabpanel" id="tabpanel-preview" aria-labelledby="tab-preview" style={{ display: cur.rightTab === 'preview' ? 'contents' : 'none' }}>
              <PreviewPanel app={selectedApp} onPublish={() => modals.setShowDeployModal(true)} refreshKey={previewRefreshKey} />
            </div>
          </>
        )}
      </div>

      {modals.showNewAppModal && (
        <NewAppModal
          onClose={() => modals.setShowNewAppModal(false)}
          onCreate={handleCreateApp}
        />
      )}

      {modals.showSettings && (
        <SettingsModal
          theme={settings.theme}
          onThemeChange={settings.setTheme}
          onClose={() => {
            modals.setShowSettings(false);
            settings.loadSettings();
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

      {modals.showImportModal && (
        <ImportModal
          onClose={() => modals.setShowImportModal(false)}
          onImport={handleImportApp}
        />
      )}

      {modals.showDeployModal && selectedApp && (
        <DeployModal
          appId={selectedApp.id}
          appName={selectedApp.name}
          appType={selectedApp.appType}
          onClose={() => modals.setShowDeployModal(false)}
        />
      )}

      {modals.showVersionHistory && selectedApp && (
        <VersionHistoryPanel
          appId={selectedApp.id}
          onClose={() => modals.setShowVersionHistory(false)}
          onRestore={async () => {
            const files = await window.deyad.readFiles(selectedApp.id);
            updatePerApp(selectedApp.id, { appFiles: files, selectedFile: null });
          }}
        />
      )}

      {modals.showTaskQueue && selectedApp && (
        <TaskQueuePanel
          appId={selectedApp.id}
          appName={selectedApp.name}
          appType={selectedApp.appType}
          dbProvider={selectedApp.dbProvider}
          dbStatus={cur.dbStatus}
          model={settings.defaultModel}
          onClose={() => modals.setShowTaskQueue(false)}
          onRefreshFiles={async () => {
            const files = await window.deyad.readFiles(selectedApp.id);
            updatePerApp(selectedApp.id, { appFiles: files });
          }}
        />
      )}

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        <button
          className={`mobile-nav-btn ${layout.mobilePanel === 'sidebar' ? 'active' : ''}`}
          onClick={() => layout.setMobilePanel('sidebar')}
        >
          <span className="mobile-nav-icon">☰</span>
          <span className="mobile-nav-label">Apps</span>
        </button>
        <button
          className={`mobile-nav-btn ${layout.mobilePanel === 'chat' ? 'active' : ''}`}
          onClick={() => layout.setMobilePanel('chat')}
        >
          <span className="mobile-nav-icon">💬</span>
          <span className="mobile-nav-label">Chat</span>
        </button>
        <button
          className={`mobile-nav-btn ${layout.mobilePanel === 'right' ? 'active' : ''}`}
          onClick={() => layout.setMobilePanel('right')}
        >
          <span className="mobile-nav-icon">📁</span>
          <span className="mobile-nav-label">{cur.rightTab === 'preview' ? 'Preview' : cur.rightTab === 'terminal' ? 'Term' : cur.rightTab === 'database' ? 'DB' : 'Files'}</span>
        </button>
      </nav>

      {modals.showWizard && (
        <WelcomeWizard
          onComplete={() => {
            modals.setShowWizard(false);
            window.deyad.setSettings({ hasCompletedWizard: true }).then((s) => {
              settings.setDefaultModel(s.defaultModel ?? '');
            }).catch((err) => console.warn('setSettings:', err));
          }}
          onCreateApp={() => modals.setShowNewAppModal(true)}
        />
      )}

      <ConfirmDialog
        open={modals.exportConfirm.open}
        title="Export App"
        message="Create a mobile/PWA export or a plain ZIP?"
        confirmLabel="Mobile/PWA"
        cancelLabel="ZIP"
        onConfirm={() => doExport(true)}
        onCancel={() => doExport(false)}
      />

      <ConfirmDialog
        open={!!modals.exportResult}
        title="Export"
        message={modals.exportResult || ''}
        confirmLabel="OK"
        cancelLabel=""
        onConfirm={() => modals.setExportResult(null)}
        onCancel={() => modals.setExportResult(null)}
      />

      {modals.showCommandPalette && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => modals.setShowCommandPalette(false)}
        />
      )}
    </div>
    </Suspense>
  );
}
