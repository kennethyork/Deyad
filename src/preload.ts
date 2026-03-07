// Preload — exposes safe IPC bridges to the renderer (contextIsolation: true)
import { contextBridge, ipcRenderer } from 'electron';

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

export interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  isFullStack: boolean;
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

  createApp: (name: string, description: string, isFullStack: boolean): Promise<AppProject> =>
    ipcRenderer.invoke('apps:create', { name, description, isFullStack }),

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

  // ── Docker / MySQL ──────────────────────────────────────────────────────
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
});
