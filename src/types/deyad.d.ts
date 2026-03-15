/**
 * Global type augmentation for the contextBridge API exposed by preload.ts
 */

// Electron <webview> tag support in React JSX
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean;
          nodeintegration?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

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

type DbProvider = 'postgresql';

type AppType = 'frontend' | 'fullstack';

interface AppProject {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  appType: AppType;
  dbProvider?: DbProvider;
  dbPort?: number;
  guiPort?: number;
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  filesGenerated?: string[];
  model?: string;
}

interface DeyadSettings {
  ollamaHost: string;
  defaultModel: string;
  autocompleteEnabled: boolean;
  completionModel: string;
  embedModel: string;
  hasCompletedWizard: boolean;
  pgAdminEmail: string;
  pgAdminPassword: string;
  theme: 'dark' | 'light';
}

interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
}

export interface PluginTemplate {
  name: string;
  description: string;
  icon: string;
  appType: 'frontend' | 'fullstack';
  prompt: string;
}

export interface PluginManifest {
  name: string;
  description?: string;
  templates?: PluginTemplate[];
  // future extension points: models, deployProviders, etc.
}

interface DeyadAPI {
  // AI (Ollama)
  listModels(): Promise<{ models: OllamaModel[] }>;
  chatStream(model: string, messages: ChatMessage[], requestId: string): Promise<void>;
  fimComplete(model: string, prompt: string, suffix?: string, stop?: string[]): Promise<string>;
  embed(model: string, input: string | string[]): Promise<{ embeddings: number[][] }>;
  onStreamToken(requestId: string, cb: (token: string) => void): () => void;
  onStreamDone(requestId: string, cb: () => void): () => void;
  onStreamError(requestId: string, cb: (err: string) => void): () => void;

  // App projects
  listApps(): Promise<AppProject[]>;
  createApp(name: string, description: string, appType: AppType, dbProvider?: DbProvider): Promise<AppProject>;
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
  portCheck(port: number): Promise<boolean>;
  onDbStatus(cb: (payload: { appId: string; status: string }) => void): () => void;

  // Settings
  getSettings(): Promise<DeyadSettings>;
  setSettings(settings: Partial<DeyadSettings>): Promise<DeyadSettings>;

  // Export
  exportApp(appId: string, format?: 'zip' | 'mobile'): Promise<{ success: boolean; error?: string; path?: string }>;

  // Undo / Revert
  snapshotFiles(appId: string, files: Record<string, string>): Promise<boolean>;
  hasSnapshot(appId: string): Promise<boolean>;
  revertFiles(appId: string): Promise<{ success: boolean; error?: string }>;

  // Git
  gitCommitAgent(appId: string, message: string): Promise<{ success: boolean; output?: string; error?: string }>;
  gitLog(appId: string): Promise<GitLogEntry[]>;
  gitShow(appId: string, hash: string, filePath: string): Promise<string | null>;
  gitDiffStat(appId: string, hash: string): Promise<{ status: string; path: string }[]>;
  gitCheckout(appId: string, hash: string): Promise<{ success: boolean; error?: string }>;
  gitRemoteGet(appId: string): Promise<string | null>;
  gitRemoteSet(appId: string, url: string): Promise<{ success: boolean; error?: string }>;
  gitPush(appId: string): Promise<{ success: boolean; error?: string }>;
  gitPull(appId: string): Promise<{ success: boolean; error?: string }>;
  gitBranch(appId: string): Promise<{ current: string; branches: string[] }>;
  gitBranchCreate(appId: string, name: string): Promise<{ success: boolean; error?: string }>;
  gitBranchSwitch(appId: string, name: string): Promise<{ success: boolean; error?: string }>;

  // Package Manager
  npmList(appId: string): Promise<{ dependencies: Record<string, string>; devDependencies: Record<string, string> }>;
  npmInstall(appId: string, packageName: string, isDev: boolean): Promise<{ success: boolean; error?: string }>;
  npmUninstall(appId: string, packageName: string): Promise<{ success: boolean; error?: string }>;

  // Environment Variables
  envRead(appId: string): Promise<Record<string, Record<string, string>>>;
  envWrite(appId: string, envFile: string, vars: Record<string, string>): Promise<{ success: boolean; error?: string }>;

  // Terminal support
  createTerminal(appId?: string): Promise<string>;
  terminalWrite(termId: string, data: string): Promise<void>;
  terminalResize(termId: string, cols: number, rows: number): Promise<void>;
  terminalKill(termId: string): Promise<void>;
  onTerminalData(cb: (payload: { id: string; data: string }) => void): () => void;
  onTerminalExit(cb: (payload: { id: string; exitCode: number; signal: number }) => void): () => void;
  showContextMenu(type?: 'terminal' | 'global'): Promise<void>;
  onTerminalClear(cb: () => void): () => void;

  // Capacitor (Mobile)
  capacitorInit(appId: string): Promise<{ success: boolean; alreadyInitialized?: boolean; error?: string }>;
  capacitorOpen(appId: string, platform: 'android' | 'ios'): Promise<{ success: boolean; error?: string }>;
  capacitorListDevices(appId: string, platform: 'android' | 'ios'): Promise<{ success: boolean; devices: Array<{ id: string; name: string }>; error?: string }>;
  capacitorRun(appId: string, platform: 'android' | 'ios', target: string): Promise<{ success: boolean; error?: string }>;
  capacitorLiveReload(appId: string, platform: 'android' | 'ios', enable: boolean, devPort?: number): Promise<{ success: boolean; ip?: string; error?: string }>;

  // Deploy
  deployCheck(): Promise<Record<string, boolean>>;
  deploy(appId: string, provider: 'netlify' | 'vercel' | 'surge'): Promise<{ success: boolean; url?: string; error?: string }>;
  deployFullstack(appId: string, provider: 'railway' | 'flyio'): Promise<{ success: boolean; url?: string; error?: string }>;
  deployElectron(appId: string, platform?: 'linux' | 'win' | 'mac'): Promise<{ success: boolean; outputDir?: string; error?: string }>;
  deployVps(appId: string, opts: { host: string; user: string; path: string; port?: number; domain?: string }): Promise<{ success: boolean; url?: string; error?: string }>;
  onDeployLog(cb: (payload: { appId: string; data: string }) => void): () => void;

  // Plugins
  listPlugins(): Promise<PluginManifest[]>;

  // Database inspection
  dbDescribe(appId: string): Promise<{ tables: Array<{ name: string; columns: string[] }> }>;
}

declare global {
  interface Window {
    deyad: DeyadAPI;
  }
}

export {};
