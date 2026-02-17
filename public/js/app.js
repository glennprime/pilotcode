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
    chat.switchSession(sessionId || null);
  });

  // Images
  imageHandler = new ImageHandler((images) => {
    renderImagePreview(images, (i) => imageHandler.removeImage(i));
  });

  // Input handling
  setupInput();
}

function setupInput() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const abortBtn = document.getElementById('abort-btn');

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

  abortBtn.onclick = () => {
    wsClient.send({ type: 'interrupt' });
    abortBtn.classList.remove('active');
  };
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  const images = imageHandler.getFilenames();

  if (!text && images.length === 0) return;

  // If no active session, create one and queue the message
  if (!sessionUI.currentSessionId) {
    if (creatingSession) return; // already creating, wait
    creatingSession = true;
    pendingMessage = { text, images, pendingImages: [...imageHandler.pendingImages] };
    // Use first few words of the message as the session name
    const name = text.slice(0, 40) || 'New Session';
    wsClient.send({ type: 'create_session', name });
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
  document.getElementById('abort-btn').classList.add('active');
  imageHandler.clear();
  chat.showThinking('Thinking...');
}

function handleMessage(msg) {
  // Track session ID from init
  if (msg.type === 'system' && msg.session_id) {
    sessionUI.setCurrentSession(msg.session_id);
    chat.setSession(msg.session_id);
    creatingSession = false;

    // Send any queued message now that session is ready
    if (pendingMessage) {
      const { text, images, pendingImages } = pendingMessage;
      pendingMessage = null;
      chat.addUserMessage(text, pendingImages.length ? pendingImages : undefined);
      wsClient.send({
        type: 'message',
        content: text,
        images: images.length > 0 ? images : undefined,
      });
      document.getElementById('abort-btn').classList.add('active');
    }
  }

  // Session ID changed after resume — migrate server-side history
  if (msg.type === 'session_id_update' && msg.oldSessionId !== msg.newSessionId) {
    chat.migrateSessionId(msg.oldSessionId, msg.newSessionId);
    sessionUI.currentSessionId = msg.newSessionId;
    chat.sessionId = msg.newSessionId;
  }

  // Hide abort button on result
  if (msg.type === 'result' || msg.type === 'process_exit') {
    document.getElementById('abort-btn').classList.remove('active');
  }

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

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
