/**
 * Deploy IPC handlers for Netlify, Vercel, Surge, Railway, Fly.io, and Electron desktop.
 */

import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';

const execFileAsync = promisify(execFile);

/** Spawn a command and stream stdout/stderr to a log callback. */
function spawnWithLogs(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number },
  sendLog: (msg: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env }, stdio: 'pipe' });
    const timer = opts.timeout > 0 ? setTimeout(() => { child.kill(); reject(new Error('Timed out')); }, opts.timeout) : null;
    child.stdout?.on('data', (d: Buffer) => sendLog(d.toString()));
    child.stderr?.on('data', (d: Buffer) => sendLog(d.toString()));
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve(code ?? 1); });
  });
}

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
      } catch (err) { console.debug('not available:', err); }
    }
    return checks;
  });

  ipcMain.handle('apps:deploy', async (event, appId: string, provider: 'netlify' | 'vercel' | 'surge') => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appType = 'frontend';
    let appName = 'dyad-app';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      appType = meta.appType || appType;
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    } catch (err) { console.debug('use defaults:', err); }

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
        } catch (err) {
          console.debug('Handled error:', err);
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
        const domain = `dyad-${appId.slice(0, 12)}.surge.sh`;
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

    let appName = 'dyad-app';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    } catch (err) { console.debug('use default:', err); }

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
        } catch (err) {
          console.debug('Handled error:', err);
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

  // ── VPS Deploy (SSH + rsync) ─────────────────────────────────────────────
  ipcMain.handle('apps:deploy-vps', async (event, appId: string, opts: { host: string; user: string; path: string; port?: number; domain?: string }) => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    // Validate inputs
    if (!opts.host || !opts.user || !opts.path) {
      return { success: false, error: 'Host, user, and remote path are required' };
    }
    // Basic validation: no shell metacharacters in host/user/path/domain
    const allInputs = opts.host + opts.user + opts.path + (opts.domain || '');
    if (/[;&|`$(){}'"\\]/.test(allInputs)) {
      return { success: false, error: 'Invalid characters in connection details' };
    }
    // Validate domain format if provided
    if (opts.domain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(opts.domain)) {
      return { success: false, error: 'Invalid domain format (e.g. example.com or app.example.com)' };
    }

    let appType = 'frontend';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      appType = meta.appType || appType;
    } catch (err) { console.debug('use default:', err); }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });
    const sshPort = String(opts.port || 22);

    try {
      // 1. Build
      const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;
      sendLog('Building project…\n');
      await spawnWithLogs('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 }, sendLog);
      sendLog('Build complete.\n');

      const distDir = path.join(webDir, 'dist');
      if (!fs.existsSync(distDir)) return { success: false, error: 'Build output (dist/) not found' };

      // 2. rsync to VPS
      const remoteDest = `${opts.user}@${opts.host}:${opts.path}`;
      sendLog(`Uploading to ${remoteDest} via rsync…\n`);

      const rsyncArgs = [
        '-avz', '--delete',
        '-e', `ssh -p ${sshPort} -o StrictHostKeyChecking=accept-new`,
        distDir + '/',
        remoteDest,
      ];

      const code = await spawnWithLogs('rsync', rsyncArgs, { cwd: dir, timeout: 300_000 }, sendLog);
      if (code !== 0) return { success: false, error: `rsync exited with code ${code}` };

      // 3. Set up nginx + SSL if domain provided
      if (opts.domain) {
        sendLog(`\nConfiguring nginx for ${opts.domain}…\n`);
        const sshCmd = `ssh -p ${sshPort} -o StrictHostKeyChecking=accept-new ${opts.user}@${opts.host}`;

        const nginxConf = [
          `server {`,
          `    listen 80;`,
          `    server_name ${opts.domain};`,
          `    root ${opts.path};`,
          `    index index.html;`,
          `    location / {`,
          `        try_files \\$uri \\$uri/ /index.html;`,
          `    }`,
          `}`,
        ].join('\n');

        // Write nginx config
        const confPath = `/etc/nginx/sites-available/${opts.domain}`;
        const enabledPath = `/etc/nginx/sites-enabled/${opts.domain}`;
        const writeConf = await spawnWithLogs(
          'ssh',
          [`-p`, sshPort, `-o`, `StrictHostKeyChecking=accept-new`, `${opts.user}@${opts.host}`,
           `echo '${nginxConf}' | sudo tee ${confPath} && sudo ln -sf ${confPath} ${enabledPath} && sudo nginx -t && sudo systemctl reload nginx`],
          { cwd: dir, timeout: 30_000 },
          sendLog,
        );
        if (writeConf !== 0) {
          sendLog('\n⚠ Nginx config failed — files were uploaded but nginx was not configured.\n');
          sendLog('Make sure the SSH user has sudo access and nginx is installed.\n');
        } else {
          sendLog('Nginx configured. Requesting SSL certificate…\n');

          // Run certbot for HTTPS
          const certCode = await spawnWithLogs(
            'ssh',
            [`-p`, sshPort, `-o`, `StrictHostKeyChecking=accept-new`, `${opts.user}@${opts.host}`,
             `sudo certbot --nginx -d ${opts.domain} --non-interactive --agree-tos --redirect --register-unsafely-without-email || echo 'certbot failed — HTTPS not configured'`],
            { cwd: dir, timeout: 120_000 },
            sendLog,
          );
          if (certCode !== 0) {
            sendLog('\n⚠ Certbot failed — site is live on HTTP but HTTPS was not configured.\n');
            sendLog('Make sure certbot is installed: sudo apt install certbot python3-certbot-nginx\n');
          } else {
            sendLog('SSL certificate installed!\n');
          }
        }
      }

      const url = opts.domain ? `https://${opts.domain}` : `http://${opts.host}`;
      sendLog(`\nDeployed to VPS! ${url}\n`);
      return { success: true, url };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`\nVPS deploy failed: ${msg}\n`);
      return { success: false, error: msg };
    }
  });

  // ── Electron Desktop Build ──────────────────────────────────────────────
  ipcMain.handle('apps:deploy-electron', async (event, appId: string, platform?: 'linux' | 'win' | 'mac') => {
    const dir = appDir(appId);
    if (!fs.existsSync(dir)) return { success: false, error: 'App directory not found' };

    let appName = 'dyad-app';
    let displayName = 'Dyad App';
    let appType = 'frontend';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'dyad.json'), 'utf-8'));
      displayName = meta.name || displayName;
      appName = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      appType = meta.appType || appType;
    } catch (err) { console.debug('use defaults:', err); }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

    try {
      // 1. Build the Vite frontend
      const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;
      sendLog('Building frontend…\n');
      await spawnWithLogs('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 }, sendLog);
      sendLog('Build complete.\n');

      const distDir = path.join(webDir, 'dist');
      if (!fs.existsSync(distDir)) return { success: false, error: 'Build output (dist/) not found' };

      // 2. Create / update Electron desktop scaffold
      const electronDir = path.join(dir, 'electron-desktop');
      fs.mkdirSync(electronDir, { recursive: true });

      // Copy built frontend into scaffold app/ directory
      const appAssetsDir = path.join(electronDir, 'app');
      if (fs.existsSync(appAssetsDir)) fs.rmSync(appAssetsDir, { recursive: true });
      fs.cpSync(distDir, appAssetsDir, { recursive: true });
      sendLog('Copied build output to Electron scaffold.\n');

      // ── main.js (with Ollama integration) ───────────────────────────────
      const mainJs = `const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: ${JSON.stringify(displayName)},
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
}

// ── Ollama IPC bridge ──────────────────────────────────────────────────
function ollamaRequest(urlPath, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: 11434,
      path: urlPath,
      method: postData ? 'POST' : 'GET',
      headers: postData
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        : {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { console.debug('Handled error:', err); resolve({ raw: data }); }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Ollama request timed out')); });
    if (postData) req.write(postData);
    req.end();
  });
}

ipcMain.handle('ollama:check', async () => {
  try {
    const res = await ollamaRequest('/api/version');
    return { available: true, version: res.version || 'unknown' };
  } catch (err) { console.debug('Handled error:', err); return { available: false }; }
});

ipcMain.handle('ollama:models', async () => {
  try { return await ollamaRequest('/api/tags'); }
  catch (err) { console.debug('Handled error:', err); return { models: [] }; }
});

ipcMain.handle('ollama:chat', async (_event, { model, messages }) => {
  try { return await ollamaRequest('/api/chat', { model, messages, stream: false }); }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle('ollama:generate', async (_event, { model, prompt }) => {
  try { return await ollamaRequest('/api/generate', { model, prompt, stream: false }); }
  catch (e) { return { error: e.message }; }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
`;
      fs.writeFileSync(path.join(electronDir, 'main.js'), mainJs);

      // ── preload.js (Ollama bridge for renderer) ─────────────────────────
      const preloadJs = `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ollama', {
  check: () => ipcRenderer.invoke('ollama:check'),
  models: () => ipcRenderer.invoke('ollama:models'),
  chat: (model, messages) => ipcRenderer.invoke('ollama:chat', { model, messages }),
  generate: (model, prompt) => ipcRenderer.invoke('ollama:generate', { model, prompt }),
});
`;
      fs.writeFileSync(path.join(electronDir, 'preload.js'), preloadJs);

      // ── package.json ────────────────────────────────────────────────────
      const pkgJson = {
        name: appName,
        version: '1.0.0',
        description: `Desktop app: ${displayName} — built with Dyad`,
        main: 'main.js',
        scripts: { build: 'electron-builder build' },
        build: {
          appId: `com.dyad.${appName.replace(/-/g, '')}`,
          productName: displayName,
          directories: { output: 'out' },
          files: ['main.js', 'preload.js', 'app/**/*'],
          linux: { target: ['AppImage'] },
          win: { target: ['nsis'] },
          mac: { target: ['dmg'] },
        },
        devDependencies: {
          electron: '^33.0.0',
          'electron-builder': '^25.0.0',
        },
      };
      fs.writeFileSync(path.join(electronDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
      sendLog('Generated Electron scaffold (main.js, preload.js, package.json).\n');

      // 3. Install dependencies if needed
      const electronModExists = fs.existsSync(path.join(electronDir, 'node_modules', 'electron'));
      if (!electronModExists) {
        sendLog('Installing Electron dependencies (this may take a minute)…\n');
        await spawnWithLogs('npm', ['install'], { cwd: electronDir, timeout: 300_000 }, sendLog);
        sendLog('Dependencies installed.\n');
      }

      // 4. Build with electron-builder
      sendLog('Packaging desktop app…\n');
      const builderArgs = ['electron-builder', 'build'];
      if (platform === 'linux') builderArgs.push('--linux');
      else if (platform === 'win') builderArgs.push('--win');
      else if (platform === 'mac') builderArgs.push('--mac');

      await spawnWithLogs('npx', builderArgs, { cwd: electronDir, timeout: 600_000 }, sendLog);

      const outDir = path.join(electronDir, 'out');
      sendLog(`\nDesktop app built! Output: ${outDir}\n`);
      return { success: true, outputDir: outDir };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`\nBuild failed: ${msg}\n`);
      return { success: false, error: msg };
    }
  });
}
