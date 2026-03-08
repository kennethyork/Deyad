/**
 * Global type augmentation for the contextBridge API exposed by preload.ts
 */

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type DbProvider = 'mysql' | 'postgresql';

type AppType = 'frontend' | 'fullstack';

interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: AppType;
  dbProvider?: DbProvider;
  pgVersion?: string;
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
}

interface DeyadSettings {
  ollamaHost: string;
  defaultModel: string;
}

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

interface DeyadAPI {
  // AI (Ollama)
  listModels(): Promise<{ models: OllamaModel[] }>;
  chatStream(model: string, messages: ChatMessage[]): Promise<void>;
  onStreamToken(cb: (token: string) => void): () => void;
  onStreamDone(cb: () => void): () => void;
  onStreamError(cb: (err: string) => void): () => void;

  // App projects
  listApps(): Promise<AppProject[]>;
  createApp(name: string, description: string, appType: AppType, dbProvider?: DbProvider, pgVersion?: string): Promise<AppProject>;
  readFiles(appId: string): Promise<Record<string, string>>;
  writeFiles(appId: string, files: Record<string, string>): Promise<boolean>;
  deleteApp(appId: string): Promise<boolean>;
  getAppDir(appId: string): Promise<string>;
  openAppFolder(appId: string): Promise<boolean>;
  renameApp(appId: string, newName: string): Promise<boolean>;
  saveMessages(appId: string, messages: UiMessage[]): Promise<boolean>;
  loadMessages(appId: string): Promise<UiMessage[]>;
  importApp(name: string): Promise<AppProject | null>;

  // Dev server (Preview)
  appDevStart(appId: string): Promise<{ success: boolean; error?: string }>;
  appDevStop(appId: string): Promise<{ success: boolean }>;
  appDevStatus(appId: string): Promise<{ status: 'running' | 'starting' | 'stopped' }>;
  onAppDevLog(cb: (payload: { appId: string; data: string }) => void): () => void;
  onAppDevStatus(cb: (payload: { appId: string; status: string }) => void): () => void;

  // Docker / Database
  checkDocker(): Promise<boolean>;
  dbStart(appId: string): Promise<{ success: boolean; error?: string }>;
  dbStop(appId: string): Promise<{ success: boolean; error?: string }>;
  dbStatus(appId: string): Promise<{ status: 'running' | 'stopped' | 'none' }>;
  onDbStatus(cb: (payload: { appId: string; status: string }) => void): () => void;

  // Settings
  getSettings(): Promise<DeyadSettings>;
  setSettings(settings: Partial<DeyadSettings>): Promise<DeyadSettings>;

  // Export
  exportApp(appId: string): Promise<{ success: boolean; error?: string; path?: string }>;

  // Undo / Revert
  snapshotFiles(appId: string, files: Record<string, string>): Promise<boolean>;
  hasSnapshot(appId: string): Promise<boolean>;
  revertFiles(appId: string): Promise<{ success: boolean; error?: string }>;

  // Git
  gitLog(appId: string): Promise<GitLogEntry[]>;
}

declare global {
  interface Window {
    deyad: DeyadAPI;
  }
}

export {};
