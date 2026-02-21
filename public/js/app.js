import { WSClient } from './ws-client.js';
import { Chat } from './chat.js';
import { SessionUI } from './sessions.js';
import { ImageHandler, renderImagePreview } from './images.js';
import { initMarkdown } from './markdown.js';

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

  // WebSocket
  wsClient = new WSClient(handleMessage, handleStatus);
  wsClient.connect();

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

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.onclick = () => sendMessage();
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
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  const images = imageHandler.getFilenames();

  if (!text && images.length === 0) return;

  // No active session — user must create one via the modal
  if (!sessionUI.currentSessionId || sessionUI.currentSessionId === '__creating__') {
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

        // Send any queued message now that session is ready
        if (pendingMessage) {
          const { text, images, pendingImages } = pendingMessage;
          pendingMessage = null;
          sessionGreeted = true;
          chat.addUserMessage(text, pendingImages.length ? pendingImages : undefined);
          wsClient.send({
            type: 'message',
            content: text,
            images: images.length > 0 ? images : undefined,
          });
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
      }
      break;

    // Reconnect: successfully rejoined running session — buffer replay incoming
    case 'session_rejoined':
      // Suppress the ding during buffer replay so switching sessions isn't noisy
      dingSuppressed = true;
      setTimeout(() => { dingSuppressed = false; }, 2000);
      break;

    // Session is still busy — sent AFTER buffer replay so spinner isn't hidden by replayed messages
    case 'session_busy':
      chat.showThinking('Thinking...');
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
      sessionUI.currentSessionId = null;
      creatingSession = false;
      showNoSessionPrompt();
      break;

    // Fresh start fallback — resume couldn't find a valid session
    case 'session_fresh_start':
      chat.addSystemMessage(msg.message || 'Previous session not found. Started a new session.');
      break;

    // Process exited normally — no action needed (resume handles failures gracefully)
    case 'process_exit':
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
