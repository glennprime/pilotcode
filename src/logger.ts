import { appendFileSync, existsSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from './config.js';

const LOG_FILE = join(DATA_DIR, 'pilotcode.log');
const SESSION_LOG_FILE = join(DATA_DIR, 'sessions.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB, then rotate

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function rotateIfNeeded(file: string): void {
  try {
    if (existsSync(file)) {
      const stat = statSync(file);
      if (stat.size > MAX_LOG_SIZE) {
        try { renameSync(file, file + '.old'); } catch {}
      }
    }
  } catch {}
}

export function log(category: string, message: string, level: LogLevel = 'info'): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] [${category}] ${message}\n`;

  // Always print to stdout/stderr
  if (level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }

  // Write to log file
  try {
    rotateIfNeeded(LOG_FILE);
    appendFileSync(LOG_FILE, line);
  } catch {}
}

/**
 * Dedicated session lifecycle log.
 * Only logs session events: create, resume, switch, ID changes, errors, exits.
 * Easy to read — one file focused on what matters for debugging sessions.
 */
export function sessionLog(event: string, details: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const shortId = (id: unknown) => typeof id === 'string' ? id.slice(0, 8) : String(id);

  // Format: timestamp EVENT key=value key=value
  const parts = Object.entries(details)
    .map(([k, v]) => {
      if (k.toLowerCase().includes('id') && typeof v === 'string' && v.length > 12) {
        return `${k}=${shortId(v)}`;
      }
      return `${k}=${v}`;
    })
    .join(' ');

  const line = `${ts} ${event} ${parts}\n`;

  // Print to stdout
  process.stdout.write(`[SESSION] ${line}`);

  // Write to dedicated session log
  try {
    rotateIfNeeded(SESSION_LOG_FILE);
    appendFileSync(SESSION_LOG_FILE, line);
  } catch {}
}
