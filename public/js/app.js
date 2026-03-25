import { WSClient } from './ws-client.js';
import { Chat } from './chat.js';
import { SessionUI } from './sessions.js';
import { ImageHandler, renderImagePreview } from './images.js';
import { initMarkdown } from './markdown.js';
import { initEasterEgg } from './easter-egg.js';
import { showGuide, showGuideIfFirstTime } from './guide.js';

// State
let wsClient;
let chat;
let sessionUI;
let imageHandler;
let pendingMessage = null; // queued message while waiting for session init
let creatingSession = false;
let sessionGreeted = false; // prevent duplicate auto-greets
let dingSuppressed = false; // suppress ding during buffer replay
let watchMode = false; // true when observing a live session (read-only)

// Boot
document.addEventListener('DOMContentLoaded', async () => {
  await initMarkdown();
  checkAuth();
});

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (data.authenticated) {
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('app-view').classList.remove('active');

  const form = document.getElementById('login-form');
  const input = document.getElementById('token-input');
  const error = document.getElementById('login-error');

  form.onsubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    const token = input.value.trim();
    if (!token) return;

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        showApp();
      } else {
        error.textContent = data.error || 'Invalid token';
      }
    } catch {
      error.textContent = 'Connection failed';
    }
  };
}

function showApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-view').classList.add('active');

  initEasterEgg();
  showGuideIfFirstTime();

  // Guide button in sidebar
  const guideBtn = document.getElementById('guide-btn');
  if (guideBtn) guideBtn.onclick = () => showGuide();

  // WebSocket
  wsClient = new WSClient(handleMessage, handleStatus);

  // Chat
  chat = new Chat(wsClient);

  // Resend / Edit callbacks on user messages
  chat.onResend = (text) => doSend(text, []);
  chat.onEdit = (text) => {
    const input = document.getElementById('message-input');
    input.value = text;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    document.getElementById('send-btn').disabled = !text.trim();
    input.focus();
    // Place cursor at the end
    input.selectionStart = input.selectionEnd = text.length;
  };

  // Draft message persistence — save/restore partial typed text per session
  const saveDraft = () => {
    const sid = chat.sessionId;
    if (!sid) return;
    const text = document.getElementById('message-input').value;
    const drafts = JSON.parse(sessionStorage.getItem('pilotcode_drafts') || '{}');
    if (text.trim()) {
      drafts[sid] = text;
    } else {
      delete drafts[sid];
    }
    sessionStorage.setItem('pilotcode_drafts', JSON.stringify(drafts));
  };
  const loadDraft = (sid) => {
    const input = document.getElementById('message-input');
    const drafts = JSON.parse(sessionStorage.getItem('pilotcode_drafts') || '{}');
    const text = (sid && drafts[sid]) || '';
    input.value = text;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    document.getElementById('send-btn').disabled = !text.trim();
  };

  // Sessions
  sessionUI = new SessionUI(wsClient, (name, sessionId, cwd) => {
    // Exit watch mode when switching to a real session
    if (watchMode) exitWatchMode();
    // Save draft for outgoing session before switching
    saveDraft();
    sessionGreeted = !!sessionId;
    if (cwd) chat.sessionCwd = cwd;
    pendingMessage = null;

    if (sessionId === '__creating__') {
      // New session from modal — show chat immediately with "connecting" state
      chat.switchSession(null);
      creatingSession = true;
      hideNoSessionPrompt();
      document.getElementById('session-name').textContent = name || 'New Session';
      chat.showThinking('Starting session...');
    } else {
      chat.switchSession(sessionId || null);
      if (sessionId) hideNoSessionPrompt();
    }
    // Restore draft for incoming session
    loadDraft(sessionId);
  });

  // Images
  imageHandler = new ImageHandler((images) => {
    renderImagePreview(images, (i) => imageHandler.removeImage(i));
  });

  // Auto-resume last session before connecting
  const lastSessionId = localStorage.getItem('pilotcode_session');
  if (lastSessionId) {
    sessionGreeted = true;
    sessionUI.currentSessionId = lastSessionId;
    chat.setSession(lastSessionId);
    chat.sessionCwd = localStorage.getItem('pilotcode_session_cwd') || '';
    chat.loadHistory(lastSessionId);
    wsClient.setActiveSession(lastSessionId);
    sessionUI.setCurrentSession(lastSessionId);
    loadDraft(lastSessionId);
  }

  // Connect WebSocket (will auto-rejoin session if activeSessionId is set)
  wsClient.connect();

  // Proactive reconnect when user returns to the app (mobile background, tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // If WS is dead, force immediate reconnect instead of waiting for backoff
      if (wsClient.ws?.readyState !== WebSocket.OPEN && wsClient.ws?.readyState !== WebSocket.CONNECTING) {
        wsClient.reconnectDelay = 100; // near-instant
        wsClient.connect();
      }
    }
  });

  // Input handling
  setupInput();
  initDingToggle();
  initNtfyToggle();

  // Show no-session prompt, hide input until a session is active
  showNoSessionPrompt();

  // Wire "New Session" button in the center prompt
  document.getElementById('start-session-btn').onclick = () => {
    sessionUI.showNewSessionModal();
  };

  // Force refresh button — clears service worker cache and reloads
  document.getElementById('force-refresh-btn').onclick = async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) await reg.unregister();
    }
    const keys = await caches.keys();
    for (const key of keys) await caches.delete(key);
    location.reload(true);
  };

  // Show app version (service worker cache name)
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = 'v81';
}

