import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import EditorPanel from './components/EditorPanel';
import NewAppModal from './components/NewAppModal';

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  isFullStack: boolean;
}

export default function App() {
  const [apps, setApps] = useState<AppProject[]>([]);
  const [selectedApp, setSelectedApp] = useState<AppProject | null>(null);
  const [appFiles, setAppFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showNewAppModal, setShowNewAppModal] = useState(false);
  const [dbStatus, setDbStatus] = useState<'none' | 'running' | 'stopped'>('none');

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
    const files = await window.deyad.readFiles(app.id);
    setAppFiles(files);

    // Check DB status for full-stack apps
    if (app.isFullStack) {
      const { status } = await window.deyad.dbStatus(app.id);
      setDbStatus(status);
    } else {
      setDbStatus('none');
    }
  }, []);

  const handleFilesUpdated = useCallback(async (newFiles: Record<string, string>) => {
    if (!selectedApp) return;
    await window.deyad.writeFiles(selectedApp.id, newFiles);
    setAppFiles((prev) => ({ ...prev, ...newFiles }));
    // Select the first new file
    const firstKey = Object.keys(newFiles)[0];
    if (firstKey) setSelectedFile(firstKey);
  }, [selectedApp]);

  const handleCreateApp = async (name: string, description: string, isFullStack: boolean) => {
    const app = await window.deyad.createApp(name, description, isFullStack);
    setShowNewAppModal(false);
    await loadApps();

    if (isFullStack) {
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
      });
      await window.deyad.writeFiles(app.id, scaffold);
    }

    await selectApp({ ...app });
  };

  const handleDeleteApp = async (appId: string) => {
    await window.deyad.deleteApp(appId);
    if (selectedApp?.id === appId) {
      setSelectedApp(null);
      setAppFiles({});
      setSelectedFile(null);
    }
    await loadApps();
  };

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

  return (
    <div className="app-layout">
      {/* Left sidebar: app list */}
      <Sidebar
        apps={apps}
        selectedApp={selectedApp}
        onSelectApp={selectApp}
        onNewApp={() => setShowNewAppModal(true)}
        onDeleteApp={handleDeleteApp}
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
          />

          {/* Right: file editor */}
          <EditorPanel
            files={appFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onOpenFolder={() => window.deyad.openAppFolder(selectedApp.id)}
          />
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
    </div>
  );
}
