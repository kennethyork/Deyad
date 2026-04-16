import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { debugLog } from './debug.js';

export interface Config {
  model?: string;
  autoApprove?: boolean;
  noThink?: boolean;
  maxIterations?: number;
  temperature?: number;
  contextSize?: number;
  ollamaHost?: string;
  gitAutoCommit?: boolean;
  allowedTools?: string[];
  restrictedTools?: string[];
}

const configDir = path.join(os.homedir(), '.deyad');
const configPath = path.join(configDir, 'config.json');

export function loadConfig(): Config {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as Config;
    return {
      model: parsed.model,
      autoApprove: parsed.autoApprove ?? false,
      noThink: parsed.noThink ?? false,
      maxIterations: parsed.maxIterations ?? 30,
      temperature: parsed.temperature ?? 0.3,
      contextSize: parsed.contextSize, // undefined unless set in config, so cli.ts will auto-detect
      ollamaHost: parsed.ollamaHost ?? 'http://127.0.0.1:11434',
      gitAutoCommit: parsed.gitAutoCommit ?? true,
      allowedTools: parsed.allowedTools ?? [],
      restrictedTools: parsed.restrictedTools ?? [],
    };
  } catch (e) {
    debugLog('config load failed: %s', (e as Error).message);
    return {};
  }
}

export function saveConfig(config: Config): void {
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
  } catch (err) {
    console.error(`Failed to save config: ${err}`);
  }
}

export function getConfigPath(): string {
  return configPath;
}