function setupInput() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    sendBtn.disabled = !input.value.trim() && imageHandler.pendingImages.length === 0;
  });

  // Double-tap Enter to send. Single Enter adds a newline normally.
  // Single keydown listener — no coordination issues between multiple events.
  let lastEnterTime = 0;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const now = Date.now();
      if (now - lastEnterTime < 500) {
        e.preventDefault();
        // Remove the newline that the first Enter inserted
        const val = input.value;
        const pos = input.selectionStart;
        if (pos > 0 && val[pos - 1] === '\n') {
          input.value = val.slice(0, pos - 1) + val.slice(pos);
        }
        sendMessage();
        lastEnterTime = 0;
      } else {
        lastEnterTime = now;
      }
    }
  });

  sendBtn.onclick = () => sendMessage();

  document.getElementById('stop-btn').onclick = () => {
    wsClient.send({ type: 'interrupt' });
  };
}

function showNoSessionPrompt() {
  document.getElementById('no-session-prompt').classList.add('active');
  document.getElementById('messages').style.display = 'none';
  document.getElementById('input-area').style.display = 'none';
  document.getElementById('image-preview').style.display = 'none';
}

function hideNoSessionPrompt() {
  const prompt = document.getElementById('no-session-prompt');
  const wasActive = prompt.classList.contains('active');
  prompt.classList.remove('active');
  document.getElementById('messages').style.display = '';
  document.getElementById('input-area').style.display = '';
  document.getElementById('image-preview').style.display = '';
  // Only force scroll when actually transitioning from no-session to active.
  // On redundant calls (e.g., WebSocket reconnect while already viewing a session),
  // skip the force scroll so the user's scroll position is preserved.
  if (wasActive && chat) chat.forceScrollToBottom();
}

