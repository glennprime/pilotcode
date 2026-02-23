import { WSClient } from './ws-client.js';
import { Chat } from './chat.js';
import { SessionUI } from './sessions.js';
import { ImageHandler, renderImagePreview } from './images.js';
import { initMarkdown } from './markdown.js';
import { initEasterEgg } from './easter-egg.js';

// State
let wsClient;
let chat;
let sessionUI;
let imageHandler;
let pendingMessage = null; // queued message while waiting for session init
let creatingSession = false;
let sessionGreeted = false; // prevent duplicate auto-greets
let dingSuppressed = false; // suppress ding during buffer replay

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

  // WebSocket
  wsClient = new WSClient(handleMessage, handleStatus);

  // Chat
  chat = new Chat(wsClient);

  // Sessions
  sessionUI = new SessionUI(wsClient, (name, sessionId) => {
    // Only auto-greet brand new sessions (sessionId is null)
    // When resuming an existing session, skip the auto-greet
    sessionGreeted = !!sessionId;
    chat.switchSession(sessionId || null);
    // Show chat UI immediately when switching to an existing session
    if (sessionId) hideNoSessionPrompt();
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
    chat.loadHistory(lastSessionId);
    wsClient.setActiveSession(lastSessionId);
    sessionUI.setCurrentSession(lastSessionId);
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
}

function setupInput() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    sendBtn.disabled = !input.value.trim() && imageHandler.pendingImages.length === 0;
  });

  // No Enter-to-send — on mobile (iPhone) autocorrect/suggestions
  // trigger Enter unexpectedly. Only the send button submits.

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
  document.getElementById('no-session-prompt').classList.remove('active');
  document.getElementById('messages').style.display = '';
  document.getElementById('input-area').style.display = '';
  // Scroll to bottom after messages become visible (loadHistory may have
  // called scrollToBottom while the div was hidden, which is a no-op)
  if (chat) chat.forceScrollToBottom();
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  const images = imageHandler.getFilenames();

  if (!text && images.length === 0) return;

  // No active session — user must create one via the modal
  if (!sessionUI.currentSessionId || sessionUI.currentSessionId === '__creating__') {
    if (creatingSession) return; // already creating, wait
    creatingSession = true;
    pendingMessage = { text, images, pendingImages: [...imageHandler.pendingImages] };
    // Use first few words of the message as the session name
    const name = text.slice(0, 40) || 'New Session';
    // Clear old session content before creating new one
    chat.clear();
    sessionGreeted = false;
    wsClient.send({ type: 'create_session', name, initialMessage: text });
    // Clear input immediately
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
    // Track session ID from init — only process once per session
    case 'system':
      if (msg.session_id && msg.session_id !== chat.sessionId) {
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
          // Auto-greet: session created from modal with no message queued
          sessionGreeted = true;
          chat.addUserMessage('hello');
          wsClient.send({ type: 'message', content: 'hello' });
          chat.showThinking('Thinking...');
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
    case 'session_rejoined':
      dingSuppressed = true;
      setTimeout(() => { dingSuppressed = false; }, 2000);
      // Sync session ID — server may have resolved to a different ID via alias chain
      if (msg.sessionId && msg.sessionId !== wsClient.activeSessionId) {
        wsClient.setActiveSession(msg.sessionId);
        chat.sessionId = msg.sessionId;
        sessionUI.currentSessionId = msg.sessionId;
        localStorage.setItem('pilotcode_session', msg.sessionId);
      }
      if (msg.busy) {
        chat.setWorking(true);
      }
      hideNoSessionPrompt();
      break;

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

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
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
