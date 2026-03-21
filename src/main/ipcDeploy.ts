/**
 * Deploy IPC handlers for Netlify, Vercel, Surge, Railway, Fly.io, and Electron desktop.
 * Includes OAuth token-based deploy for Vercel and Netlify (no CLI needed).
 */

import { BrowserWindow, ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import https from 'node:https';

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
    let appName = 'deyad-app';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      appType = meta.appType || appType;
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    } catch (err) { console.debug('use defaults:', err); }

    // Python and Go apps should use container-based deploy (Railway/Fly.io), not static hosting
    if (appType === 'python' || appType === 'go') {
      return { success: false, error: `${appType} apps should be deployed via Railway or Fly.io (container deploy). Use the fullstack deploy option.` };
    }

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
    let appType = 'fullstack';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      appName = (meta.name || appName).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      appType = meta.appType || appType;
    } catch (err) { console.debug('use default:', err); }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

    try {
      let url = '';

      if (provider === 'railway') {
        sendLog(`Deploying ${appType} app to Railway...\n`);

        // Ensure Dockerfile exists for Python/Go apps
        if ((appType === 'python' || appType === 'go') && !fs.existsSync(path.join(dir, 'Dockerfile'))) {
          const dockerfile = appType === 'python'
            ? `FROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n`
            : `FROM golang:1.22-alpine AS build\nWORKDIR /app\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN CGO_ENABLED=0 go build -o server .\n\nFROM alpine:3.19\nWORKDIR /app\nCOPY --from=build /app/server .\nEXPOSE 8080\nCMD ["./server"]\n`;
          fs.writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
          sendLog('Generated Dockerfile.\n');
        }

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
        sendLog(`Deploying ${appType} app to Fly.io...\n`);

        const hasFlyToml = fs.existsSync(path.join(dir, 'fly.toml'));
        if (!hasFlyToml) {
          sendLog('Launching new Fly.io app...\n');
          if (!fs.existsSync(path.join(dir, 'Dockerfile'))) {
            let dockerfile: string;
            if (appType === 'python') {
              dockerfile = `FROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n`;
            } else if (appType === 'go') {
              dockerfile = `FROM golang:1.22-alpine AS build\nWORKDIR /app\nCOPY go.mod go.sum ./\nRUN go mod download\nCOPY . .\nRUN CGO_ENABLED=0 go build -o server .\n\nFROM alpine:3.19\nWORKDIR /app\nCOPY --from=build /app/server .\nEXPOSE 8080\nCMD ["./server"]\n`;
            } else {
              dockerfile = `FROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN cd frontend && npm ci && npx vite build\n\nFROM node:20-alpine\nWORKDIR /app\nCOPY --from=build /app/backend ./backend\nCOPY --from=build /app/frontend/dist ./frontend/dist\nCOPY --from=build /app/package*.json ./\nRUN cd backend && npm ci --production\nEXPOSE 3001\nCMD ["node", "backend/src/index.js"]\n`;
            }
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
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      appType = meta.appType || appType;
    } catch (err) { console.debug('use default:', err); }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });
    const sshPort = String(opts.port || 22);

    try {
      // 1. Build
      let distDir: string;
      if (appType === 'python') {
        // Python: no build step, rsync the whole project
        sendLog('Preparing Python project for upload…\n');
        distDir = dir;
      } else if (appType === 'go') {
        // Go: build binary
        sendLog('Building Go binary…\n');
        await spawnWithLogs('go', ['build', '-o', 'server', '.'], { cwd: dir, timeout: 120_000 }, sendLog);
        sendLog('Build complete.\n');
        distDir = dir;
      } else {
        const webDir = appType === 'fullstack' ? path.join(dir, 'frontend') : dir;
        sendLog('Building project…\n');
        await spawnWithLogs('npx', ['vite', 'build'], { cwd: webDir, timeout: 120_000 }, sendLog);
        sendLog('Build complete.\n');
        distDir = path.join(webDir, 'dist');
        if (!fs.existsSync(distDir)) return { success: false, error: 'Build output (dist/) not found' };
      }

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

      // 3. Start service on VPS for Python/Go
      if (appType === 'python' || appType === 'go') {
        sendLog('\nSetting up systemd service on VPS…\n');
        const serviceName = `deyad-${appId.slice(0, 12)}`;
        const execStart = appType === 'python'
          ? `/usr/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000`
          : `${opts.path}/server`;
        const servicePort = appType === 'python' ? 8000 : 8080;
        const serviceUnit = [
          '[Unit]',
          `Description=${serviceName}`,
          'After=network.target',
          '',
          '[Service]',
          `WorkingDirectory=${opts.path}`,
          `ExecStart=${execStart}`,
          'Restart=always',
          'Environment=PATH=/usr/local/bin:/usr/bin:/bin',
          '',
          '[Install]',
          'WantedBy=multi-user.target',
        ].join('\n');

        const setupCmd = [
          `echo '${serviceUnit}' | sudo tee /etc/systemd/system/${serviceName}.service`,
          'sudo systemctl daemon-reload',
          `sudo systemctl enable --now ${serviceName}`,
        ].join(' && ');

        const svcCode = await spawnWithLogs(
          'ssh',
          ['-p', sshPort, '-o', 'StrictHostKeyChecking=accept-new', `${opts.user}@${opts.host}`, setupCmd],
          { cwd: dir, timeout: 30_000 },
          sendLog,
        );
        if (svcCode !== 0) {
          sendLog('\n⚠ Service setup failed — files were uploaded but the service was not configured.\n');
          sendLog('Make sure the SSH user has sudo access and Python3/Go is installed on the server.\n');
        } else {
          sendLog('Service started!\n');
        }
      }

      // 4. Set up nginx + SSL if domain provided
      if (opts.domain) {
        sendLog(`\nConfiguring nginx for ${opts.domain}…\n`);
        const sshCmd = `ssh -p ${sshPort} -o StrictHostKeyChecking=accept-new ${opts.user}@${opts.host}`;

        const isApiApp = appType === 'python' || appType === 'go';
        const apiPort = appType === 'python' ? 8000 : 8080;
        const nginxConf = isApiApp
          ? [
              `server {`,
              `    listen 80;`,
              `    server_name ${opts.domain};`,
              `    location / {`,
              `        proxy_pass http://127.0.0.1:${apiPort};`,
              `        proxy_set_header Host \$host;`,
              `        proxy_set_header X-Real-IP \$remote_addr;`,
              `        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;`,
              `        proxy_set_header X-Forwarded-Proto \$scheme;`,
              `    }`,
              `}`,
            ].join('\n')
          : [
              `server {`,
              `    listen 80;`,
              `    server_name ${opts.domain};`,
              `    root ${opts.path};`,
              `    index index.html;`,
              `    location / {`,
              `        try_files \$uri \$uri/ /index.html;`,
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

    let appName = 'deyad-app';
    let displayName = 'Deyad App';
    let appType = 'frontend';
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'deyad.json'), 'utf-8'));
      displayName = meta.name || displayName;
      appName = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      appType = meta.appType || appType;
    } catch (err) { console.debug('use defaults:', err); }

    const win = BrowserWindow.fromWebContents(event.sender);
    const sendLog = (msg: string) => win?.webContents.send('apps:deploy-log', { appId, data: msg });

    try {
      // Python/Go apps cannot be packaged as Electron desktop apps
      if (appType === 'python' || appType === 'go') {
        return { success: false, error: `${appType} apps cannot be packaged as Electron desktop apps. Use Railway, Fly.io, or VPS deploy instead.` };
      }

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
        description: `Desktop app: ${displayName} — built with Deyad`,
        main: 'main.js',
        scripts: { build: 'electron-builder build' },
        build: {
          appId: `com.deyad.${appName.replace(/-/g, '')}`,
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

  // ── OAuth token storage ──────────────────────────────────────────────
  const tokensPath = path.join(app.getPath('userData'), 'deploy-tokens.json');

  function readTokens(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  function writeTokens(tokens: Record<string, string>): void {
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  ipcMain.handle('apps:deploy-token-get', (_e, provider: string) => {
    const tokens = readTokens();
    return tokens[provider] ?? null;
  });

  ipcMain.handle('apps:deploy-token-set', (_e, provider: string, token: string) => {
    const tokens = readTokens();
    tokens[provider] = token;
    writeTokens(tokens);
    return { success: true };
  });

  ipcMain.handle('apps:deploy-token-clear', (_e, provider: string) => {
    const tokens = readTokens();
    delete tokens[provider];
    writeTokens(tokens);
    return { success: true };
  });

  // ── OAuth deploy via REST API (no CLI needed) ────────────────────────
  ipcMain.handle('apps:deploy-oauth', async (_e, appId: string, provider: string, token: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    const sendLog = (msg: string) => win?.webContents.send('deploy-log', msg);

    try {
      const dir = appDir(appId);
      const distDir = path.join(dir, 'dist');
      if (!fs.existsSync(distDir)) {
        sendLog('Building project before deploy…\n');
        await spawnWithLogs('npm', ['run', 'build'], { cwd: dir, timeout: 120_000 }, sendLog);
      }

      if (!fs.existsSync(distDir)) {
        return { success: false, error: 'Build did not produce a dist/ folder.' };
      }

      if (provider === 'vercel') {
        return await deployVercelRest(distDir, token, appId, sendLog);
      } else if (provider === 'netlify') {
        return await deployNetlifyRest(distDir, token, appId, sendLog);
      } else {
        return { success: false, error: `Unknown OAuth provider: ${provider}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog(`\nDeploy failed: ${msg}\n`);
      return { success: false, error: msg };
    }
  });

  // ── Vercel REST API deploy ───────────────────────────────────────────
  async function deployVercelRest(
    distDir: string,
    token: string,
    appId: string,
    sendLog: (msg: string) => void,
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    sendLog('Deploying to Vercel via REST API…\n');

    const files: { file: string; data: string }[] = [];
    function collectFiles(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectFiles(path.join(dir, entry.name), rel);
        } else {
          const content = fs.readFileSync(path.join(dir, entry.name));
          files.push({ file: rel, data: content.toString('base64') });
        }
      }
    }
    collectFiles(distDir, '');
    sendLog(`Uploading ${files.length} files…\n`);

    const body = JSON.stringify({
      name: appId,
      files: files.map(f => ({ file: f.file, data: f.data, encoding: 'base64' })),
      projectSettings: { framework: null },
    });

    const result = await httpsRequest({
      hostname: 'api.vercel.com',
      path: '/v13/deployments',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    const data = JSON.parse(result);
    if (data.url) {
      const url = `https://${data.url}`;
      sendLog(`\nDeployed! ${url}\n`);
      return { success: true, url };
    }
    return { success: false, error: data.error?.message ?? 'Unknown Vercel error' };
  }

  // ── Netlify REST API deploy ──────────────────────────────────────────
  async function deployNetlifyRest(
    distDir: string,
    token: string,
    appId: string,
    sendLog: (msg: string) => void,
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    sendLog('Deploying to Netlify via REST API…\n');

    // Collect file digests
    const crypto = await import('node:crypto');
    const fileMap: Record<string, string> = {};
    const fileContents: Record<string, Buffer> = {};

    function collectFiles(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collectFiles(path.join(dir, entry.name), rel);
        } else {
          const content = fs.readFileSync(path.join(dir, entry.name));
          const sha1 = crypto.createHash('sha1').update(content).digest('hex');
          fileMap[`/${rel}`] = sha1;
          fileContents[sha1] = content;
        }
      }
    }
    collectFiles(distDir, '');
    sendLog(`Hashing ${Object.keys(fileMap).length} files…\n`);

    // Create deploy with file list
    const createBody = JSON.stringify({ title: appId, files: fileMap });
    const createResult = await httpsRequest({
      hostname: 'api.netlify.com',
      path: '/api/v1/sites',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(createBody),
      },
    }, createBody);

    const site = JSON.parse(createResult);
    if (!site.id) {
      return { success: false, error: site.message ?? 'Failed to create Netlify site' };
    }

    const siteId = site.id;
    sendLog(`Site created: ${site.ssl_url ?? site.url}\n`);

    // Create deploy
    const deployBody = JSON.stringify({ files: fileMap });
    const deployResult = await httpsRequest({
      hostname: 'api.netlify.com',
      path: `/api/v1/sites/${siteId}/deploys`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(deployBody),
      },
    }, deployBody);

    const deploy = JSON.parse(deployResult);
    const deployId = deploy.id;
    const required: string[] = deploy.required ?? [];

    // Upload required files
    sendLog(`Uploading ${required.length} files…\n`);
    for (const sha of required) {
      const content = fileContents[sha];
      if (!content) continue;
      await httpsRequest({
        hostname: 'api.netlify.com',
        path: `/api/v1/deploys/${deployId}/files/${sha}`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': content.length,
        },
      }, content);
    }

    const url = deploy.ssl_url ?? deploy.url ?? site.ssl_url ?? site.url;
    sendLog(`\nDeployed! ${url}\n`);
    return { success: true, url };
  }

  // ── HTTPS helper ─────────────────────────────────────────────────────
  function httpsRequest(
    options: https.RequestOptions,
    body?: string | Buffer,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