function sendMessage() {
  // In watch mode, typing connects to the session
  if (watchMode) {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    exitWatchMode();
    pendingMessage = { text, images: [], pendingImages: [] };
    creatingSession = true;
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('send-btn').disabled = true;
    chat.showThinking('Connecting...');
    sessionUI.connectWatchedSession();
    return;
  }

  const input = document.getElementById('message-input');
  const text = input.value.trim();
  const images = imageHandler.getFilenames();

  if (!text && images.length === 0) return;

  // Session is being created from modal — queue the message until init completes
  if (sessionUI.currentSessionId === '__creating__') {
    pendingMessage = { text, images, pendingImages: [...imageHandler.pendingImages] };
    creatingSession = true;
    input.value = '';
    input.style.height = 'auto';
    imageHandler.clear();
    return;
  }

  // No active session at all — create one inline using the message as the name
  if (!sessionUI.currentSessionId) {
    if (creatingSession) return; // already creating, wait
    creatingSession = true;
    pendingMessage = { text, images, pendingImages: [...imageHandler.pendingImages] };
    const name = text.slice(0, 40) || 'New Session';
    chat.clear();
    sessionGreeted = false;
    wsClient.send({ type: 'create_session', name, initialMessage: text });
    input.value = '';
    input.style.height = 'auto';
    document.getElementById('send-btn').disabled = true;
    imageHandler.clear();
    return;
  }

  doSend(text, images);
}

function doSend(text, images) {
  chat.addUserMessage(text, imageHandler.pendingImages.length ? imageHandler.pendingImages : undefined);

  wsClient.send({
    type: 'message',
    content: text,
    images: images.length > 0 ? images : undefined,
  });

  document.getElementById('message-input').value = '';
  document.getElementById('message-input').style.height = 'auto';
  document.getElementById('send-btn').disabled = true;

  imageHandler.clear();
  chat.showThinking('Thinking...');
}

