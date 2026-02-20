import { appendFileSync, existsSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from './config.js';

const LOG_FILE = join(DATA_DIR, 'pilotcode.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB, then rotate

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

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
    // Rotate if too large
    if (existsSync(LOG_FILE)) {
      const stat = statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE + '.old';
        try { renameSync(LOG_FILE, rotated); } catch {}
      }
    }
    appendFileSync(LOG_FILE, line);
  } catch {}
}
