/**
 * Capacitor IPC handlers for on-device mobile preview.
 */

import { ipcMain } from 'electron';
import os from 'os';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

/** Helper: resolve the Capacitor working directory for an app */
function capWebDir(appDirFn: (id: string) => string, appId: string): string {
  const dir = appDirFn(appId);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
    if (meta.appType === 'fullstack') return path.join(dir, 'frontend');
  } catch (err) { console.debug('default:', err); }
  return dir;
}

/** Helper: get the first non-internal IPv4 address */
function getLocalIp(): string {
  const ifaces = os.networkInterfaces();
  for (const ifaceList of Object.values(ifaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

export function registerCapacitorHandlers(appDir: (id: string) => string): void {
  ipcMain.handle('apps:capacitor-init', async (_event, appId: string) => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appName = 'MyApp';
    let appType = 'frontend';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      appName = meta.name || appName;
      appType = meta.appType || appType;
    } catch (err) { console.debug('use default:', err); }

    const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;
    if (!fs.existsSync(webDir)) return { success: false, error: 'Frontend directory not found' };

    const capId = appName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'com.dyad.app';

    if (fs.existsSync(path.join(webDir, 'capacitor.config.ts'))) {
      return { success: true, alreadyInitialized: true };
    }

    try {
      await execFileAsync('npm', ['install', '@capacitor/core', '@capacitor/cli', '@capacitor/android', '@capacitor/ios'], { cwd: webDir, timeout: 120_000 });

      const capConfig = `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dyad.${capId}',
  appName: ${JSON.stringify(appName)},
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
`;
      fs.writeFileSync(path.join(webDir, 'capacitor.config.ts'), capConfig);

      await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
      await execFileAsync('npx', ['cap', 'add', 'android'], { cwd: webDir, timeout: 60_000 });
      await execFileAsync('npx', ['cap', 'add', 'ios'], { cwd: webDir, timeout: 60_000 }).catch((err) => console.warn('cap add ios:', err));
      await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('apps:capacitor-open', async (_event, appId: string, platform: 'android' | 'ios') => {
    const dir = appDir(appId);

    let webDir = dir;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      if (meta.appType === 'fullstack') webDir = path.join(dir, 'frontend');
    } catch (err) { console.debug('use root:', err); }

    try {
      await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
      await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });
      await execFileAsync('npx', ['cap', 'open', platform], { cwd: webDir, timeout: 30_000 });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('apps:capacitor-list-devices', async (_event, appId: string, platform: 'android' | 'ios') => {
    const webDir = capWebDir(appDir, appId);
    try {
      const { stdout } = await execFileAsync('npx', ['cap', 'run', platform, '--list'], { cwd: webDir, timeout: 30_000 });
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const devices: Array<{ id: string; name: string }> = [];
      for (const line of lines) {
        if (line.startsWith('--') || line.toLowerCase().includes('name') && line.toLowerCase().includes('api')) continue;
        const id = line.split(/\s+/)[0];
        if (id) devices.push({ id, name: line });
      }
      return { success: true, devices };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, devices: [], error: msg };
    }
  });

  ipcMain.handle('apps:capacitor-run', async (_event, appId: string, platform: 'android' | 'ios', target: string) => {
    const webDir = capWebDir(appDir, appId);
    try {
      await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
      await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });
      await execFileAsync('npx', ['cap', 'run', platform, '--target', target], { cwd: webDir, timeout: 180_000 });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('apps:capacitor-live-reload', async (_event, appId: string, platform: 'android' | 'ios', enable: boolean, devPort?: number) => {
    const webDir = capWebDir(appDir, appId);
    const configPath = path.join(webDir, 'capacitor.config.ts');
    if (!fs.existsSync(configPath)) return { success: false, error: 'Capacitor not initialized. Run Initialize first.' };

    try {
      let config = fs.readFileSync(configPath, 'utf-8');

      if (enable) {
        const ip = getLocalIp();
        const port = devPort || 5173;
        const serverBlock = `  server: {\n    url: 'http://${ip}:${port}',\n    cleartext: true,\n  },`;

        if (config.includes('server:')) {
          config = config.replace(/\s*server:\s*\{[^}]*\},?/s, '\n' + serverBlock);
        } else {
          config = config.replace(/(webDir:\s*'[^']*',?)/, `$1\n${serverBlock}`);
        }
      } else {
        const defaultServer = `  server: {\n    androidScheme: 'https',\n  },`;
        config = config.replace(/\s*server:\s*\{[^}]*\},?/s, '\n' + defaultServer);
      }

      fs.writeFileSync(configPath, config);
      await execFileAsync('npx', ['cap', 'sync'], { cwd: webDir, timeout: 60_000 });
      return { success: true, ip: enable ? getLocalIp() : undefined };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}
