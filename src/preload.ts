// Preload — exposes safe IPC bridges to the renderer (contextIsolation: true)
import { contextBridge, ipcRenderer } from 'electron';
import type { PluginManifest } from './types/deyad';

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type DbProvider = 'postgresql';
export type AppType = 'frontend' | 'fullstack';

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: AppType;
  dbProvider?: DbProvider;
}

export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
}

contextBridge.exposeInMainWorld('deyad', {
  // ── Ollama ──────────────────────────────────────────────────────────────
  listModels: (): Promise<{ models: OllamaModel[] }> =>
    ipcRenderer.invoke('ollama:list-models'),

  chatStream: (model: string, messages: ChatMessage[], requestId: string): Promise<void> =>
    ipcRenderer.invoke('ollama:chat-stream', { model, messages, requestId }),

  fimComplete: (model: string, prompt: string, suffix?: string, stop?: string[]): Promise<string> =>
    ipcRenderer.invoke('ollama:fim-complete', { model, prompt, suffix, stop }),

  embed: (model: string, input: string | string[]): Promise<{ embeddings: number[][] }> =>
    ipcRenderer.invoke('ollama:embed', { model, input }),

  onStreamToken: (requestId: string, cb: (token: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, rid: string, token: string) => {
      if (rid === requestId) cb(token);
    };
    ipcRenderer.on('ollama:stream-token', handler);
    return () => ipcRenderer.removeListener('ollama:stream-token', handler);
  },

  onStreamDone: (requestId: string, cb: () => void) => {
    const handler = (_: Electron.IpcRendererEvent, rid: string) => {
      if (rid === requestId) {
        ipcRenderer.removeListener('ollama:stream-done', handler);
        cb();
      }
    };
    ipcRenderer.on('ollama:stream-done', handler);
    return () => ipcRenderer.removeListener('ollama:stream-done', handler);
  },

  onStreamError: (requestId: string, cb: (err: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, rid: string, err: string) => {
      if (rid === requestId) {
        ipcRenderer.removeListener('ollama:stream-error', handler);
        cb(err);
      }
    };
    ipcRenderer.on('ollama:stream-error', handler);
    return () => ipcRenderer.removeListener('ollama:stream-error', handler);
  },

  // ── App Projects ────────────────────────────────────────────────────────
  listApps: (): Promise<AppProject[]> =>
    ipcRenderer.invoke('apps:list'),

  createApp: (name: string, description: string, appType: AppType, dbProvider?: DbProvider): Promise<AppProject> =>
    ipcRenderer.invoke('apps:create', { name, description, appType, dbProvider }),

  readFiles: (appId: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke('apps:read-files', appId),

  writeFiles: (appId: string, files: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke('apps:write-files', { appId, files }),

  deleteApp: (appId: string): Promise<boolean> =>
    ipcRenderer.invoke('apps:delete', appId),

  getAppDir: (appId: string): Promise<string> =>
    ipcRenderer.invoke('apps:get-dir', appId),

  openAppFolder: (appId: string): Promise<boolean> =>
    ipcRenderer.invoke('apps:open-folder', appId),

  renameApp: (appId: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke('apps:rename', { appId, newName }),

  saveMessages: (appId: string, messages: UiMessage[]): Promise<boolean> =>
    ipcRenderer.invoke('apps:save-messages', { appId, messages }),

  loadMessages: (appId: string): Promise<UiMessage[]> =>
    ipcRenderer.invoke('apps:load-messages', appId),

  // ── Dev Server (Preview) ────────────────────────────────────────────────
  appDevStart: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:dev-start', appId),

  appDevStop: (appId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('apps:dev-stop', appId),

  appDevStatus: (appId: string): Promise<{ status: 'running' | 'starting' | 'stopped' }> =>
    ipcRenderer.invoke('apps:dev-status', appId),

  onAppDevLog: (cb: (payload: { appId: string; data: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { appId: string; data: string }) => cb(payload);
    ipcRenderer.on('apps:dev-log', handler);
    return () => ipcRenderer.removeListener('apps:dev-log', handler);
  },

  onAppDevStatus: (cb: (payload: { appId: string; status: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { appId: string; status: string }) => cb(payload);
    ipcRenderer.on('apps:dev-status', handler);
    return () => ipcRenderer.removeListener('apps:dev-status', handler);
  },

  // ── Docker / Database ───────────────────────────────────────────────────
  checkDocker: (): Promise<boolean> =>
    ipcRenderer.invoke('docker:check'),

  dbStart: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('docker:db-start', appId),

  dbStop: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('docker:db-stop', appId),

  dbStatus: (appId: string): Promise<{ status: 'running' | 'stopped' | 'none' }> =>
    ipcRenderer.invoke('docker:db-status', appId),

  portCheck: (port: number): Promise<boolean> =>
    ipcRenderer.invoke('docker:port-check', port),

  onDbStatus: (cb: (payload: { appId: string; status: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { appId: string; status: string }) => cb(payload);
    ipcRenderer.on('docker:db-status', handler);
    return () => ipcRenderer.removeListener('docker:db-status', handler);
  },

  dbDescribe: (appId: string): Promise<{ tables: Array<{ name: string; columns: string[] }> }> =>
    ipcRenderer.invoke('db:describe', appId),

  // ── Settings ────────────────────────────────────────────────────────────
  getSettings: (): Promise<{
    ollamaHost: string;
    defaultModel: string;
    autocompleteEnabled: boolean;
    completionModel: string;
  }> =>
    ipcRenderer.invoke('settings:get'),

  setSettings: (settings: {
    ollamaHost?: string;
    defaultModel?: string;
    autocompleteEnabled?: boolean;
    completionModel?: string;
  }): Promise<{
    ollamaHost: string;
    defaultModel: string;
    autocompleteEnabled: boolean;
    completionModel: string;
  }> =>
    ipcRenderer.invoke('settings:set', settings),

  // ── Export ──────────────────────────────────────────────────────────────
  exportApp: (appId: string, format?: 'zip' | 'mobile'): Promise<{ success: boolean; error?: string; path?: string }> =>
    ipcRenderer.invoke('apps:export', { appId, format }),

  // ── Undo / Revert ──────────────────────────────────────────────────────
  snapshotFiles: (appId: string, files: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke('apps:snapshot', { appId, files }),

  hasSnapshot: (appId: string): Promise<boolean> =>
    ipcRenderer.invoke('apps:has-snapshot', appId),

  revertFiles: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:revert', appId),

  // ── Import ──────────────────────────────────────────────────────────────
  importApp: (name: string): Promise<AppProject | null> =>
    ipcRenderer.invoke('apps:import', name),

  // ── Duplicate ──────────────────────────────────────────────────────────
  duplicateApp: (appId: string): Promise<AppProject | null> =>
    ipcRenderer.invoke('apps:duplicate', appId),

  // ── Search ─────────────────────────────────────────────────────────────
  searchFiles: (appId: string, query: string): Promise<Array<{ file: string; line: number; text: string }>> =>
    ipcRenderer.invoke('apps:search-files', { appId, query }),

  // ── Capacitor (Mobile) ─────────────────────────────────────────────────
  capacitorInit: (appId: string): Promise<{ success: boolean; alreadyInitialized?: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-init', appId),

  capacitorOpen: (appId: string, platform: 'android' | 'ios'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-open', appId, platform),

  capacitorListDevices: (appId: string, platform: 'android' | 'ios'): Promise<{ success: boolean; devices: Array<{ id: string; name: string }>; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-list-devices', appId, platform),

  capacitorRun: (appId: string, platform: 'android' | 'ios', target: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-run', appId, platform, target),

  capacitorLiveReload: (appId: string, platform: 'android' | 'ios', enable: boolean, devPort?: number): Promise<{ success: boolean; ip?: string; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-live-reload', appId, platform, enable, devPort),

  // ── Deploy ─────────────────────────────────────────────────────────────
  deployCheck: (): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('apps:deploy-check'),

  deploy: (appId: string, provider: 'netlify' | 'vercel' | 'surge'): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy', appId, provider),

  deployFullstack: (appId: string, provider: 'railway' | 'flyio'): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy-fullstack', appId, provider),

  deployElectron: (appId: string, platform?: 'linux' | 'win' | 'mac'): Promise<{ success: boolean; outputDir?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy-electron', appId, platform),

  deployVps: (appId: string, opts: { host: string; user: string; path: string; port?: number; domain?: string }): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy-vps', appId, opts),

  onDeployLog: (cb: (payload: { appId: string; data: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { appId: string; data: string }) => cb(payload);
    ipcRenderer.on('apps:deploy-log', handler);
    return () => ipcRenderer.removeListener('apps:deploy-log', handler);
  },

  // Plugins
  listPlugins: (): Promise<PluginManifest[]> => ipcRenderer.invoke('plugins:list'),

  // ── Git ────────────────────────────────────────────────────────────────
  gitCommitAgent: (appId: string, message: string): Promise<{ success: boolean; output?: string; error?: string }> =>
    ipcRenderer.invoke('git:commit', appId, message),

  gitLog: (appId: string): Promise<{ hash: string; message: string; date: string }[]> =>
    ipcRenderer.invoke('git:log', appId),

  gitShow: (appId: string, hash: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('git:show', appId, hash, filePath),

  gitDiffStat: (appId: string, hash: string): Promise<{ status: string; path: string }[]> =>
    ipcRenderer.invoke('git:diff-stat', appId, hash),

  gitCheckout: (appId: string, hash: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:checkout', appId, hash),

  gitRemoteGet: (appId: string): Promise<string | null> =>
    ipcRenderer.invoke('git:remote-get', appId),

  gitRemoteSet: (appId: string, url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:remote-set', appId, url),

  gitPush: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:push', appId),

  gitPull: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:pull', appId),

  gitBranch: (appId: string): Promise<{ current: string; branches: string[] }> =>
    ipcRenderer.invoke('git:branch', appId),

  gitBranchCreate: (appId: string, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:branch-create', appId, name),

  gitBranchSwitch: (appId: string, name: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('git:branch-switch', appId, name),

  // ── Package Manager ──────────────────────────────────────────────────────
  npmList: (appId: string): Promise<{ dependencies: Record<string, string>; devDependencies: Record<string, string> }> =>
    ipcRenderer.invoke('npm:list', appId),

  npmInstall: (appId: string, packageName: string, isDev: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('npm:install', appId, packageName, isDev),

  npmUninstall: (appId: string, packageName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('npm:uninstall', appId, packageName),

  // ── Environment Variables ──────────────────────────────────────────────────
  envRead: (appId: string): Promise<Record<string, Record<string, string>>> =>
    ipcRenderer.invoke('env:read', appId),

  envWrite: (appId: string, envFile: string, vars: Record<string, string>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('env:write', appId, envFile, vars),

  // ── Terminal ────────────────────────────────────────────────────────────
  createTerminal: (appId?: string): Promise<string> =>
    ipcRenderer.invoke('terminal:start', { appId }),

  terminalWrite: (termId: string, data: string): Promise<void> =>
    ipcRenderer.invoke('terminal:write', { termId, data }),

  terminalResize: (termId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('terminal:resize', { termId, cols, rows }),

  terminalKill: (termId: string): Promise<void> =>
    ipcRenderer.invoke('terminal:kill', termId),

  onTerminalData: (cb: (payload: { id: string; data: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { id: string; data: string }) => cb(payload);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },

  onTerminalExit: (cb: (payload: { id: string; exitCode: number; signal: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { id: string; exitCode: number; signal: number }) => cb(payload);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  },
  showContextMenu: (type?: 'terminal' | 'global'): Promise<void> => ipcRenderer.invoke('show-context-menu', type),
  onTerminalClear: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('terminal:clear', handler);
    return () => ipcRenderer.removeListener('terminal:clear', handler);
  },
});