function handleMessage(msg) {
  switch (msg.type) {
    // Direct notification that a session was created — bypasses all broadcast filters.
    // This is the most reliable way to initialize a session on the client.
    case 'session_created':
      sessionUI.setCurrentSession(msg.sessionId);
      chat.setSession(msg.sessionId);
      wsClient.setActiveSession(msg.sessionId);
      if (msg.cwd) chat.sessionCwd = msg.cwd;
      creatingSession = false;
      sessionGreeted = true;
      hideNoSessionPrompt();
      document.getElementById('session-name').textContent = msg.name || msg.sessionId.slice(0, 8);
      // If user typed a message while session was being created from the modal,
      // show it in chat AND send it to Claude now that the session is ready.
      if (pendingMessage) {
        const { text, pendingImages } = pendingMessage;
        pendingMessage = null;
        chat.addUserMessage(text, pendingImages.length ? pendingImages : undefined);
        wsClient.send({ type: 'message', content: text });
        chat.showThinking('Thinking...');
      } else {
        // Session created from modal with no user message.
        // Server sent a kick-start "hello" — show thinking while Claude responds.
        chat.showThinking('Thinking...');
      }
      sessionUI.refreshList();
      break;

    // Track session ID from init (fallback — session_created is preferred).
    // Only accept if: no session yet, OR we're creating a new session.
    // On resume, Claude CLI may return a different session_id (ID drift) but the
    // server keeps broadcasting on the canonical ID. If we update here, the client-side
    // session filter will reject all messages tagged with the canonical _sid.
    case 'system':
      if (msg.session_id && (!chat.sessionId || creatingSession)) {
        sessionUI.setCurrentSession(msg.session_id);
        chat.setSession(msg.session_id);
        wsClient.setActiveSession(msg.session_id);
        creatingSession = false;
        hideNoSessionPrompt();

        // Show queued message in chat (already sent to Claude via initialMessage)
        if (pendingMessage) {
          const { text, pendingImages } = pendingMessage;
          pendingMessage = null;
          sessionGreeted = true;
          chat.addUserMessage(text, pendingImages.length ? pendingImages : undefined);
          chat.showThinking('Thinking...');
        } else if (!sessionGreeted) {
          // Session created from modal with no message — just mark ready
          sessionGreeted = true;
        }
      }
      break;

    // Session ID changed after resume — migrate server-side history
    case 'session_id_update':
      if (msg.oldSessionId !== msg.newSessionId) {
        chat.migrateSessionId(msg.oldSessionId, msg.newSessionId);
        sessionUI.currentSessionId = msg.newSessionId;
        chat.sessionId = msg.newSessionId;
        wsClient.setActiveSession(msg.newSessionId);
        localStorage.setItem('pilotcode_session', msg.newSessionId);
      }
      hideNoSessionPrompt();
      break;

    // Reconnect: successfully rejoined running session — buffer replay incoming.
    // Buffer replay re-delivers old messages; assistant messages are deduped by ID
    // so duplicates are skipped. Replayed result messages clear the spinner, but
    // session_busy (sent AFTER replay) re-asserts it for still-busy sessions.
    case 'session_rejoined': {
      // Suppress ding during buffer replay so old results don't all ding
      dingSuppressed = true;
      setTimeout(() => { dingSuppressed = false; }, 2000);
      // Sync session ID — server may have resolved to a different ID via alias chain
      const rejoinId = msg.sessionId || wsClient.activeSessionId;
      if (msg.sessionId && msg.sessionId !== wsClient.activeSessionId) {
        wsClient.setActiveSession(msg.sessionId);
        chat.sessionId = msg.sessionId;
        sessionUI.currentSessionId = msg.sessionId;
        localStorage.setItem('pilotcode_session', msg.sessionId);
      }
      // Reload history from disk — picks up messages that arrived while
      // the user was away (phone locked, tab backgrounded, etc.).
      // Chain showThinking AFTER loadHistory resolves so the thinking
      // element isn't cleared by the DOM rebuild inside loadHistory.
      chat.suppressReplay = true;
      setTimeout(() => { chat.suppressReplay = false; }, 3000);
      const loaded = rejoinId ? chat.loadHistory(rejoinId) : Promise.resolve();
      loaded.then(() => {
        if (msg.busy) chat.showThinking('Thinking...');
      });
      hideNoSessionPrompt();
      break;
    }

    // Session is still busy — sent AFTER buffer replay to re-show the spinner
    // (replayed result messages may have cleared it during replay)
    case 'session_busy':
      chat.showThinking('Thinking...');
      hideNoSessionPrompt();
      break;

    // Reconnect: process died while we were disconnected — auto-resume once
    case 'session_not_running': {
      const sid = msg.sessionId || wsClient.activeSessionId;
      if (sid) chat.loadHistory(sid);
      if (sid && !sessionUI._resumeAttempted?.has(sid)) {
        if (!sessionUI._resumeAttempted) sessionUI._resumeAttempted = new Set();
        sessionUI._resumeAttempted.add(sid);
        chat.addSystemMessage('Session ended — resuming...');
        wsClient.send({ type: 'resume_session', sessionId: sid });
      } else {
        chat.addSystemMessage('Session ended. Tap the session in the sidebar to resume.');
      }
      break;
    }

    case 'session_reconnecting':
      chat.addSystemMessage(`Reconnecting to Claude... (attempt ${msg.attempt}/${msg.maxAttempts})`);
      break;

    case 'session_reconnected':
      chat.addSystemMessage('Reconnected.');
      break;

    case 'session_crashed':
      chat.addSystemMessage(msg.error || 'Session crashed. Please resume manually.');
      chat.setWorking(false);
      sessionUI.currentSessionId = null;
      localStorage.removeItem('pilotcode_session');
      creatingSession = false;
      showNoSessionPrompt();
      break;

    case 'session_context_full': {
      const fullName = msg.name || 'Session';
      const fullCwd = msg.cwd || undefined;
      const fullModel = msg.model || undefined;
      chat.addSystemMessage('Session context is full. Starting a fresh session...');
      // Auto-create a new session with the same name, cwd, and model
      sessionUI.currentSessionId = '__creating__';
      sessionGreeted = true; // don't auto-greet — user will continue manually
      wsClient.send({ type: 'create_session', name: fullName, cwd: fullCwd, model: fullModel });
      break;
    }

    // Fresh start fallback — resume couldn't find a valid session
    case 'session_fresh_start':
      chat.addSystemMessage(msg.message || 'Previous session not found. Started a new session.');
      break;

    // Process exited normally — no action needed (resume handles failures gracefully)
    case 'process_exit':
      break;

    // Watch mode: initial history dump from JSONL file
    case 'watch_history':
      chat.clear().then(() => {
        watchMode = true;
        enterWatchMode(msg.sessionId);
        for (const m of msg.messages || []) {
          renderWatchMessage(m);
        }
        chat.forceScrollToBottom();
      });
      break;

    // Watch mode: live update — new messages from the session file
    case 'watch_update':
      for (const m of msg.messages || []) {
        renderWatchMessage(m);
      }
      chat.scrollToBottom();
      break;

    // Watch mode stopped
    case 'watch_stopped':
      if (watchMode) exitWatchMode();
      break;

    // Session busy/idle status update (from any session)
    case 'session_status':
      sessionUI.updateSessionBusy(msg.sessionId, msg.busy);
      break;

    // User message from another device
    case 'user_broadcast': {
      const images = (msg.images || []).map((f) => ({ filename: f, objectUrl: `/data/images/${f}` }));
      chat.addUserMessage(msg.content || '', images.length ? images : undefined);
      chat.showThinking('Thinking...');
      break;
    }

    // Play notification ding on successful result
    case 'result':
      if (!msg.is_error && !dingSuppressed) {
        playDing();
      }
      break;
  }

  // Secondary session guard: if the message came from a specific session
  // and it doesn't match what the chat is currently showing, skip it.
  // This catches edge cases where ws-client's filter races with session switching.
  if (msg._fromSession && chat.sessionId && msg._fromSession !== chat.sessionId) {
    return; // wrong session — don't render in chat
  }

  // Always forward to Chat for SDK message handling (assistant text, tool use, permissions, etc.)
  chat.handleSDKMessage(msg, (requestId, allow) => {
    wsClient.send({
      type: 'permission_response',
      request_id: requestId,
      allow,
    });
  });
}

