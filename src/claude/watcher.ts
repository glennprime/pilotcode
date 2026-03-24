import { existsSync, readFileSync, statSync, watch, FSWatcher } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../logger.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

export interface WatchMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'progress';
  text?: string;
  toolName?: string;
  toolInput?: any;
  images?: string[];
}

/**
 * Convert a cwd to the Claude projects slug path.
 */
function cwdToSlug(cwd: string): string {
  return cwd.replace(/[\\\/.: _]/g, '-');
}

/**
 * Find the JSONL file for a given session ID and optional cwd.
 */
export function findSessionFile(sessionId: string, cwd?: string): string | null {
  if (cwd) {
    const slug = cwdToSlug(cwd);
    const filePath = join(CLAUDE_PROJECTS_DIR, slug, `${sessionId}.jsonl`);
    if (existsSync(filePath)) return filePath;
  }

  // Fallback: scan all project dirs
  try {
    const { readdirSync } = require('fs');
    const dirs = readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const filePath = join(CLAUDE_PROJECTS_DIR, d.name, `${sessionId}.jsonl`);
      if (existsSync(filePath)) return filePath;
    }
  } catch {}

  return null;
}

/**
 * Parse JSONL lines into simplified chat messages for display.
 */
export function parseJsonlMessages(lines: string[]): WatchMessage[] {
  const messages: WatchMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      // User messages
      if (obj.type === 'user' && obj.message?.role === 'user') {
        const content = obj.message.content;
        if (typeof content === 'string') {
          // Skip tool_result messages (they contain tool output, not user text)
          messages.push({ type: 'user', text: content });
        } else if (Array.isArray(content)) {
          // Check if this is a tool_result (not a real user message)
          const hasToolResult = content.some((b: any) => b.type === 'tool_result');
          if (hasToolResult) continue;

          const textParts: string[] = [];
          const images: string[] = [];
          for (const block of content) {
            if (block.type === 'text') textParts.push(block.text);
            if (block.type === 'image') images.push(block.source?.data || '');
          }
          if (textParts.length > 0) {
            messages.push({ type: 'user', text: textParts.join('\n'), images: images.length > 0 ? images : undefined });
          }
        }
      }

      // Assistant messages
      if (obj.message?.role === 'assistant' && obj.message?.content) {
        const content = obj.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              messages.push({ type: 'assistant', text: block.text });
            }
            if (block.type === 'tool_use') {
              messages.push({ type: 'tool_use', toolName: block.name, toolInput: block.input });
            }
          }
        }
      }

      // Result/summary messages
      if (obj.type === 'result' && obj.result) {
        // Skip — these are token summaries, not displayable
      }

    } catch {
      // Skip unparseable lines
    }
  }

  return messages;
}

/**
 * Read a JSONL session file and return parsed messages.
 */
export function readSessionFile(filePath: string): { messages: WatchMessage[]; byteOffset: number } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const messages = parseJsonlMessages(lines);
    return { messages, byteOffset: Buffer.byteLength(content, 'utf-8') };
  } catch {
    return { messages: [], byteOffset: 0 };
  }
}

/**
 * Watch a JSONL file for new content and call the callback with new messages.
 * Returns a cleanup function.
 */
export function watchSessionFile(
  filePath: string,
  startOffset: number,
  onNewMessages: (messages: WatchMessage[]) => void
): () => void {
  let lastOffset = startOffset;
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;

  const checkForNewContent = () => {
    try {
      const stat = statSync(filePath);
      if (stat.size <= lastOffset) return;

      // Read only new bytes
      const { openSync, readSync, closeSync } = require('fs');
      const newSize = stat.size - lastOffset;
      const buf = Buffer.alloc(newSize);
      const fd = openSync(filePath, 'r');
      readSync(fd, buf, 0, newSize, lastOffset);
      closeSync(fd);

      lastOffset = stat.size;

      const newContent = buf.toString('utf-8');
      const lines = newContent.split('\n').filter(l => l.trim());
      if (lines.length === 0) return;

      const messages = parseJsonlMessages(lines);
      if (messages.length > 0) {
        onNewMessages(messages);
      }
    } catch (err) {
      log('watcher', `Error reading new content: ${err}`, 'warn');
    }
  };

  try {
    watcher = watch(filePath, () => {
      // Debounce: JSONL writes can come in bursts
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkForNewContent, 200);
    });

    log('watcher', `Watching: ${filePath}`);
  } catch (err) {
    log('watcher', `Failed to watch: ${err}`, 'warn');
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    log('watcher', `Stopped watching: ${filePath}`);
  };
}
