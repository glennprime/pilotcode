import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
import { timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionManager } from '../claude/manager.js';
import { ClaudeProcess } from '../claude/process.js';
import { getAuthToken, IMAGES_DIR, DEFAULT_CWD } from '../config.js';
import type { ContentBlock, ImageBlock, SDKMessage } from '../claude/types.js';

interface WSMessage {
  type: string;
  [key: string]: any;
}

// Track all connected clients per session for broadcasting
const sessionClients = new Map<string, Set<WebSocket>>();

function broadcast(sessionId: string, data: string, exclude?: WebSocket): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function broadcastAll(sessionId: string, data: string): void {
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function addClient(sessionId: string, ws: WebSocket): void {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Set());
  }
  sessionClients.get(sessionId)!.add(ws);
}

function removeClient(ws: WebSocket): void {
  for (const [sid, clients] of sessionClients) {
    clients.delete(ws);
    if (clients.size === 0) sessionClients.delete(sid);
  }
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
            if (currentSessionId) removeClient(ws);
            currentSessionId = sid;
            addClient(sid, ws);
          });
          break;

        case 'resume_session':
          handleResumeSession(ws, msg, manager, (proc, sid) => {
            currentProc = proc;
            if (currentSessionId) removeClient(ws);
            currentSessionId = sid;
            addClient(sid, ws);
          });
          break;

        case 'message':
          handleUserMessage(ws, msg, currentProc, currentSessionId);
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
      removeClient(ws);
    });
  });
}

function handleCreateSession(
  ws: WebSocket,
  msg: WSMessage,
  manager: SessionManager,
  setCurrent: (proc: ClaudeProcess, sid: string) => void
): void {
  const cwd = msg.cwd || DEFAULT_CWD;
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
    wireExistingProcess(ws, proc, sessionId);
    return;
  }

  // Spawn new process to resume the session
  const sessions = manager.loadSessions();
  const meta = sessions.find((s) => s.id === sessionId);
  const cwd = meta?.cwd || process.cwd();
  const name = meta?.name || 'Resumed Session';

  proc = manager.createProcess({ cwd, resume: sessionId });
  wireProcess(ws, proc, manager, name, cwd, setCurrent, sessionId);
}

function wireProcess(
  ws: WebSocket,
  proc: ClaudeProcess,
  manager: SessionManager,
  name: string,
  cwd: string,
  setCurrent: (proc: ClaudeProcess, sid: string) => void,
  replacesSessionId?: string
): void {
  let sessionId: string | null = null;

  proc.on('message', (msg: SDKMessage) => {
    if (msg.type === 'system' && msg.session_id) {
      const sid = msg.session_id;
      sessionId = sid;
      setCurrent(proc, sid);

      if (replacesSessionId && replacesSessionId !== sid) {
        const sessions = manager.loadSessions();
        const existing = sessions.find((s) => s.id === replacesSessionId);
        if (existing) {
          existing.id = sid;
          existing.lastUsed = new Date().toISOString();
          manager.saveSessions(sessions);
        } else {
          manager.saveSession({ id: sid, name, cwd, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() });
        }
        manager.registerProcess(sid, proc);

        // Migrate clients from old session ID to new
        const oldClients = sessionClients.get(replacesSessionId);
        if (oldClients) {
          for (const c of oldClients) addClient(sid, c);
          sessionClients.delete(replacesSessionId);
        }
      } else {
        manager.saveSession({ id: sid, name, cwd, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() });
      }

      // Broadcast session ID update to all clients
      broadcastAll(sid, JSON.stringify({ type: 'session_id_update', oldSessionId: replacesSessionId || sid, newSessionId: sid }));
    }

    // Broadcast all Claude messages to every client on this session
    if (sessionId) {
      broadcastAll(sessionId, JSON.stringify(msg));
    } else if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  proc.on('stderr', (text: string) => {
    // Only send to originating client (debug noise)
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', log: { level: 'debug', message: text } }));
    }
  });

  proc.on('close', (code: number) => {
    if (sessionId) {
      broadcastAll(sessionId, JSON.stringify({ type: 'process_exit', code }));
    }
  });

  proc.on('error', (err: Error) => {
    if (sessionId) {
      broadcastAll(sessionId, JSON.stringify({ type: 'error', error: err.message }));
    }
  });
}

function wireExistingProcess(ws: WebSocket, proc: ClaudeProcess, sessionId: string): void {
  proc.on('message', (msg: SDKMessage) => {
    broadcastAll(sessionId, JSON.stringify(msg));
  });
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function handleUserMessage(ws: WebSocket, msg: WSMessage, proc: ClaudeProcess | null, sessionId: string | null): void {
  if (!proc || !proc.isAlive) {
    ws.send(JSON.stringify({ type: 'error', error: 'No active session. Create or resume one first.' }));
    return;
  }

  const text = msg.content || '';
  const files: string[] = msg.images || [];

  // Broadcast the user message to other clients so they see it in real-time
  if (sessionId) {
    broadcast(sessionId, JSON.stringify({
      type: 'user_broadcast',
      content: text,
      images: files,
    }), ws);
  }

  if (files.length > 0) {
    const blocks: ContentBlock[] = [];
    const docPaths: string[] = [];

    for (const filename of files) {
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const filePath = join(IMAGES_DIR, filename);

      if (IMAGE_EXTENSIONS.has(ext)) {
        // Send images as base64 content blocks
        try {
          const data = readFileSync(filePath).toString('base64');
          const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data },
          } as ImageBlock);
        } catch {
          ws.send(JSON.stringify({ type: 'error', error: `Failed to read image: ${filename}` }));
        }
      } else {
        // For documents (PDF, Excel, etc.), tell Claude the file path so it can read it
        docPaths.push(filePath);
      }
    }

    // Build the text content with document references
    let fullText = text;
    if (docPaths.length > 0) {
      const fileList = docPaths.map((p) => `File: ${p}`).join('\n');
      fullText = fullText
        ? `${fullText}\n\nI've attached the following file(s) — please read and analyze them:\n${fileList}`
        : `I've attached the following file(s) — please read and analyze them:\n${fileList}`;
    }

    if (fullText) {
      blocks.push({ type: 'text', text: fullText });
    }

    proc.sendMessage(blocks.length > 0 ? blocks : fullText);
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
