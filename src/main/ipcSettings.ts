/**
 * Settings, Environment Variables, Package Manager, and Plugin IPC handlers.
 */

import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { DeyadSettings } from '../lib/mainUtils';
import { getViteRoot } from './ipcApps';

const execFileAsync = promisify(execFile);

// ── Plugin infrastructure ─────────────────────────────────────────────────

interface PluginTemplate {
  name: string;
  description: string;
  icon: string;
  appType: 'frontend' | 'fullstack' | 'nextjs' | 'python' | 'go';
  prompt: string;
}
interface PluginAgentTool {
  name: string;
  description: string;
  parameters: Record<string, string>;
}
interface PluginAgent {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
}
interface PluginTheme {
  name: string;
  css: string;
}
interface PluginManifest {
  name: string;
  description?: string;
  templates?: PluginTemplate[];
  agentTools?: PluginAgentTool[];
  agents?: PluginAgent[];
  themes?: PluginTheme[];
}

let loadedPlugins: PluginManifest[] = [];

function loadPlugins() {
  const pluginsDir = path.join(app.getPath('userData'), 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    return;
  }
  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pluginsDir, d.name));
  loadedPlugins = [];
  for (const dir of dirs) {
    const manifestPath = path.join(dir, 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
        loadedPlugins.push(manifest);
      } catch (err) {
        console.debug('ignore malformed:', err);
      }
    }
  }
}

// Load plugins early
app.whenReady().then(() => {
  loadPlugins();
});

export function registerSettingsHandlers(
  appDir: (id: string) => string,
  getSettings: () => DeyadSettings,
  setSettings: (s: DeyadSettings) => void,
): void {
  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_event, settings: Partial<DeyadSettings>) => {
    const updated = { ...getSettings(), ...settings };
    setSettings(updated);
    return updated;
  });

  // ── Plugins ───────────────────────────────────────────────────────────────

  ipcMain.handle('plugins:list', () => loadedPlugins);

  ipcMain.handle('plugins:invoke-tool', (_event, toolName: string, params: Record<string, unknown>) => {
    for (const plugin of loadedPlugins) {
      const tool = plugin.agentTools?.find(t => t.name === toolName);
      if (tool) {
        return { success: true, plugin: plugin.name, tool: tool.name, params };
      }
    }
    return { success: false, error: `Tool "${toolName}" not found in any plugin` };
  });

  ipcMain.handle('plugins:list-themes', () => {
    const themes: Array<{ plugin: string; name: string; css: string }> = [];
    for (const plugin of loadedPlugins) {
      for (const theme of plugin.themes ?? []) {
        themes.push({ plugin: plugin.name, name: theme.name, css: theme.css });
      }
    }
    return themes;
  });

  ipcMain.handle('plugins:list-agents', () => {
    const agents: Array<{ plugin: string; name: string; description: string; systemPrompt: string; model?: string }> = [];
    for (const plugin of loadedPlugins) {
      for (const agent of plugin.agents ?? []) {
        agents.push({ plugin: plugin.name, ...agent });
      }
    }
    return agents;
  });

  // ── Package Manager ───────────────────────────────────────────────────────

  ipcMain.handle('npm:list', async (_event, appId: string) => {
    const dir = appDir(appId);
    const pkgPath = path.join(dir, 'package.json');
    const frontendPkg = path.join(dir, 'frontend', 'package.json');
    const targetPkg = fs.existsSync(pkgPath) ? pkgPath : fs.existsSync(frontendPkg) ? frontendPkg : null;
    if (!targetPkg) return { dependencies: {}, devDependencies: {} };
    try {
      const pkg = JSON.parse(fs.readFileSync(targetPkg, 'utf-8'));
      return {
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {},
      };
    } catch (err) { console.warn('Failed to parse package.json:', err); return { dependencies: {}, devDependencies: {} }; }
  });

  ipcMain.handle('npm:install', async (event, appId: string, packageName: string, isDev: boolean) => {
    const dir = appDir(appId);
    if (!/^(@[\w-]+\/)?[\w][\w.\-]*$/.test(packageName)) {
      return { success: false, error: 'Invalid package name' };
    }
    const viteRoot = getViteRoot(appDir, appId) || dir;
    const args = ['install', packageName];
    if (isDev) args.push('--save-dev');
    try {
      const { stdout, stderr } = await execFileAsync('npm', args, { cwd: viteRoot, timeout: 120000 });
      if (!event.sender.isDestroyed()) event.sender.send('npm:install-log', { appId, data: stdout + stderr });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('npm:uninstall', async (_event, appId: string, packageName: string) => {
    if (!/^(@[\w-]+\/)?[\w][\w.\-]*$/.test(packageName)) {
      return { success: false, error: 'Invalid package name' };
    }
    const dir = appDir(appId);
    const viteRoot = getViteRoot(appDir, appId) || dir;
    try {
      await execFileAsync('npm', ['uninstall', packageName], { cwd: viteRoot, timeout: 60000 });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Environment Variables ─────────────────────────────────────────────────

  ipcMain.handle('env:read', (_event, appId: string) => {
    const dir = appDir(appId);
    const envPaths = [
      path.join(dir, '.env'),
      path.join(dir, 'frontend', '.env'),
      path.join(dir, 'backend', '.env'),
    ];
    const result: Record<string, Record<string, string>> = {};
    for (const envPath of envPaths) {
      if (fs.existsSync(envPath)) {
        const relName = path.relative(dir, envPath);
        const vars: Record<string, string> = {};
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            vars[key] = value;
          }
        }
        result[relName] = vars;
      }
    }
    return result;
  });

  ipcMain.handle('env:write', (_event, appId: string, envFile: string, vars: Record<string, string>) => {
    const dir = appDir(appId);
    const envPath = path.join(dir, envFile);
    const resolvedDir = fs.realpathSync(path.resolve(dir));
    const resolvedEnv = path.resolve(envPath);
    if (!resolvedEnv.startsWith(resolvedDir)) return { success: false, error: 'Path traversal detected' };
    const content = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, content, 'utf-8');
    return { success: true };
  });
}
