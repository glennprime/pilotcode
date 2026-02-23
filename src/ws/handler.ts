import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
import { timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SessionManager } from '../claude/manager.js';
import { ClaudeProcess } from '../claude/process.js';
import { getAuthToken, IMAGES_DIR, DEFAULT_CWD, DATA_DIR } from '../config.js';
import type { ContentBlock, ImageBlock, SDKMessage } from '../claude/types.js';
import { findValidSession } from '../claude/sessions.js';
import { log, sessionLog } from '../logger.js';
import { getNtfyTopic } from '../config.js';

const HISTORY_DIR = join(DATA_DIR, 'history');
mkdirSync(HISTORY_DIR, { recursive: true });

interface WSMessage {
  type: string;
  [key: string]: any;
}

interface BroadcastWireOptions {
  proc: ClaudeProcess;
  knownSessionId: string | null;
  manager: SessionManager;
  name: string;
  cwd: string;
  model?: string;
  replacesSessionId?: string;
  setCurrent?: (proc: ClaudeProcess, sid: string) => void;
  originWs?: WebSocket | null;
}

// Track all connected clients per session for broadcasting
const sessionClients = new Map<string, Set<WebSocket>>();

// Cache pending permission request inputs so we can send them back as updatedInput
const pendingPermissionInputs = new Map<string, unknown>();

// Track pending interactive tool prompts (ExitPlanMode, AskUserQuestion) per session.
// These tools fail in stream-json mode — the CLI returns error tool_results internally.
// We intercept the tool_use, show UI to the user, and suppress all retry noise.
interface PendingInteractive {
  type: 'plan' | 'question';
  cardShown: boolean; // only show the UI card once, suppress retries
  interrupted: boolean; // true after we sent interrupt — suppress ALL noise until user responds
}
const pendingInteractive = new Map<string, PendingInteractive>();

// Known error strings the CLI returns for interactive tools in stream-json mode
const INTERACTIVE_ERRORS = new Set(['Exit plan mode?', 'Answer questions?', 'Entered plan mode']);

// Track crash retry state per session
const crashRetries = new Map<string, { count: number; firstAttempt: number }>();
const MAX_CRASH_RETRIES = 3;
const CRASH_RETRY_WINDOW = 60_000; // reset retry count after 60s

// Buffer recent messages per session so clients can catch up after switching
const MESSAGE_BUFFER_SIZE = 100;
const sessionMessageBuffers = new Map<string, string[]>();

// Unified session busy state: 'idle' | 'busy' | 'permission'
export type SessionBusyState = 'idle' | 'busy' | 'permission';
const sessionBusyStates = new Map<string, SessionBusyState>();

// Track whether a session was busy when its process last exited.
// Used to decide whether to tell Claude to continue or wait on resume.
const sessionExitWasBusy = new Map<string, boolean>();

export function getSessionBusyState(sessionId: string): SessionBusyState {
  return sessionBusyStates.get(sessionId) || 'idle';
}

/**
 * Convenience export for API layer — returns true if session is doing work.
 * This is the ONLY busy tracking — there is no separate boolean map.
 */
export const sessionBusyState = {
  get(sessionId: string): boolean {
    const state = sessionBusyStates.get(sessionId);
    return state === 'busy' || state === 'permission';
  },
};

// Reference to WebSocketServer for global broadcasts
let wssRef: WebSocketServer | null = null;

