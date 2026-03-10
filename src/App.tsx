import { useState, useEffect, useCallback } from 'react';
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
import TaskQueuePanel from './components/TaskQueuePanel';
import DiffModal from './components/DiffModal';
import VersionHistoryPanel from './components/VersionHistoryPanel';
import PackageManagerPanel from './components/PackageManagerPanel';
import EnvVarsPanel from './components/EnvVarsPanel';
import { taskQueue } from './lib/taskQueue';

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'mysql' | 'postgresql';
}

type RightTab = 'editor' | 'preview' | 'terminal' | 'database' | 'envvars' | 'packages';

export default function App() {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [appFiles, setAppFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
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
  const [dbStatus, setDbStatus] = useState<'none' | 'running' | 'stopped'>('none');
  const [rightTab, setRightTab] = useState<RightTab>('editor');
  const [canRevert, setCanRevert] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'chat' | 'right'>('chat');
  const [pendingDiffFiles, setPendingDiffFiles] = useState<Record<string, string> | null>(null);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [completionModel, setCompletionModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');

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
    }).catch(() => {});
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

  // persist when sizes change (sidebar & right panel) and update CSS variables
  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem('rightWidth', rightWidth.toString());
    document.documentElement.style.setProperty('--editor-width', `${rightWidth}px`);
  }, [rightWidth]);

  // Subscribe to DB status events
  useEffect(() => {
    const unsub = window.deyad.onDbStatus(({ appId, status }) => {
      if (selectedApp?.id === appId) {
        setDbStatus(status as 'running' | 'stopped');
      }
    });
    return unsub;
  }, [selectedApp]);

  const loadApps = async () => {
    const list = await window.deyad.listApps();
    setApps(list);
  };

  const selectApp = useCallback(async (app: AppProject) => {
    setSelectedApp(app);
    setSelectedFile(null);
    // Always show the file editor when switching apps — the preview iframe always
    // points to localhost:5173 so it could show a stale/different app's preview.
    setRightTab('editor');
    const files = await window.deyad.readFiles(app.id);
    setAppFiles(files);

    // Check undo availability
    const hasSnap = await window.deyad.hasSnapshot(app.id);
    setCanRevert(hasSnap);

    // Check DB status for full-stack apps
    if (app.appType === 'fullstack') {
      const { status } = await window.deyad.dbStatus(app.id);
      setDbStatus(status);
    } else {
      setDbStatus('none');
    }
  }, []);

  const handleFilesUpdated = useCallback(async (newFiles: Record<string, string>) => {
    if (!selectedApp) return;
    // Show diff preview before applying (unless in agent mode which auto-applies)
    setPendingDiffFiles(newFiles);
  }, [selectedApp]);

  const handleApplyDiff = useCallback(async () => {
    if (!selectedApp || !pendingDiffFiles) return;
    await window.deyad.snapshotFiles(selectedApp.id, appFiles);
    await window.deyad.writeFiles(selectedApp.id, pendingDiffFiles);
    setAppFiles((prev) => ({ ...prev, ...pendingDiffFiles }));
    setCanRevert(true);
    const firstKey = Object.keys(pendingDiffFiles)[0];
    if (firstKey) setSelectedFile(firstKey);
    setPendingDiffFiles(null);
  }, [selectedApp, appFiles, pendingDiffFiles]);

  const handleRejectDiff = useCallback(() => {
    setPendingDiffFiles(null);
  }, []);

  const handleFileEdit = useCallback(async (filePath: string, content: string) => {
    if (!selectedApp) return;
    await window.deyad.writeFiles(selectedApp.id, { [filePath]: content });
    setAppFiles((prev) => ({ ...prev, [filePath]: content }));
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


  const handleCreateApp = async (name: string, description: string, appType: 'frontend' | 'fullstack', dbProvider?: 'mysql' | 'postgresql', templatePrompt?: string) => {
    const app = await window.deyad.createApp(name, description, appType, dbProvider);
    setShowNewAppModal(false);
    await loadApps();

    if (appType === 'fullstack') {
      // Write scaffold files with randomly-generated DB credentials
      const { generateFullStackScaffold } = await import('./lib/scaffoldGenerator');
      const { generatePassword } = await import('./lib/crypto');
      const scaffold = generateFullStackScaffold({
        appName: name,
        description,
        dbName: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_db',
        dbUser: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_user',
        dbPassword: generatePassword(24),
        dbRootPassword: generatePassword(24),
        dbProvider: dbProvider ?? 'mysql',
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
    await window.deyad.appDevStop(appId).catch(() => {});
    await window.deyad.deleteApp(appId);
    if (selectedApp?.id === appId) {
      setSelectedApp(null);
      setAppFiles({});
      setSelectedFile(null);
    }
    await loadApps();
  };

  const handleRenameApp = useCallback(async (appId: string, newName: string) => {
    await window.deyad.renameApp(appId, newName);
    setApps((prev) => prev.map((a) => a.id === appId ? { ...a, name: newName } : a));
    if (selectedApp?.id === appId) {
      setSelectedApp((prev) => prev ? { ...prev, name: newName } : prev);
    }
  }, [selectedApp]);

  const handleDbToggle = async () => {
    if (!selectedApp) return;
    if (dbStatus === 'running') {
      const result = await window.deyad.dbStop(selectedApp.id);
      if (result.success) setDbStatus('stopped');
    } else {
      setDbStatus('stopped'); // optimistic
      const result = await window.deyad.dbStart(selectedApp.id);
      if (result.success) {
        setDbStatus('running');
      } else {
        alert(`Failed to start database:\n${result.error}`);
      }
    }
  };

  const handleRevert = async () => {
    if (!selectedApp) return;
    const result = await window.deyad.revertFiles(selectedApp.id);
    if (result.success) {
      const files = await window.deyad.readFiles(selectedApp.id);
      setAppFiles(files);
      setSelectedFile(null);
      setCanRevert(false);
    }
  };

  const handleExportApp = async (appId: string) => {
    // ask user whether they want a mobile/PWA export or a plain zip
    const useMobile = window.confirm('Create mobile/PWA export? Press OK for mobile, Cancel for ZIP.');
    const result = await window.deyad.exportApp(appId, useMobile ? 'mobile' : 'zip');
    if (result.success && result.path) {
      if (typeof alert === 'function') {
        alert(`${useMobile ? 'Mobile export created at' : 'Exported to'} ${result.path}`);
      }
    } else if (!result.success && result.error !== 'Cancelled') {
      if (typeof alert === 'function') {
        alert(`Export failed: ${result.error}`);
      }
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

      {/* centre: chat or empty state */}
      {selectedApp ? (
        <div className="chat-wrapper">
          <ChatPanel
            app={selectedApp}
            appFiles={appFiles}
            selectedFile={selectedFile}
            dbStatus={dbStatus}
            onFilesUpdated={handleFilesUpdated}
            onDbToggle={handleDbToggle}
            onRevert={handleRevert}
            canRevert={canRevert}
            initialPrompt={pendingPrompt}
            onInitialPromptConsumed={() => setPendingPrompt(null)}
          />
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
                className={`right-tab ${rightTab === 'editor' ? 'active' : ''}`}
                onClick={() => setRightTab('editor')}
              >
                Files
              </button>
              <button
                className={`right-tab ${rightTab === 'preview' ? 'active' : ''}`}
                onClick={() => setRightTab('preview')}
              >
                Preview
              </button>
              <button
                className={`right-tab ${rightTab === 'terminal' ? 'active' : ''}`}
                onClick={() => setRightTab('terminal')}
              >
                Terminal
              </button>
              <button
                className={`right-tab ${rightTab === 'packages' ? 'active' : ''}`}
                onClick={() => setRightTab('packages')}
              >
                Packages
              </button>
              <button
                className={`right-tab ${rightTab === 'envvars' ? 'active' : ''}`}
                onClick={() => setRightTab('envvars')}
              >
                Env
              </button>
              {selectedApp?.appType === 'fullstack' && (
                <button
                  className={`right-tab ${rightTab === 'database' ? 'active' : ''}`}
                  onClick={() => setRightTab('database')}
                >
                  Database
                </button>
              )}
            </div>

            {rightTab === 'editor' ? (
              <EditorPanel
                files={appFiles}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                onOpenFolder={() => window.deyad.openAppFolder(selectedApp.id)}
                onFileEdit={handleFileEdit}
                autocompleteEnabled={autocompleteEnabled}
                completionModel={completionModel || defaultModel}
              />
            ) : rightTab === 'preview' ? (
              <PreviewPanel app={selectedApp} />
            ) : rightTab === 'terminal' ? (
              <TerminalPanel appId={selectedApp.id} />
            ) : rightTab === 'packages' ? (
              <PackageManagerPanel appId={selectedApp.id} />
            ) : rightTab === 'envvars' ? (
              <EnvVarsPanel appId={selectedApp.id} />
            ) : rightTab === 'database' ? (
              <DatabasePanel app={selectedApp} />
            ) : null}
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
        <SettingsModal onClose={() => {
          setShowSettings(false);
          // Reload settings to pick up autocomplete changes
          window.deyad.getSettings().then((s) => {
            setAutocompleteEnabled(s.autocompleteEnabled ?? false);
            setCompletionModel(s.completionModel ?? '');
            setDefaultModel(s.defaultModel ?? '');
          }).catch(() => {});
        }} />
      )}

      {pendingDiffFiles && (
        <DiffModal
          oldFiles={appFiles}
          newFiles={pendingDiffFiles}
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
            setAppFiles(files);
            setSelectedFile(null);
          }}
        />
      )}

      {showTaskQueue && selectedApp && (
        <TaskQueuePanel
          appId={selectedApp.id}
          appName={selectedApp.name}
          appType={selectedApp.appType}
          dbProvider={selectedApp.dbProvider}
          dbStatus={dbStatus}
          model=""
          onClose={() => setShowTaskQueue(false)}
          onRefreshFiles={async () => {
            const files = await window.deyad.readFiles(selectedApp.id);
            setAppFiles(files);
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
          <span className="mobile-nav-label">{rightTab === 'preview' ? 'Preview' : rightTab === 'terminal' ? 'Term' : rightTab === 'database' ? 'DB' : 'Files'}</span>
        </button>
      </nav>
    </div>
  );
}