function handleStatus(status) {
  const dot = document.getElementById('connection-status');
  dot.className = '';
  if (status === 'connected') dot.classList.add('connected');
  else if (status === 'connecting') dot.classList.add('connecting');

  if (status === 'auth_failed') {
    showLogin();
  }
}

// Notification ding when Claude finishes
let dingEnabled = localStorage.getItem('pilotcode_ding') !== 'off';

function initDingToggle() {
  const btn = document.getElementById('ding-toggle');
  updateDingButton(btn);
  btn.onclick = () => {
    dingEnabled = !dingEnabled;
    localStorage.setItem('pilotcode_ding', dingEnabled ? 'on' : 'off');
    updateDingButton(btn);
  };
}

function updateDingButton(btn) {
  btn.classList.toggle('ding-on', dingEnabled);
  btn.classList.toggle('ding-off', !dingEnabled);
  btn.title = dingEnabled ? 'Sound: ON' : 'Sound: OFF';
}

function playDing() {
  if (!dingEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1); // D6
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

// Ntfy watch notifications
async function initNtfyToggle() {
  const btn = document.getElementById('push-toggle');
  if (!btn) return;

  // Check current state from server
  try {
    const res = await fetch('/api/ntfy');
    const data = await res.json();
    btn.style.display = 'inline-block';
    updateNtfyButton(btn, !!data.topic);
  } catch {
    btn.style.display = 'inline-block';
    updateNtfyButton(btn, false);
  }

  btn.onclick = async () => {
    const res = await fetch('/api/ntfy');
    const data = await res.json();

    if (data.topic) {
      // Disable — confirm first
      if (confirm('Disable Apple Watch notifications?')) {
        await fetch('/api/ntfy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: null }),
        });
        updateNtfyButton(btn, false);
      }
    } else {
      // Enable — ask for topic or generate one
      const topic = prompt(
        'Enter your ntfy topic (from the ntfy app on your phone).\n\n' +
        'If you don\'t have one yet:\n' +
        '1. Install "ntfy" from the App Store\n' +
        '2. Tap + to subscribe to a topic\n' +
        '3. Pick any name and paste it here'
      );
      if (topic && topic.trim()) {
        await fetch('/api/ntfy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topic.trim() }),
        });
        updateNtfyButton(btn, true);
      }
    }
  };
}

