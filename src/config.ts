import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const PORT = parseInt(process.env.PILOTCODE_PORT || '3456', 10);
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
  writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2));
  console.log(`\n  Auth token generated: ${token}\n`);
  return token;
}