/** Send to ALL connected WebSocket clients (not session-specific). */
function broadcastGlobal(data: string): void {
  if (!wssRef) return;
  for (const client of wssRef.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/** Update session busy state and broadcast change to all clients. */
function setSessionBusy(sessionId: string, state: SessionBusyState): void {
  const prev = sessionBusyStates.get(sessionId) || 'idle';
  sessionBusyStates.set(sessionId, state);
  const wasBusy = prev === 'busy' || prev === 'permission';
  const isBusy = state === 'busy' || state === 'permission';
  if (wasBusy !== isBusy) {
    broadcastGlobal(JSON.stringify({ type: 'session_status', sessionId, busy: isBusy }));
  }
}

// Track which processes already have broadcast listeners attached.
// This prevents adding duplicate listeners and ensures every process
// that needs one gets wired — even after server restart.
const wiredProcesses = new WeakSet<ClaudeProcess>();

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

// Message types that are relevant for buffer replay on rejoin/resume
const REPLAY_TYPES = new Set(['assistant', 'user', 'result', 'control_request', 'control_cancel_request', 'plan_approval', 'user_question']);

/**
 * Tag a message with its session ID so clients can filter by session.
 * This is the core fix for session cross-contamination.
 */
function tagMessage(sessionId: string, data: string): string {
  try {
    const parsed = JSON.parse(data);
    parsed._sid = sessionId;
    return JSON.stringify(parsed);
  } catch {
    return data;
  }
}

function bufferMessage(sessionId: string, data: string): void {
  if (!sessionMessageBuffers.has(sessionId)) {
    sessionMessageBuffers.set(sessionId, []);
  }
  const buf = sessionMessageBuffers.get(sessionId)!;
  buf.push(data);
  if (buf.length > MESSAGE_BUFFER_SIZE) {
    buf.splice(0, buf.length - MESSAGE_BUFFER_SIZE);
  }
}

function getBufferedMessages(sessionId: string): string[] {
  return sessionMessageBuffers.get(sessionId) || [];
}

/**
 * Replay buffered messages to a client that is rejoining a session.
 * Only sends display-relevant message types (assistant, user, result, etc.).
 */
function replayBufferedMessages(ws: WebSocket, sessionId: string): void {
  const buffered = getBufferedMessages(sessionId);
  sessionLog('BUFFER_REPLAY', { sessionId, bufferedCount: buffered.length });
  for (const raw of buffered) {
    try {
      const parsed = JSON.parse(raw);
      if (REPLAY_TYPES.has(parsed.type) && ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    } catch {}
  }
}

/** Copy history file from old session ID to new session ID (server-side). */
function migrateHistory(oldId: string, newId: string): void {
  if (oldId === newId) return;
  try {
    const oldFile = join(HISTORY_DIR, `${oldId}.json`);
    const newFile = join(HISTORY_DIR, `${newId}.json`);
    if (existsSync(oldFile)) {
      const data = readFileSync(oldFile, 'utf-8');
      // Only copy if old file has real content
      if (data.length > 2) {
        writeFileSync(newFile, data);
        log('ws', `Migrated history: ${oldId.slice(0, 8)} → ${newId.slice(0, 8)}`);
      }
    }
    // Also migrate message buffer
    const oldBuf = sessionMessageBuffers.get(oldId);
    if (oldBuf && oldBuf.length > 0) {
      sessionMessageBuffers.set(newId, oldBuf);
      sessionMessageBuffers.delete(oldId);
    }
  } catch (err) {
    log('ws', `History migration failed: ${err}`, 'warn');
  }
}

/** Send to all clients in a session EXCEPT the excluded one. Tags with _sid. */
function broadcast(sessionId: string, data: string, exclude?: WebSocket): void {
  const tagged = tagMessage(sessionId, data);
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(tagged);
    }
  }
}

/** Send to ALL clients in a session and buffer the message. Tags with _sid. */
function broadcastAll(sessionId: string, data: string): void {
  const tagged = tagMessage(sessionId, data);
  bufferMessage(sessionId, tagged);
  const clients = sessionClients.get(sessionId);
  if (!clients) return;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(tagged);
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

/**
 * Detach a WebSocket from its current session and reset local tracking state.
 * Called before create/resume/rejoin to prevent cross-contamination.
 */
function detachFromSession(
  ws: WebSocket,
  state: { currentProc: ClaudeProcess | null; currentSessionId: string | null; pendingProc: ClaudeProcess | null }
): void {
  removeClient(ws);
  state.currentSessionId = null;
  state.currentProc = null;
  state.pendingProc = null;
}

export function setupWebSocket(wss: WebSocketServer, manager: SessionManager): void {
  wssRef = wss;

  // Heartbeat: ping all clients every 30s, terminate unresponsive ones
  const HEARTBEAT_INTERVAL = 30_000;
  const aliveClients = new WeakSet<WebSocket>();

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!aliveClients.has(ws)) {
        ws.terminate();
        removeClient(ws);
        continue;
      }
      aliveClients.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    log('ws', `New connection from ${clientIp}`);

    // Auth check
    const cookies = parseCookie(req.headers.cookie || '');
    const token = cookies.pilotcode_token;
    if (!token || !verifyToken(token)) {
      log('ws', `Auth failed for ${clientIp}`, 'warn');
      ws.close(4001, 'Unauthorized');
      return;
    }
    log('ws', `Auth OK for ${clientIp}`);

    // Mark alive on connect and on every pong
    aliveClients.add(ws);
    ws.on('pong', () => aliveClients.add(ws));

    // Mutable connection state — tracks what session/process this WebSocket is bound to.
    // Using an object so detachFromSession can reset all fields in one place.
    const connState = {
      currentProc: null as ClaudeProcess | null,
      currentSessionId: null as string | null,
      // Track the process even before setCurrent fires (during init).
      // This prevents messages from being silently dropped if the user
      // types before Claude's system message arrives.
      pendingProc: null as ClaudeProcess | null,
    };

    /** Callback for when a session is fully initialized (system message received). */
    function onSessionReady(proc: ClaudeProcess, sid: string, action: string): void {
      connState.currentProc = proc;
      connState.pendingProc = null;
      connState.currentSessionId = sid;
      addClient(sid, ws);
      log('ws', `Session ${action}: ${sid}`);
    }

    ws.on('message', (raw) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      log('ws', `Received: ${msg.type}${msg.sessionId ? ` (session: ${msg.sessionId})` : ''}`);

      switch (msg.type) {
        case 'create_session':
          detachFromSession(ws, connState);
          handleCreateSession(ws, msg, manager, (proc, sid) => {
            onSessionReady(proc, sid, 'created');
          }, (proc) => { connState.pendingProc = proc; });
          break;

        case 'resume_session':
          detachFromSession(ws, connState);
          handleResumeSession(ws, msg, manager, (proc, sid) => {
            onSessionReady(proc, sid, 'resumed');
          }, (proc) => { connState.pendingProc = proc; });
          break;

        case 'rejoin_session':
          detachFromSession(ws, connState);
          handleRejoinSession(ws, msg, manager, (proc, sid) => {
            onSessionReady(proc, sid, 'rejoined');
          });
          break;

        case 'message':
          // Use pendingProc as fallback if session init hasn't completed yet
          handleUserMessage(ws, msg, connState.currentProc || connState.pendingProc, connState.currentSessionId);
          break;

        case 'permission_response':
          handlePermissionResponse(msg, connState.currentProc);
          break;

        case 'plan_response':
          handlePlanResponse(msg, connState.currentProc, connState.currentSessionId);
          break;

        case 'question_response':
          handleQuestionResponse(msg, connState.currentProc, connState.currentSessionId);
          break;

        case 'interrupt':
          connState.currentProc?.interrupt();
          log('ws', `Interrupt sent for session ${connState.currentSessionId}`);
          break;

        default:
          log('ws', `Unknown message type: ${msg.type}`, 'warn');
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
  setCurrent: (proc: ClaudeProcess, sid: string) => void,
  onProcSpawned?: (proc: ClaudeProcess) => void
): void {
  const cwd = msg.cwd || DEFAULT_CWD;
  const name = msg.name || 'New Session';
  const model = msg.model || undefined;

  sessionLog('CREATE', { name, cwd, model: model || 'default' });
  const proc = manager.createProcess({ cwd, model });
  if (onProcSpawned) onProcSpawned(proc);
  ensureBroadcastWired({
    proc, knownSessionId: null, manager, name, cwd,
    model, setCurrent, originWs: ws,
  });

  // Claude CLI (2.1.49+) with --input-format stream-json won't emit the
  // system init message until it receives the first user message on stdin.
  // Send the initial message immediately to kick-start the session.
  const initMessage = msg.initialMessage || 'hello';
  proc.sendMessage(initMessage);
}

function handleResumeSession(
  ws: WebSocket,
  msg: WSMessage,
  manager: SessionManager,
  setCurrent: (proc: ClaudeProcess, sid: string) => void,
  onProcSpawned?: (proc: ClaudeProcess) => void
): void {
  const { sessionId } = msg;
  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', error: 'sessionId required' }));
    return;
  }

  // Check if process is already running (follows alias chain)
  let proc = manager.getProcess(sessionId);
  if (proc && proc.isAlive) {
    // Use the process's actual session ID for client tracking — after ID_DRIFT
    // the broadcast loop uses proc.sessionId, not the originally requested ID.
    const actualSid = proc.sessionId || sessionId;
    sessionLog('RESUME_FOUND_ALIVE', { requestedId: sessionId, actualSid, processSessionId: proc.sessionId || 'unknown' });
    setCurrent(proc, actualSid);
    if (onProcSpawned) onProcSpawned(proc);
    // Also add client under the requested ID in case broadcasts still use it
    addClient(actualSid, ws);
    if (actualSid !== sessionId) addClient(sessionId, ws);
    const busyState = getSessionBusyState(actualSid);
    const isBusy = busyState !== 'idle';
    ws.send(JSON.stringify({ type: 'session_rejoined', sessionId: actualSid, busy: isBusy }));
    replayBufferedMessages(ws, actualSid);
    // Send busy status AFTER replay so it doesn't get hidden by replayed assistant messages
    if (isBusy) {
      ws.send(JSON.stringify({ type: 'session_busy', sessionId: actualSid, state: busyState }));
    }
    wireExistingProcess(ws, proc, actualSid, manager);
    return;
  }

  // Spawn new process to resume the session
  const sessions = manager.loadSessions();
  const meta = sessions.find((s) => s.id === sessionId);
  if (!meta) {
    sessionLog('RESUME_UNKNOWN', { sessionId, reason: 'not_in_sessions_json' });
    ws.send(JSON.stringify({ type: 'error', error: 'Session not found.' }));
    return;
  }
  const cwd = meta.cwd;
  const name = meta.name;
  const model = meta.model;

  // Validate the session ID against Claude's .jsonl files before spawning
  const validId = findValidSession(sessionId, cwd);

  if (validId) {
    // Resume a valid session (may be a different ID than originally requested)
    if (validId !== sessionId) {
      sessionLog('RESUME_FALLBACK', { requestedId: sessionId, validId, name, cwd });
    }
    sessionLog('RESUME_SPAWN', { sessionId: validId, name, cwd, model: model || 'default', metaFound: !!meta });
    proc = manager.createProcess({ cwd, resume: validId, model });
    if (onProcSpawned) onProcSpawned(proc);
    ensureBroadcastWired({
      proc, knownSessionId: null, manager, name, cwd,
      model, replacesSessionId: sessionId, setCurrent, originWs: ws,
    });

    // Claude CLI (2.1.49+) won't emit system init until first stdin message.
    // Choose message based on whether the session was busy when it last exited:
    // - true:      session was interrupted mid-work → tell Claude to continue
    // - false:     session was idle/completed → tell Claude to wait
    // - undefined: no data (server restarted, lost state) → let Claude decide
    const wasBusy = sessionExitWasBusy.get(sessionId);
    sessionExitWasBusy.delete(sessionId);
    if (wasBusy === true) {
      sessionLog('RESUME_CONTINUE', { sessionId: validId, reason: 'was_busy_at_exit' });
      proc.sendMessage('The session was interrupted. Continue where you left off.');
    } else if (wasBusy === false) {
      sessionLog('RESUME_WAIT', { sessionId: validId, reason: 'was_idle_at_exit' });
      proc.sendMessage('Session resumed. Acknowledge briefly and wait for the user\'s next instruction. Do not continue any previous work unless the user explicitly asks.');
    } else {
      // No exit state data — e.g. after server restart. Let Claude decide
      // based on its conversation history rather than guessing wrong.
      sessionLog('RESUME_AUTO', { sessionId: validId, reason: 'no_exit_state' });
      proc.sendMessage('Session resumed. Check your conversation history: if you were in the middle of a task, continue where you left off. If you had completed your work or were waiting for input, acknowledge briefly and wait for instructions.');
    }
  } else {
    // No valid session found — start fresh in the same cwd with same model
    sessionLog('RESUME_FRESH', { requestedId: sessionId, name, cwd, model: model || 'default', reason: 'no_valid_session' });
    proc = manager.createProcess({ cwd, model });
    if (onProcSpawned) onProcSpawned(proc);
    // Notify client this is a fresh session, not a true resume
    ws.send(JSON.stringify({
      type: 'session_fresh_start',
      message: 'Previous session not found. Started a new session.',
      originalSessionId: sessionId,
    }));
    ensureBroadcastWired({
      proc, knownSessionId: null, manager, name, cwd,
      model, setCurrent, originWs: ws,
    });

    // Kick-start fresh session too
    proc.sendMessage('hello');
  }
}

function handleRejoinSession(
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

  // Re-attach to an already-running process without spawning a new one
  const proc = manager.getProcess(sessionId);
  if (proc && proc.isAlive) {
    const actualSid = proc.sessionId || sessionId;
    setCurrent(proc, actualSid);
    addClient(actualSid, ws);
    if (actualSid !== sessionId) addClient(sessionId, ws);
    const busyState = getSessionBusyState(actualSid);
    const isBusy = busyState !== 'idle';
    ws.send(JSON.stringify({ type: 'session_rejoined', sessionId: actualSid, busy: isBusy }));
    replayBufferedMessages(ws, actualSid);
    if (isBusy) {
      ws.send(JSON.stringify({ type: 'session_busy', sessionId: actualSid, state: busyState }));
    }
    wireExistingProcess(ws, proc, actualSid, manager);
  } else {
    // Process is gone — tell the client so it can resume properly
    ws.send(JSON.stringify({ type: 'session_not_running', sessionId }));
  }
}

/**
 * Ensure a process has broadcast listeners attached.
 * This is idempotent — if the process is already wired, it's a no-op.
 * The broadcast listener uses broadcastAll() which sends to ALL clients
 * in the session's client set, so it works regardless of which specific
 * WebSocket triggered the wiring.
 */
function ensureBroadcastWired(opts: BroadcastWireOptions): void {
  const { proc, knownSessionId, manager, name, cwd, model, replacesSessionId, setCurrent, originWs } = opts;

  if (wiredProcesses.has(proc)) return;
  wiredProcesses.add(proc);

  // Use the process's own sessionId if available (e.g. after crash recovery
  // where the system message already fired), otherwise use what we were given.
  let sessionId: string | null = proc.sessionId || knownSessionId;
  let sessionInitDone = !!proc.sessionId; // if process already has an ID, init is done

  proc.on('message', (msg: SDKMessage) => {
    if (msg.type === 'system' && msg.session_id) {
      const sid = msg.session_id;

      if (!sessionInitDone) {
        sessionInitDone = true;
        sessionId = sid;
        sessionLog('INIT', { newId: sid, replacesId: replacesSessionId || 'none', name });
        if (setCurrent) setCurrent(proc, sid);

        if (replacesSessionId && replacesSessionId !== sid) {
          handleSessionIdChange(manager, proc, replacesSessionId, sid, name, cwd, model);
        } else {
          handleNewSession(manager, sid, name, cwd, model);
        }

        // Notify clients of the session ID
        broadcastAll(sid, JSON.stringify({ type: 'session_id_update', oldSessionId: replacesSessionId || sid, newSessionId: sid }));
      } else if (sid !== sessionId) {
        // Claude changed session ID after init (normal on resume — reverts to original).
        // Do NOT migrate clients or change our canonical session ID. Just log it
        // and register an alias so the process can be found by either ID.
        sessionLog('ID_DRIFT_IGNORED', { canonicalId: sessionId, driftedId: sid, name });
        manager.registerAlias(sid, sessionId!);
      }
    }

    // Track session busy state transitions (skip if waiting for interactive response)
    if (sessionId && !pendingInteractive.get(sessionId)?.interrupted) {
      if (msg.type === 'assistant') {
        setSessionBusy(sessionId, 'busy');
      } else if (msg.type === 'control_request') {
        setSessionBusy(sessionId, 'permission');
      } else if (msg.type === 'result') {
        setSessionBusy(sessionId, 'idle');

        // Detect "prompt too long" error — context is full and unrecoverable
        if ((msg as any).is_error && typeof (msg as any).result === 'string' &&
            (msg as any).result.toLowerCase().includes('prompt is too long')) {
          sessionLog('CONTEXT_FULL', { sessionId, name });
          log('claude', `Session ${sessionId} context full — notifying clients`, 'warn');
          const sessions = manager.loadSessions();
          const meta = sessions.find((s) => s.id === sessionId);
          broadcastAll(sessionId, JSON.stringify({
            type: 'session_context_full',
            sessionId,
            name: meta?.name || name,
            cwd: meta?.cwd || cwd,
            model: meta?.model || model,
          }));
        }
      }
    }

    // Server-side history saving: persist assistant text so switching sessions doesn't lose messages
    if (sessionId && msg.type === 'assistant' && (msg as any).message?.content) {
      const content = (msg as any).message.content;
      const textParts = Array.isArray(content)
        ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : typeof content === 'string' ? content : '';
      if (textParts) {
        appendHistoryEntry(sessionId, { role: 'assistant', text: textParts });
      }
    }

    // Cache permission request inputs for later response
    if (msg.type === 'control_request' && (msg as any).request_id && (msg as any).request?.input) {
      pendingPermissionInputs.set((msg as any).request_id, (msg as any).request.input);
    }

    // Auto-approve all tool permission requests — PilotCode runs with
    // --dangerously-skip-permissions so we trust all tool usage.
    if (msg.type === 'control_request' && (msg as any).request?.subtype === 'can_use_tool') {
      const requestId = (msg as any).request_id;
      const originalInput = (msg as any).request?.input;

      proc.respondToPermission(requestId, true, originalInput);
      if (sessionId) {
        setSessionBusy(sessionId, 'busy');
      }
      // Broadcast so clients see the tool running (spinner updates)
      if (sessionId) {
        broadcastAll(sessionId, JSON.stringify(msg));
      }
      return; // Don't broadcast again below
    }

    // Notify via ntfy on successful result
    if (msg.type === 'result' && !(msg as any).is_error) {
      const topic = getNtfyTopic();
      if (topic) {
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: `${name || 'Claude'} — Done`,
        }).catch(() => {});
      }
    }

    // When we've interrupted Claude for an interactive prompt (plan/question),
    // suppress ALL subsequent messages until the user responds. The interrupt
    // and any in-flight retries produce noise (assistant retries, error
    // tool_results, result messages) that would confuse the UI.
    if (sessionId && pendingInteractive.get(sessionId)?.interrupted) {
      const msgType = msg.type;
      // Let system messages through (rare but important)
      if (msgType !== 'system') {
        // Suppress result messages — don't let them set state to idle
        if (msgType === 'result') {
          log('ws', `Suppressing result during interactive wait for session ${sessionId}`);
          return;
        }
        // Suppress assistant retries and error tool_results
        if (msgType === 'assistant' || msgType === 'user') {
          log('ws', `Suppressing ${msgType} during interactive wait for session ${sessionId}`);
          return;
        }
      }
    }

    // Intercept ExitPlanMode / AskUserQuestion tool_use in assistant messages.
    // The CLI can't show interactive prompts in stream-json mode so it returns
    // error tool_results that make Claude retry in a loop. We intercept the
    // FIRST occurrence, show a UI card, and silently suppress all retries.
    if (sessionId && msg.type === 'assistant' && (msg as any).message?.content) {
      const content = (msg as any).message.content;
      if (Array.isArray(content)) {
        const enterPlanBlock = content.find(
          (b: any) => b.type === 'tool_use' && b.name === 'EnterPlanMode'
        );
        const exitPlanBlock = content.find(
          (b: any) => b.type === 'tool_use' && b.name === 'ExitPlanMode'
        );
        const askQuestionBlock = content.find(
          (b: any) => b.type === 'tool_use' && b.name === 'AskUserQuestion'
        );

        // EnterPlanMode also fails in stream-json mode — suppress the noise
        if (enterPlanBlock && !exitPlanBlock && !askQuestionBlock) {
          log('ws', `EnterPlanMode suppressed (no-op in stream-json) for session ${sessionId}`);
          return;
        }

        if (exitPlanBlock) {
          const pending = pendingInteractive.get(sessionId);
          if (!pending || !pending.cardShown) {
            // First time — show the plan approval card, then interrupt to stop retry loop
            pendingInteractive.set(sessionId, { type: 'plan', cardShown: true, interrupted: true });
            log('ws', `ExitPlanMode detected — showing card and interrupting session ${sessionId}`);
            broadcastAll(sessionId, JSON.stringify({
              type: 'plan_approval',
              plan: exitPlanBlock.input?.plan || '',
              allowedPrompts: exitPlanBlock.input?.allowedPrompts || [],
              toolUseId: exitPlanBlock.id,
            }));
            setSessionBusy(sessionId, 'permission');
            proc.interrupt();
          } else {
            // Retry — suppress the entire assistant message so no duplicate card
            log('ws', `ExitPlanMode retry suppressed in session ${sessionId}`);
          }
          return; // Don't broadcast the assistant message with ExitPlanMode
        }

        if (askQuestionBlock) {
          const pending = pendingInteractive.get(sessionId);
          if (!pending || pending.type !== 'question' || !pending.cardShown) {
            // First time — show the question card, then interrupt to stop retry loop
            pendingInteractive.set(sessionId, { type: 'question', cardShown: true, interrupted: true });
            log('ws', `AskUserQuestion detected — showing card and interrupting session ${sessionId}`);
            broadcastAll(sessionId, JSON.stringify({
              type: 'user_question',
              questions: askQuestionBlock.input?.questions || [],
              toolUseId: askQuestionBlock.id,
            }));
            setSessionBusy(sessionId, 'permission');
            proc.interrupt();
          } else {
            log('ws', `AskUserQuestion retry suppressed in session ${sessionId}`);
          }
          return; // Don't broadcast
        }
      }
    }

    // Suppress error tool_results for interactive tools ("Exit plan mode?", "Answer questions?", "Entered plan mode")
    if (sessionId && msg.type === 'user' && (msg as any).message?.content) {
      const content = (msg as any).message.content;
      if (Array.isArray(content)) {
        const hasInteractiveError = content.some(
          (b: any) => b.type === 'tool_result' && b.is_error &&
            typeof b.content === 'string' &&
            [...INTERACTIVE_ERRORS].some(err => b.content.includes(err))
        );
        if (hasInteractiveError) {
          log('ws', `Suppressing interactive tool error tool_result for session ${sessionId}`);
          return; // Don't broadcast
        }
      }
    }

    // Broadcast all Claude messages to every client on this session
    if (sessionId) {
      broadcastAll(sessionId, JSON.stringify(msg));
    } else if (originWs && originWs.readyState === WebSocket.OPEN) {
      // Before session ID is known, send only to originating client
      originWs.send(JSON.stringify(msg));
    }

    // (busy state tracking is handled above via setSessionBusy)
  });

  proc.on('stderr', (text: string) => {
    if (originWs && originWs.readyState === WebSocket.OPEN) {
      originWs.send(JSON.stringify({ type: 'log', log: { level: 'debug', message: text } }));
    }
  });

  proc.on('close', (code: number) => {
    if (sessionId) {
      setSessionBusy(sessionId, 'idle');
    }
    handleProcessClose(proc, code, sessionId, replacesSessionId || undefined, name, cwd, model, manager, originWs);
  });

  proc.on('error', (err: Error) => {
    sessionLog('PROCESS_ERROR', { sessionId: sessionId || 'none', error: err.message, name });
    if (sessionId) {
      broadcastAll(sessionId, JSON.stringify({ type: 'error', error: err.message }));
    }
  });
}