function updateNtfyButton(btn, enabled) {
  btn.style.opacity = enabled ? '0.9' : '0.3';
  btn.title = enabled ? 'Watch notifications: ON' : 'Watch notifications: OFF';
}

// ── Watch Mode (observe live sessions) ──

function enterWatchMode(sessionId) {
  watchMode = true;
  hideNoSessionPrompt();
  // Show banner above input — input stays visible for connect-on-send
  let banner = document.getElementById('watch-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'watch-banner';
    const inputArea = document.getElementById('input-area');
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  banner.innerHTML = '<span class="watch-dot"></span> Watching — type to connect';
  banner.style.display = '';
}

function exitWatchMode() {
  watchMode = false;
  wsClient.send({ type: 'unwatch_session' });
  document.getElementById('input-area').style.display = '';
  const banner = document.getElementById('watch-banner');
  if (banner) banner.style.display = 'none';
}

function renderWatchMessage(m) {
  if (!m) return;
  if (m.type === 'user' && m.text) {
    chat.addUserMessage(m.text);
  } else if (m.type === 'assistant' && m.text) {
    chat.addAssistantText(m.text);
  } else if (m.type === 'tool_use' && m.toolName) {
    chat.addToolUse(m.toolName);
  }
}

// Register service worker with auto-update for iOS Safari.
// iOS checks for SW updates very lazily, especially in PWA mode.
// We force an update check every time the user returns to the app,
// and auto-reload when a new SW takes control.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // Force update check when user returns (critical for iOS Safari PWA)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  }).catch(() => {});

  // Auto-reload when a new service worker activates
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swRefreshing) {
      swRefreshing = true;
      location.reload();
    }
  });
}

// Dev test helpers — call from browser console
window.__testQuestionCard = () => {
  if (!chat) return console.warn('Chat not initialized');
  chat.hideThinking();
  chat.setWorking(false);
  chat.clearInteractiveCards();
  chat.renderQuestionCard([
    {
      header: 'Auth method',
      question: 'Which authentication approach should we use?',
      multiSelect: false,
      options: [
        { label: 'JWT tokens', description: 'Stateless auth with signed tokens, good for APIs' },
        { label: 'Session cookies', description: 'Traditional server-side sessions, simpler setup' },
        { label: 'OAuth 2.0', description: 'Delegated auth via Google/GitHub, best for SSO' },
      ],
    },
    {
      header: 'Features',
      question: 'Which additional features do you want to enable?',
      multiSelect: true,
      options: [
        { label: 'Rate limiting', description: 'Prevent abuse with request throttling' },
        { label: 'Email verification', description: 'Require email confirmation on signup' },
        { label: '2FA support', description: 'Optional TOTP-based two-factor authentication' },
        { label: 'Password reset', description: 'Self-service password recovery via email' },
      ],
    },
  ]);
};

window.__testPlanApproval = () => {
  if (!chat) return console.warn('Chat not initialized');
  chat.hideThinking();
  chat.setWorking(false);
  chat.clearInteractiveCards();
  chat.addAssistantText(
    '## Implementation Plan\n\n' +
    '1. Create auth middleware in `src/middleware/auth.ts`\n' +
    '2. Add JWT token generation and validation\n' +
    '3. Create login/register API routes\n' +
    '4. Add protected route wrapper\n' +
    '5. Update existing endpoints to require auth\n\n' +
    'Ready to proceed with this plan?'
  );
  chat.renderPlanApproval();
};
