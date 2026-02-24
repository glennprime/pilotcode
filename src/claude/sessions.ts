import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { sessionLog } from '../logger.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// UUID v4 pattern for validating session filenames
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ExternalSession {
  id: string;
  cwd: string;
  projectSlug: string;
  lastModified: string;
  sizeBytes: number;
  summary: string;
}

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

/**
 * Read the first ~8KB of a .jsonl file and extract lightweight metadata.
 * Returns null if the file isn't a valid session.
 */
function extractSessionMeta(filePath: string, sessionId: string, projectSlug: string): ExternalSession | null {
  try {
    const stat = statSync(filePath);
    const buf = Buffer.alloc(Math.min(8192, stat.size));
    const fd = openSync(filePath, 'r');
    readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const head = buf.toString('utf-8');

    // Must have conversation markers to be a real session
    if (!head.includes('"uuid"') && !head.includes('"messageId"') && !head.includes('"leafUuid"')) {
      return null;
    }

    // Try to extract cwd from early JSON lines
    let cwd = '';
    let summary = '';
    const lines = head.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        // Extract cwd from system or init messages
        if (obj.cwd && !cwd) {
          cwd = obj.cwd;
        }
        // Extract first user message as summary
        if (!summary && obj.type === 'user' && obj.message?.content) {
          const content = obj.message.content;
          if (typeof content === 'string') {
            summary = content.slice(0, 80);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: any) => b.type === 'text');
            if (textBlock) summary = textBlock.text.slice(0, 80);
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    // Fallback: reverse the slug to approximate cwd
    if (!cwd) {
      cwd = '/' + projectSlug.replace(/^-/, '').replace(/-/g, '/');
    }

    return {
      id: sessionId,
      cwd,
      projectSlug,
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      summary: summary || '(no preview)',
    };
  } catch {
    return null;
  }
}

/**
 * Discover Claude Code sessions from ~/.claude/projects/ that are NOT
 * already tracked in PilotCode. Returns sessions sorted by mtime descending,
 * capped at 50.
 */
export function discoverExternalSessions(knownSessionIds: string[]): ExternalSession[] {
  const knownSet = new Set(knownSessionIds);
  const results: ExternalSession[] = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) return results;

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of projectDirs) {
      const projectPath = join(CLAUDE_PROJECTS_DIR, dir.name);
      try {
        const files = readdirSync(projectPath)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => f.replace('.jsonl', ''))
          .filter((name) => UUID_RE.test(name))
          .filter((name) => !knownSet.has(name));

        for (const sessionId of files) {
          const filePath = join(projectPath, `${sessionId}.jsonl`);
          const meta = extractSessionMeta(filePath, sessionId, dir.name);
          if (meta) results.push(meta);
        }
      } catch { /* skip unreadable directories */ }
    }
  } catch (err) {
    sessionLog('DISCOVER_EXTERNAL', { error: String(err) });
  }

  // Sort by most recently modified first, cap at 50
  results.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
  return results.slice(0, 50);
}

/**
 * Find a session by UUID across all project directories.
 * Returns { cwd, sessionId } if found, null otherwise.
 */
export function findSessionById(sessionId: string): { cwd: string; sessionId: string } | null {
  if (!UUID_RE.test(sessionId) || !existsSync(CLAUDE_PROJECTS_DIR)) return null;

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of projectDirs) {
      const filePath = join(CLAUDE_PROJECTS_DIR, dir.name, `${sessionId}.jsonl`);
      if (existsSync(filePath)) {
        // Extract cwd from the file
        const meta = extractSessionMeta(filePath, sessionId, dir.name);
        if (meta) {
          return { cwd: meta.cwd, sessionId };
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}