/** Handle the case where Claude returns a different session ID on resume. */
function handleSessionIdChange(
  manager: SessionManager,
  proc: ClaudeProcess,
  oldId: string,
  newId: string,
  name: string,
  cwd: string,
  model?: string
): void {
  sessionLog('ID_CHANGED', { oldId, newId, name });
  const sessions = manager.loadSessions();
  const existing = sessions.find((s) => s.id === oldId);
  if (existing) {
    existing.id = newId;
    existing.lastUsed = new Date().toISOString();
    const cleaned = sessions.filter((s) => s === existing || s.id !== newId);
    manager.saveSessions(cleaned);
  } else {
    manager.saveSession({ id: newId, name, cwd, model, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() });
  }
  manager.registerProcess(newId, proc);
  manager.registerAlias(oldId, newId);

  migrateHistory(oldId, newId);

  // Migrate clients from old session ID to new
  const oldClients = sessionClients.get(oldId);
  if (oldClients) {
    for (const c of oldClients) addClient(newId, c);
    sessionClients.delete(oldId);
  }
}

/** Save a brand-new session, removing stale entries with the same name+cwd. */
function handleNewSession(
  manager: SessionManager,
  sid: string,
  name: string,
  cwd: string,
  model?: string
): void {
  const sessions = manager.loadSessions();
  const activeIds = manager.listActive();
  const cleaned = sessions.filter((s) =>
    s.id === sid || !(s.name === name && s.cwd === cwd && !activeIds.includes(s.id))
  );
  cleaned.push({ id: sid, name, cwd, model, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() });
  const seen = new Set<string>();
  const deduped = cleaned.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  manager.saveSessions(deduped);
}

