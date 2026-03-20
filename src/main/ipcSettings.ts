/**
 * Settings, Environment Variables, Package Manager, and Plugin IPC handlers.
 */

import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
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

  // ── Plugin Marketplace ────────────────────────────────────────────────────

  const REGISTRY_URL = 'https://raw.githubusercontent.com/kennethyork/Deyad-plugins/main/registry.json';

  function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      https.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search, headers: { 'User-Agent': 'Deyad' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) return httpsGet(location).then(resolve, reject);
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  ipcMain.handle('plugins:registry-list', async () => {
    try {
      const data = await httpsGet(REGISTRY_URL);
      return JSON.parse(data) as Array<{ name: string; description: string; author: string; version: string; repo: string; downloads?: number; tags?: string[] }>;
    } catch {
      return [];
    }
  });

  ipcMain.handle('plugins:install', async (_event, repoUrl: string) => {
    try {
      // Validate URL format — only allow GitHub repos
      const match = repoUrl.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/);
      if (!match) return { success: false, error: 'Invalid GitHub repository URL' };
      const [, owner, repo] = match;
      const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
      const pluginsDir = path.join(app.getPath('userData'), 'plugins');
      fs.mkdirSync(pluginsDir, { recursive: true });
      const tmpZip = path.join(pluginsDir, `${repo}-download.zip`);

      // Download the zip
      await new Promise<void>((resolve, reject) => {
        const download = (url: string) => {
          const parsedUrl = new URL(url);
          https.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search, headers: { 'User-Agent': 'Deyad' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
              const location = res.headers.location;
              if (location) { download(location); return; }
            }
            if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
            const file = fs.createWriteStream(tmpZip);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            file.on('error', reject);
          }).on('error', reject);
        };
        download(zipUrl);
      });

      // Extract using unzip CLI
      const destDir = path.join(pluginsDir, repo);
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true });
      await execFileAsync('unzip', ['-o', tmpZip, '-d', pluginsDir]);
      // GitHub zips extract to repo-main/, rename to repo/
      const extractedDir = path.join(pluginsDir, `${repo}-main`);
      if (fs.existsSync(extractedDir)) fs.renameSync(extractedDir, destDir);
      // Clean up zip
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);

      // Verify plugin.json exists
      const manifestPath = path.join(destDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        fs.rmSync(destDir, { recursive: true });
        return { success: false, error: 'Repository does not contain a plugin.json manifest' };
      }

      // Reload plugins
      loadPlugins();
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('plugins:uninstall', async (_event, pluginName: string) => {
    try {
      const pluginsDir = path.join(app.getPath('userData'), 'plugins');
      const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const d of dirs) {
        const manifestPath = path.join(pluginsDir, d.name, 'plugin.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (manifest.name === pluginName) {
            fs.rmSync(path.join(pluginsDir, d.name), { recursive: true });
            loadPlugins();
            return { success: true };
          }
        }
      }
      return { success: false, error: `Plugin "${pluginName}" not found` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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
