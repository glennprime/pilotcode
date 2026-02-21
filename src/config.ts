import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const PORT = parseInt(process.env.PILOTCODE_PORT || '3456', 10);
export const DEFAULT_CWD = process.env.PILOTCODE_CWD || process.env.HOME || '/tmp';
export const DATA_DIR = join(import.meta.dirname, '..', 'data');
export const IMAGES_DIR = join(DATA_DIR, 'images');
export const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');
export const CONFIG_FILE = join(DATA_DIR, 'config.json');

// Ensure data dirs exist
mkdirSync(IMAGES_DIR, { recursive: true });

export function getAuthToken(): string {
  if (process.env.PILOTCODE_TOKEN) {
    return process.env.PILOTCODE_TOKEN;
  }

  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    if (config.token) return config.token;
  }

  const token = randomBytes(16).toString('hex');
  const config: Record<string, unknown> = existsSync(CONFIG_FILE)
    ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    : {};
  config.token = token;
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`\n  Auth token generated: ${token}\n`);
  return token;
}

export function getNtfyTopic(): string | null {
  if (process.env.NTFY_TOPIC) return process.env.NTFY_TOPIC;
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    if (config.ntfyTopic) return config.ntfyTopic;
  }
  return null;
}

export function setNtfyTopic(topic: string | null): void {
  const config: Record<string, unknown> = existsSync(CONFIG_FILE)
    ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    : {};
  if (topic) {
    config.ntfyTopic = topic;
  } else {
    delete config.ntfyTopic;
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
