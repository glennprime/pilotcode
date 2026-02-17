import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
import { timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionManager } from '../claude/manager.js';
import { ClaudeProcess } from '../claude/process.js';
import { getAuthToken, IMAGES_DIR } from '../config.js';
import type { ContentBlock, ImageBlock, SDKMessage } from '../claude/types.js';

interface WSMessage {
  type: string;
  [key: string]: any;
}

export function setupWebSocket(wss: WebSocketServer, manager: SessionManager): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Auth check
    const cookies = parseCookie(req.headers.cookie || '');
    const token = cookies.pilotcode_token;
    if (!token || !verifyToken(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    let currentProc: ClaudeProcess | null = null;
    let currentSessionId: string | null = null;

    ws.on('message', (raw) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      switch (msg.type) {
        case 'create_session':
          handleCreateSession(ws, msg, manager, (proc, sid) => {
            currentProc = proc;
            currentSessionId = sid;
          });
          break;

        case 'resume_session':
          handleResumeSession(ws, msg, manager, (proc, sid) => {
            currentProc = proc;
            currentSessionId = sid;
          });
          break;

        case 'message':
          handleUserMessage(ws, msg, currentProc);
          break;

        case 'permission_response':
          handlePermissionResponse(msg, currentProc);
          break;

        case 'interrupt':
          currentProc?.interrupt();
          break;

        default:
          ws.send(JSON.stringify({ type: 'error', error: `Unknown type: ${msg.type}` }));
      }
    });

    ws.on('close', () => {
      // Don't kill the process on disconnect — allow reconnection
    });
  });
}

function handleCreateSession(
  ws: WebSocket,
  msg: WSMessage,
  manager: SessionManager,
  setCurrent: (proc: ClaudeProcess, sid: string) => void
): void {
  const cwd = msg.cwd || process.cwd();
  const name = msg.name || 'New Session';

  const proc = manager.createProcess({ cwd, model: msg.model });
  wireProcess(ws, proc, manager, name, cwd, setCurrent);
}

function handleResumeSession(
  ws: WebSocket,
  msg: WSMessage,
  manager: SessionManager,
  setCurrent: (proc: ClaudeProcess, sid: string) => void
): void {
  const { sessionId } = msg;
  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', error: 'sessionId required' }));
    return;
  }

  // Check if process is already running
  let proc = manager.getProcess(sessionId);
  if (proc && proc.isAlive) {
    setCurrent(proc, sessionId);
    ws.send(JSON.stringify({ type: 'session_resumed', sessionId }));
    // Re-wire output
    wireExistingProcess(ws, proc);
    return;
  }

  // Spawn new process to resume the session
  const sessions = manager.loadSessions();
  const meta = sessions.find((s) => s.id === sessionId);
  const cwd = meta?.cwd || process.cwd();
  const name = meta?.name || 'Resumed Session';

  proc = manager.createProcess({ cwd, resume: sessionId });
  wireProcess(ws, proc, manager, name, cwd, setCurrent);
}

function wireProcess(
  ws: WebSocket,
  proc: ClaudeProcess,
  manager: SessionManager,
  name: string,
  cwd: string,
  setCurrent: (proc: ClaudeProcess, sid: string) => void
): void {
  proc.on('message', (msg: SDKMessage) => {
    // Capture session ID from init
    if (msg.type === 'system' && msg.session_id) {
      const sid = msg.session_id;
      setCurrent(proc, sid);
      manager.saveSession({
        id: sid,
        name,
        cwd,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      });
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  proc.on('stderr', (text: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', log: { level: 'debug', message: text } }));
    }
  });

  proc.on('close', (code: number) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'process_exit', code }));
    }
  });

  proc.on('error', (err: Error) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });
}

function wireExistingProcess(ws: WebSocket, proc: ClaudeProcess): void {
  proc.on('message', (msg: SDKMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });
}

function handleUserMessage(ws: WebSocket, msg: WSMessage, proc: ClaudeProcess | null): void {
  if (!proc || !proc.isAlive) {
    ws.send(JSON.stringify({ type: 'error', error: 'No active session. Create or resume one first.' }));
    return;
  }

  const text = msg.content || '';
  const images: string[] = msg.images || [];

  if (images.length > 0) {
    // Build content blocks with images
    const blocks: ContentBlock[] = [];
    for (const filename of images) {
      try {
        const imgPath = join(IMAGES_DIR, filename);
        const data = readFileSync(imgPath).toString('base64');
        const ext = filename.split('.').pop()?.toLowerCase() || 'jpeg';
        const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        } as ImageBlock);
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: `Failed to read image: ${filename}` }));
      }
    }
    if (text) {
      blocks.push({ type: 'text', text });
    }
    proc.sendMessage(blocks);
  } else {
    proc.sendMessage(text);
  }
}

function handlePermissionResponse(msg: WSMessage, proc: ClaudeProcess | null): void {
  if (!proc || !proc.isAlive) return;
  proc.respondToPermission(msg.request_id, msg.allow === true);
}

function verifyToken(token: string): boolean {
  const expected = getAuthToken();
  if (token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
