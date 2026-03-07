import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import EditorPanel from './components/EditorPanel';
import PreviewPanel from './components/PreviewPanel';
import NewAppModal from './components/NewAppModal';
import SettingsModal from './components/SettingsModal';

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: 'frontend' | 'fullstack';
  dbProvider?: 'mysql' | 'postgresql';
}

type RightTab = 'editor' | 'preview';

export default function App() {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [appFiles, setAppFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showNewAppModal, setShowNewAppModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dbStatus, setDbStatus] = useState<'none' | 'running' | 'stopped'>('none');
  const [rightTab, setRightTab] = useState<RightTab>('editor');
  const [canRevert, setCanRevert] = useState(false);

  // Load app list on mount
  useEffect(() => {
    loadApps();
  }, []);

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
    // Snapshot current files before AI overwrites them (for undo)
    await window.deyad.snapshotFiles(selectedApp.id, appFiles);
    await window.deyad.writeFiles(selectedApp.id, newFiles);
    setAppFiles((prev) => ({ ...prev, ...newFiles }));
    setCanRevert(true);
    // Select the first new file
    const firstKey = Object.keys(newFiles)[0];
    if (firstKey) setSelectedFile(firstKey);
  }, [selectedApp, appFiles]);

  const handleFileEdit = useCallback(async (filePath: string, content: string) => {
    if (!selectedApp) return;
    await window.deyad.writeFiles(selectedApp.id, { [filePath]: content });
    setAppFiles((prev) => ({ ...prev, [filePath]: content }));
  }, [selectedApp]);

  const handleCreateApp = async (name: string, description: string, appType: 'frontend' | 'fullstack', dbProvider?: 'mysql' | 'postgresql') => {
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

    await selectApp({ ...app });
  };

  const handleImportApp = async () => {
    const name = prompt('Name for the imported project:');
    if (!name?.trim()) return;
    const app = await window.deyad.importApp(name.trim());
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
    const result = await window.deyad.exportApp(appId);
    if (!result.success && result.error !== 'Cancelled') {
      alert(`Export failed: ${result.error}`);
    }
  };

  return (
    <div className="app-layout">
      {/* Left sidebar: app list */}
      <Sidebar
        apps={apps}
        selectedApp={selectedApp}
        onSelectApp={selectApp}
        onNewApp={() => setShowNewAppModal(true)}
        onDeleteApp={handleDeleteApp}
        onRenameApp={handleRenameApp}
        onExportApp={handleExportApp}
        onImportApp={handleImportApp}
        onOpenSettings={() => setShowSettings(true)}
      />

      {selectedApp ? (
        <>
          {/* Centre: chat */}
          <ChatPanel
            app={selectedApp}
            appFiles={appFiles}
            dbStatus={dbStatus}
            onFilesUpdated={handleFilesUpdated}
            onDbToggle={handleDbToggle}
            onRevert={handleRevert}
            canRevert={canRevert}
          />

          {/* Right: file editor + preview tabs */}
          <div className="right-panel">
            <div className="right-panel-tabs">
              <button
                className={`right-tab ${rightTab === 'editor' ? 'active' : ''}`}
                onClick={() => setRightTab('editor')}
              >
                📁 Files
              </button>
              <button
                className={`right-tab ${rightTab === 'preview' ? 'active' : ''}`}
                onClick={() => setRightTab('preview')}
              >
                👁 Preview
              </button>
            </div>

            {rightTab === 'editor' ? (
              <EditorPanel
                files={appFiles}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                onOpenFolder={() => window.deyad.openAppFolder(selectedApp.id)}
                onFileEdit={handleFileEdit}
              />
            ) : (
              <PreviewPanel app={selectedApp} />
            )}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-state-content">
            <div className="empty-logo">🤖</div>
            <h2>Welcome to Deyad</h2>
            <p>A local AI app builder powered exclusively by Ollama.</p>
            <p className="empty-hint">Create a new app to get started →</p>
            <button className="btn-primary" onClick={() => setShowNewAppModal(true)}>
              + New App
            </button>
          </div>
        </div>
      )}

      {showNewAppModal && (
        <NewAppModal
          onClose={() => setShowNewAppModal(false)}
          onCreate={handleCreateApp}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
