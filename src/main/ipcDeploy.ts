/**
 * Deploy IPC handlers for Netlify, Vercel, Surge, Railway, and Fly.io.
 */

import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export function registerDeployHandlers(appDir: (id: string) => string): void {
  ipcMain.handle('apps:deploy-check', async () => {
    const checks: Record<string, boolean> = { netlify: false, vercel: false, surge: false, railway: false, flyio: false };
    const cliMap: Record<string, string[]> = {
      netlify: ['netlify', '--version'],
      vercel: ['vercel', '--version'],
      surge: ['surge', '--version'],
      railway: ['railway', '--version'],
      flyio: ['fly', 'version'],
    };
    for (const [key, cmd] of Object.entries(cliMap)) {
      try {
        await execFileAsync(cmd[0], cmd.slice(1), { timeout: 15_000 });
        checks[key] = true;
      } catch { /* not available */ }
    }
    return checks;
  });

  ipcMain.handle('apps:deploy', async (event, appId: string, provider: 'netlify' | 'vercel' | 'surge') => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appType = 'frontend';
    let appName = 'deyad-app';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      appType = meta.appType || appType;
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    } catch { /* use defaults */ }

    const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

    try {
      sendLog('Building project...\n');
      await execFileAsync('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 });
      sendLog('Build complete.\n');

      const distDir = path.join(webDir, 'dist');
      if (!fs.existsSync(distDir)) return { success: false, error: 'Build output (dist/) not found' };

      let url = '';

      if (provider === 'netlify') {
        sendLog('Deploying to Netlify...\n');
        const { stdout } = await execFileAsync('npx', ['netlify', 'deploy', '--dir=dist', '--prod', '--json'], { cwd: webDir, timeout: 120_000 });
        try {
          const result = JSON.parse(stdout);
          url = result.deploy_url || result.url || '';
        } catch {
          const match = stdout.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/);
          url = match?.[0] || '';
        }
      } else if (provider === 'vercel') {
        sendLog('Deploying to Vercel...\n');
        const { stdout } = await execFileAsync('npx', ['vercel', '--prod', '--yes'], { cwd: distDir, timeout: 120_000 });
        url = stdout.trim().split('\n').pop() || '';
      } else if (provider === 'surge') {
        sendLog('Deploying to Surge...\n');
        const indexPath = path.join(distDir, 'index.html');
        const spaPath = path.join(distDir, '200.html');
        if (fs.existsSync(indexPath) && !fs.existsSync(spaPath)) {
          fs.copyFileSync(indexPath, spaPath);
        }
        const domain = `deyad-${appId.slice(0, 12)}.surge.sh`;
        const { stdout } = await execFileAsync('npx', ['surge', distDir, domain], { cwd: webDir, timeout: 120_000 });
        url = `https://${domain}`;
        sendLog(stdout);
      }

      sendLog(`\nDeployed! ${url}\n`);
      return { success: true, url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`\nDeploy failed: ${msg}\n`);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('apps:deploy-fullstack', async (event, appId: string, provider: 'railway' | 'flyio') => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appName = 'deyad-app';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    } catch { /* use default */ }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

    try {
      let url = '';

      if (provider === 'railway') {
        sendLog('Deploying fullstack app to Railway...\n');

        const hasRailway = fs.existsSync(path.join(dir, '.railway'));
        if (!hasRailway) {
          sendLog('Initializing Railway project...\n');
          await execFileAsync('railway', ['init', '--name', appName], { cwd: dir, timeout: 30_000 });
        }

        sendLog('Pushing to Railway (this may take a few minutes)...\n');
        const { stdout } = await execFileAsync('railway', ['up', '--detach'], { cwd: dir, timeout: 300_000 });
        sendLog(stdout);

        try {
          const { stdout: domainOut } = await execFileAsync('railway', ['domain'], { cwd: dir, timeout: 15_000 });
          url = domainOut.trim();
          if (url && !url.startsWith('http')) url = `https://${url}`;
        } catch {
          url = '(check Railway dashboard for URL)';
        }
      } else if (provider === 'flyio') {
        sendLog('Deploying fullstack app to Fly.io...\n');

        const hasFlyToml = fs.existsSync(path.join(dir, 'fly.toml'));
        if (!hasFlyToml) {
          sendLog('Launching new Fly.io app...\n');
          if (!fs.existsSync(path.join(dir, 'Dockerfile'))) {
            const dockerfile = `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN cd frontend && npm ci && npx vite build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/package*.json ./
RUN cd backend && npm ci --production
EXPOSE 3001
CMD ["node", "backend/src/index.js"]
`;
            fs.writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
            sendLog('Generated Dockerfile.\n');
          }

          await execFileAsync('fly', ['launch', '--name', appName, '--no-deploy', '--yes'], { cwd: dir, timeout: 60_000 });
        }

        sendLog('Deploying to Fly.io (this may take a few minutes)...\n');
        const { stdout } = await execFileAsync('fly', ['deploy'], { cwd: dir, timeout: 300_000 });
        sendLog(stdout);
        url = `https://${appName}.fly.dev`;
      }

      sendLog(`\nDeployed! ${url}\n`);
      return { success: true, url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`\nDeploy failed: ${msg}\n`);
      return { success: false, error: msg };
    }
  });
}
