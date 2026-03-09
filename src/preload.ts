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

export type DbProvider = 'mysql' | 'postgresql';
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

  chatStream: (model: string, messages: ChatMessage[]): Promise<void> =>
    ipcRenderer.invoke('ollama:chat-stream', { model, messages }),

  onStreamToken: (cb: (token: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, token: string) => cb(token);
    ipcRenderer.on('ollama:stream-token', handler);
    return () => ipcRenderer.removeListener('ollama:stream-token', handler);
  },

  onStreamDone: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.once('ollama:stream-done', handler);
    return () => ipcRenderer.removeListener('ollama:stream-done', handler);
  },

  onStreamError: (cb: (err: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, err: string) => cb(err);
    ipcRenderer.once('ollama:stream-error', handler);
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
  }> =>
    ipcRenderer.invoke('settings:get'),

  setSettings: (settings: {
    ollamaHost?: string;
    defaultModel?: string;
  }): Promise<{
    ollamaHost: string;
    defaultModel: string;
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

  // ── Capacitor (Mobile) ─────────────────────────────────────────────────
  capacitorInit: (appId: string): Promise<{ success: boolean; alreadyInitialized?: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-init', appId),

  capacitorOpen: (appId: string, platform: 'android' | 'ios'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('apps:capacitor-open', appId, platform),

  // ── Deploy ─────────────────────────────────────────────────────────────
  deployCheck: (): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('apps:deploy-check'),

  deploy: (appId: string, provider: 'netlify' | 'vercel' | 'surge'): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy', appId, provider),

  deployFullstack: (appId: string, provider: 'railway' | 'flyio'): Promise<{ success: boolean; url?: string; error?: string }> =>
    ipcRenderer.invoke('apps:deploy-fullstack', appId, provider),

  onDeployLog: (cb: (payload: { appId: string; data: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { appId: string; data: string }) => cb(payload);
    ipcRenderer.on('apps:deploy-log', handler);
    return () => ipcRenderer.removeListener('apps:deploy-log', handler);
  },

  // Plugins
  listPlugins: (): Promise<PluginManifest[]> => ipcRenderer.invoke('plugins:list'),

  // ── Git ────────────────────────────────────────────────────────────────
  gitLog: (appId: string): Promise<{ hash: string; message: string; date: string }[]> =>
    ipcRenderer.invoke('git:log', appId),

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