/** Handle process exit: intentional kills, crash recovery, and normal exit. */
function handleProcessClose(
  proc: ClaudeProcess,
  code: number,
  sessionId: string | null,
  replacesSessionId: string | undefined,
  name: string,
  cwd: string,
  model: string | undefined,
  manager: SessionManager,
  originWs?: WebSocket | null
): void {
  sessionLog('PROCESS_EXIT', { sessionId: sessionId || 'none', code, name, replacesId: replacesSessionId || 'none' });
  log('claude', `Process closed with code ${code}, sessionId=${sessionId}`);

  // Record whether the session was busy at exit time — used by resume logic
  // to decide whether to tell Claude to continue or wait.
  if (sessionId) {
    const wasBusy = sessionBusyStates.get(sessionId);
    sessionExitWasBusy.set(sessionId, wasBusy === 'busy' || wasBusy === 'permission');
    sessionBusyStates.set(sessionId, 'idle');
  }
  // Note: the close listener on the process already calls setSessionBusy('idle')
  // which broadcasts the status change. This direct set is a safety net.

  if (!sessionId) {
    const fallbackSid = replacesSessionId || null;
    sessionLog('EXIT_NO_SESSION_ID', { fallbackId: fallbackSid || 'none', code });
    const errorMsg = JSON.stringify({
      type: 'process_exit', code,
      error: 'Session expired. Send a message to start a new session.',
    });
    // Try broadcast AND direct send — client may not be in broadcast set yet
    if (fallbackSid) broadcastAll(fallbackSid, errorMsg);
    if (originWs && originWs.readyState === WebSocket.OPEN) originWs.send(errorMsg);
    return;
  }

  // Don't auto-resume intentional kills
  if (manager.wasIntentionalKill(sessionId)) {
    manager.clearIntentionalKill(sessionId);
    broadcastAll(sessionId, JSON.stringify({ type: 'process_exit', code }));
    return;
  }

  // Process crashed — attempt auto-resume
  if (code !== 0) {
    const now = Date.now();
    let retry = crashRetries.get(sessionId);
    if (!retry || now - retry.firstAttempt > CRASH_RETRY_WINDOW) {
      retry = { count: 0, firstAttempt: now };
    }
    retry.count++;
    crashRetries.set(sessionId, retry);

    if (retry.count <= MAX_CRASH_RETRIES) {
      sessionLog('CRASH_RETRY', { sessionId, code, attempt: retry.count, maxAttempts: MAX_CRASH_RETRIES, name });
      log('claude', `Auto-resume: session ${sessionId} crashed (code ${code}), attempt ${retry.count}/${MAX_CRASH_RETRIES}`);
      broadcastAll(sessionId, JSON.stringify({ type: 'session_reconnecting', attempt: retry.count, maxAttempts: MAX_CRASH_RETRIES }));

      const delay = retry.count * 2000;
      setTimeout(() => {
        const sessions = manager.loadSessions();
        const meta = sessions.find((s) => s.id === sessionId);
        const resumeCwd = meta?.cwd || cwd;
        const resumeModel = meta?.model || model;

        const newProc = manager.createProcess({ cwd: resumeCwd, resume: sessionId!, model: resumeModel });

        // ALWAYS wire the new process — even with no clients connected.
        // broadcastAll will find clients when they reconnect via addClient().
        ensureBroadcastWired({
          proc: newProc, knownSessionId: sessionId, manager, name, cwd: resumeCwd,
          model: resumeModel, replacesSessionId: sessionId!,
          setCurrent: (p, sid) => { manager.registerProcess(sid, p); },
          originWs: null,
        });

        // Claude CLI (2.1.49+) won't emit system init until first stdin message.
        // The session crashed mid-work, so tell Claude to continue.
        newProc.sendMessage('The session crashed and was auto-resumed. Continue where you left off.');
      }, delay);
      return;
    }

    log('claude', `Auto-resume: session ${sessionId} max retries exhausted`, 'error');
    crashRetries.delete(sessionId);
    broadcastAll(sessionId, JSON.stringify({ type: 'session_crashed', error: 'Session crashed after multiple retries. Please resume manually.' }));
    return;
  }

  broadcastAll(sessionId, JSON.stringify({ type: 'process_exit', code }));
}

