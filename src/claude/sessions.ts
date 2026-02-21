import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { sessionLog } from '../logger.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// UUID v4 pattern for validating session filenames
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Convert a working directory to Claude's project directory path.
 * e.g. /Users/glennprime/Dev/infinitetrax → ~/.claude/projects/-Users-glennprime-Dev-infinitetrax
 */
export function getProjectPath(cwd: string): string {
  const resolved = resolve(cwd);
  const slug = resolved.replace(/[\\\/.: _]/g, '-');
  return join(CLAUDE_PROJECTS_DIR, slug);
}

/**
 * Check if a .jsonl session file is valid (has real conversation content).
 * Looks for messages with uuid, messageId, or leafUuid fields.
 */
function isValidSessionFile(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Check for conversation markers in the JSONL
    return content.includes('"uuid"') || content.includes('"messageId"') || content.includes('"leafUuid"');
  } catch {
    return false;
  }
}

/**
 * Validate a session ID and find the best session to resume for a given project.
 *
 * 1. If the requested sessionId has a valid .jsonl file, return it.
 * 2. Otherwise, scan all .jsonl files in the project dir, filter to valid UUIDs,
 *    validate each, and return the most recently modified one.
 * 3. If nothing valid is found, return null.
 */
export function findValidSession(sessionId: string, cwd: string): string | null {
  const projectDir = getProjectPath(cwd);

  if (!existsSync(projectDir)) {
    sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'project_dir_not_found', projectDir });
    return null;
  }

  // 1. Check if the requested session file exists and is valid
  const requestedFile = join(projectDir, `${sessionId}.jsonl`);
  if (existsSync(requestedFile) && isValidSessionFile(requestedFile)) {
    sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'exact_match' });
    return sessionId;
  }

  // 2. Scan for the most recent valid session in this project
  sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'scanning_fallback', projectDir });

  try {
    const files = readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace('.jsonl', ''))
      .filter((name) => UUID_RE.test(name));

    if (files.length === 0) {
      sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'no_jsonl_files' });
      return null;
    }

    // Sort by modification time (most recent first)
    const sorted = files
      .map((name) => ({
        name,
        path: join(projectDir, `${name}.jsonl`),
      }))
      .filter((f) => isValidSessionFile(f.path))
      .sort((a, b) => {
        try {
          return statSync(b.path).mtimeMs - statSync(a.path).mtimeMs;
        } catch {
          return 0;
        }
      });

    if (sorted.length > 0) {
      const fallbackId = sorted[0].name;
      sessionLog('VALIDATE_SESSION', {
        sessionId, cwd, result: 'fallback_found',
        fallbackId, totalScanned: files.length, validCount: sorted.length,
      });
      return fallbackId;
    }
  } catch (err) {
    sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'scan_error', error: String(err) });
  }

  sessionLog('VALIDATE_SESSION', { sessionId, cwd, result: 'no_valid_sessions' });
  return null;
}