/**
 * Ensure an EXISTING process (already running) has broadcast listeners.
 * If the process was wired before (e.g. when originally spawned), this is a no-op.
 * If the process was auto-resumed after crash recovery without any clients,
 * this ensures its messages will now reach clients via broadcastAll.
 */
function wireExistingProcess(ws: WebSocket, proc: ClaudeProcess, sessionId: string, manager: SessionManager): void {
  if (wiredProcesses.has(proc)) {
    log('ws', `Process for session ${sessionId} already wired — client added to broadcast set`);
    return;
  }

  // Process has no broadcast listener (e.g. crash recovery with no clients).
  // Wire it now so messages reach clients.
  log('ws', `Wiring existing process for session ${sessionId} — was missing broadcast listener`);
  const sessions = manager.loadSessions();
  const meta = sessions.find((s) => s.id === sessionId);
  ensureBroadcastWired({
    proc, knownSessionId: sessionId, manager,
    name: meta?.name || 'Session', cwd: meta?.cwd || process.cwd(),
    model: meta?.model, originWs: ws,
  });
}

function handleUserMessage(ws: WebSocket, msg: WSMessage, proc: ClaudeProcess | null, sessionId: string | null): void {
  if (!proc || !proc.isAlive) {
    sessionLog('MESSAGE_DROPPED', { sessionId: sessionId || 'none', reason: proc ? 'process_dead' : 'no_process', content: (msg.content || '').slice(0, 50) });
    ws.send(JSON.stringify({ type: 'error', error: 'No active session. Create or resume one first.' }));
    return;
  }
  sessionLog('MESSAGE_SENT', { sessionId: sessionId || 'none', processSessionId: proc.sessionId || 'none', content: (msg.content || '').slice(0, 50) });

  // Mark session as busy when user sends a message
  if (sessionId) {
    setSessionBusy(sessionId, 'busy');
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
    // Save user message to server-side history
    if (text) {
      appendHistoryEntry(sessionId, { role: 'user', text });
    }
  }

  if (files.length === 0) {
    proc.sendMessage(text);
    return;
  }

  const blocks: ContentBlock[] = [];
  const docPaths: string[] = [];

  for (const filename of files) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const filePath = join(IMAGES_DIR, filename);

    if (IMAGE_EXTENSIONS.has(ext)) {
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
      docPaths.push(filePath);
    }
  }

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
}

function handlePlanResponse(msg: WSMessage, proc: ClaudeProcess | null, sessionId: string | null): void {
  if (!proc || !proc.isAlive) return;
  if (sessionId) {
    pendingInteractive.delete(sessionId);
    log('ws', `Plan ${msg.approved ? 'approved' : 'rejected'} for session ${sessionId}${msg.notes ? ` (notes: ${msg.notes})` : ''}`);
    setSessionBusy(sessionId, 'busy');
  }
  const notes = msg.notes ? `\n\nUser notes: ${msg.notes}` : '';
  if (msg.approved) {
    proc.sendMessage(`Plan approved by the user.${notes}\n\nProceed with implementing the plan now. Do not call ExitPlanMode again — it has already been handled.`);
  } else {
    proc.sendMessage(`Plan rejected by the user.${notes}\n\nPlease revise your approach and present an updated plan. Do not call ExitPlanMode again until you have a revised plan.`);
  }
}

function handleQuestionResponse(msg: WSMessage, proc: ClaudeProcess | null, sessionId: string | null): void {
  if (!proc || !proc.isAlive) return;
  if (sessionId) {
    pendingInteractive.delete(sessionId);
    setSessionBusy(sessionId, 'busy');
  }
  // msg.answers is an object like { "question text": "selected answer" }
  const answers = msg.answers || {};
  const parts = Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`);
  const response = parts.length > 0
    ? `The user answered your questions:\n${parts.join('\n\n')}\n\nProceed based on these answers. Do not call AskUserQuestion again for the same questions — they have been answered.`
    : 'The user did not select any answers. Proceed with reasonable defaults.';
  log('ws', `Question answered for session ${sessionId}: ${JSON.stringify(answers)}`);
  proc.sendMessage(response);
}

function handlePermissionResponse(msg: WSMessage, proc: ClaudeProcess | null): void {
  if (!proc || !proc.isAlive) return;
  const originalInput = pendingPermissionInputs.get(msg.request_id);
  pendingPermissionInputs.delete(msg.request_id);
  proc.respondToPermission(msg.request_id, msg.allow === true, originalInput);
}

/** Append an entry to the server-side history file for a session. */
function appendHistoryEntry(sessionId: string, entry: { role: string; text: string }): void {
  const file = join(HISTORY_DIR, `${sessionId}.json`);
  try {
    let history: any[] = [];
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    }
    history.push(entry);
    // Keep last 500 entries
    if (history.length > 500) history = history.slice(-500);
    writeFileSync(file, JSON.stringify(history));
  } catch {
    // Don't crash on history save failure
  }
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
