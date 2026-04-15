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
let dingArmed = false; // only ding when user sent a message and is waiting for result
let watchMode = false; // true when observing a live session (read-only)
let archiveMode = false; // true when viewing an archived session (read-only)
let archiveReturnSessionId = null; // session to return to when exiting archive mode

function updateSessionIdDisplay(sessionId) {
  const area = document.getElementById('session-id-area');
  const text = document.getElementById('session-id-text');
  const copyBtn = document.getElementById('session-id-copy');
  if (!area) return;
  if (sessionId && sessionId !== '__creating__') {
    text.textContent = sessionId.slice(0, 8);
    area.style.display = '';
    area.title = sessionId;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(sessionId).then(() => {
        copyBtn.textContent = '\u2713';
        setTimeout(() => copyBtn.textContent = '\u{1F4CB}', 1200);
      });
    };
  } else {
    area.style.display = 'none';
  }
}

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
    // Network error — if we have evidence of a prior session, show offline state
    // instead of the login screen (the auth cookie is still valid).
    const hadSession = localStorage.getItem('pilotcode_session');
    if (hadSession) {
      showApp();
      showOfflineBanner();
    } else {
      showLogin();
    }
  }
}

function showOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.innerHTML = 'No connection to server &mdash; retrying...';
    document.getElementById('app-view').prepend(banner);
  }
  banner.style.display = '';

  // Retry connection periodically
  const retryInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/auth/check');
      const data = await res.json();
      if (data.authenticated) {
        clearInterval(retryInterval);
        banner.style.display = 'none';
      }
    } catch { /* still offline */ }
  }, 5000);
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
  // Uses localStorage so drafts survive tab closure and browser restart.
  let _draftTimer = null;
  const saveDraft = () => {
    const sid = chat.sessionId;
    if (!sid) return;
    const text = document.getElementById('message-input').value;
    const drafts = JSON.parse(localStorage.getItem('pilotcode_drafts') || '{}');
    if (text.trim()) {
      drafts[sid] = text;
    } else {
      delete drafts[sid];
    }
    localStorage.setItem('pilotcode_drafts', JSON.stringify(drafts));
  };
  const saveDraftDebounced = () => {
    clearTimeout(_draftTimer);
    _draftTimer = setTimeout(saveDraft, 500);
  };
  window._saveDraftDebounced = saveDraftDebounced;
  const loadDraft = (sid) => {
    const input = document.getElementById('message-input');
    const drafts = JSON.parse(localStorage.getItem('pilotcode_drafts') || '{}');
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
    if (archiveMode) exitArchiveMode();
    refreshArchivesChip(cwd || null);
    pendingMessage = null;
    dingArmed = false; // don't beep when visiting a session — user can see it

    if (sessionId === '__creating__') {
      // New session from modal — show chat immediately with "connecting" state
      chat.switchSession(null);
      creatingSession = true;
      hideNoSessionPrompt();
      document.getElementById('session-name').textContent = name || 'New Session';
      updateSessionIdDisplay(null);
      chat.showThinking('Starting session...');
    } else {
      chat.switchSession(sessionId || null);
      updateSessionIdDisplay(sessionId);
      if (sessionId) hideNoSessionPrompt();
    }
    // Restore draft for incoming session
    loadDraft(sessionId);
    // Update nav arrows for new position
    sessionUI.updateNavArrows();
  });

  // Images
  imageHandler = new ImageHandler((images) => {
    renderImagePreview(images, (i) => imageHandler.removeImage(i));
  });

  // Scroll position persistence — save on scroll (debounced), restore on session load
  let _scrollTimer = null;
  const messagesEl = document.getElementById('messages');
  const saveScrollPos = () => {
    const sid = chat?.sessionId;
    if (!sid || !messagesEl) return;
    localStorage.setItem('pilotcode_scroll_' + sid, String(messagesEl.scrollTop));
  };
  const restoreScrollPos = (sid) => {
    if (!sid || !messagesEl) return;
    const saved = localStorage.getItem('pilotcode_scroll_' + sid);
    if (saved) {
      requestAnimationFrame(() => { messagesEl.scrollTop = parseInt(saved, 10); });
    }
  };
  window._restoreScrollPos = restoreScrollPos;
  messagesEl.addEventListener('scroll', () => {
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(saveScrollPos, 300);
  });

  // Auto-resume last session before connecting
  const lastSessionId = localStorage.getItem('pilotcode_session');
  if (lastSessionId) {
    sessionGreeted = true;
    sessionUI.currentSessionId = lastSessionId;
    chat.setSession(lastSessionId);
    chat.sessionCwd = localStorage.getItem('pilotcode_session_cwd') || '';
    // Show cached name immediately so header isn't blank during async fetch
    const cachedName = localStorage.getItem('pilotcode_session_name');
    if (cachedName) document.getElementById('session-name').textContent = cachedName;
    updateSessionIdDisplay(lastSessionId);
    chat.loadHistory(lastSessionId).then(() => restoreScrollPos(lastSessionId));
    wsClient.setActiveSession(lastSessionId);
    sessionUI.setCurrentSession(lastSessionId);
    refreshArchivesChip(chat.sessionCwd || null);
    loadDraft(lastSessionId);
  }

  // Connect WebSocket (will auto-rejoin session if activeSessionId is set)
  wsClient.connect();

  // Proactive reconnect when user returns to the app (mobile background, tab switch)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // If WS is dead, force immediate reconnect instead of waiting for backoff.
      // Reconnect calls rejoin_session which triggers loadHistory.
      if (wsClient.ws?.readyState !== WebSocket.OPEN && wsClient.ws?.readyState !== WebSocket.CONNECTING) {
        wsClient.reconnectDelay = 100; // near-instant
        wsClient.connect();
      } else if (chat.sessionId) {
        // WS appears alive but may be a zombie (browser suspended the tab and
        // the readyState is stale). Always refresh history from disk so messages
        // that arrived while the tab was backgrounded appear immediately instead
        // of waiting for the heartbeat timeout (up to 90s) to detect a dead
        // connection and trigger a reconnect + loadHistory cycle.
        chat.loadHistory(chat.sessionId);
      }
    }
  });

  // Input handling
  setupInput();
  initVoiceDictation();
  initDingToggle();
  initNtfyToggle();
  initArchives();

  // Render session list immediately so busy dots are visible without opening the drawer
  sessionUI.refreshList().then(() => sessionUI.updateNavArrows());

  // Session navigation arrows
  document.getElementById('nav-prev').onclick = () => {
    sessionUI.navigateSession(-1);
    sessionUI.updateNavArrows();
  };
  document.getElementById('nav-next').onclick = () => {
    sessionUI.navigateSession(1);
    sessionUI.updateNavArrows();
  };

  // Ctrl+Arrow shortcuts: left/right to switch sessions, down to scroll to bottom
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Don't hijack Ctrl+Arrow when the user is editing text (word-jump)
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        sessionUI.navigateSession(dir);
        sessionUI.updateNavArrows();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        chat.forceScrollToBottom();
      }
    }
  });

  // Show no-session prompt only if we didn't restore a session from localStorage
  if (!lastSessionId) showNoSessionPrompt();

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
  if (versionEl) versionEl.textContent = 'v128';
}

function setupInput() {
  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    sendBtn.disabled = !input.value.trim() && imageHandler.pendingImages.length === 0;
    if (window._saveDraftDebounced) window._saveDraftDebounced();
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

  let stopTimer = null;
  document.getElementById('stop-btn').onclick = () => {
    if (stopTimer) {
      // Already waiting — escalate immediately
      clearTimeout(stopTimer);
      stopTimer = null;
      wsClient.send({ type: 'force_stop' });
      return;
    }
    wsClient.send({ type: 'interrupt' });
    // If no result within 10s, escalate to force kill
    stopTimer = setTimeout(() => {
      stopTimer = null;
      wsClient.send({ type: 'force_stop' });
    }, 10_000);
  };

  // Clear the escalation timer when a result arrives (session goes idle)
  window.__clearStopTimer = () => {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  };
}

function initVoiceDictation() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return; // hide button on unsupported browsers

  const btn = document.getElementById('mic-btn');
  btn.style.display = '';

  const input = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  let recognition = null;
  let listening = false;
  let textBeforeDictation = '';

  btn.onclick = () => {
    if (listening) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    textBeforeDictation = input.value;

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      // Build text: original + finalized speech + interim (greyed via placeholder)
      input.value = textBeforeDictation + (textBeforeDictation && final ? ' ' : '') + final + (interim ? ' ' + interim : '');
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      sendBtn.disabled = !input.value.trim();
    };

    recognition.onstart = () => {
      listening = true;
      btn.classList.add('mic-active');
      btn.title = 'Stop dictation';
    };

    recognition.onend = () => {
      listening = false;
      btn.classList.remove('mic-active');
      btn.title = 'Voice dictation';
    };

    recognition.onerror = (e) => {
      if (e.error !== 'aborted') {
        console.warn('Speech recognition error:', e.error);
      }
    };

    recognition.start();
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
  // In watch mode, connect to the session (stays in Mac section)
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
  chat.suppressReplay = false; // user is actively sending — allow new messages through
  chat.addUserMessage(text, imageHandler.pendingImages.length ? imageHandler.pendingImages : undefined);

  wsClient.send({
    type: 'message',
    content: text,
    images: images.length > 0 ? images : undefined,
  });

  const inputEl = document.getElementById('message-input');
  inputEl.value = '';
  inputEl.style.height = 'auto';
  inputEl.blur(); // release focus so Ctrl+Arrow keys work for session navigation
  document.getElementById('send-btn').disabled = true;

  imageHandler.clear();
  chat.showThinking('Thinking...');
  chat.awaitingFirstResponse = true;
  dingArmed = true;
}

function handleMessage(msg) {
  switch (msg.type) {
    // Direct notification that a session was created — bypasses all broadcast filters.
    // This is the most reliable way to initialize a session on the client.
    case 'session_created':
      // Only switch to the new session if WE initiated the creation.
      // Without this guard, broadcastGlobal causes ALL tabs to hijack
      // to whatever session was most recently created/resumed.
      if (!creatingSession) {
        sessionUI.refreshList();
        break;
      }
      chat.suppressReplay = false;
      sessionUI.setCurrentSession(msg.sessionId);
      chat.setSession(msg.sessionId);
      wsClient.setActiveSession(msg.sessionId);
      if (msg.cwd) chat.sessionCwd = msg.cwd;
      creatingSession = false;
      sessionGreeted = true;
      hideNoSessionPrompt();
      document.getElementById('session-name').textContent = msg.name || msg.sessionId.slice(0, 8);
      updateSessionIdDisplay(msg.sessionId);
      // If user typed a message while session was being created from the modal,
      // show it in chat AND send it to Claude now that the session is ready.
      if (pendingMessage) {
        const { text, pendingImages } = pendingMessage;
        pendingMessage = null;
        chat.addUserMessage(text, pendingImages.length ? pendingImages : undefined);
        wsClient.send({ type: 'message', content: text });
        chat.showThinking('Thinking...');
        chat.awaitingFirstResponse = true;
        dingArmed = true;
      } else {
        // Session created from modal with no user message.
        // Server sent a kick-start "hello" — show thinking while Claude responds.
        chat.showThinking('Thinking...');
        chat.awaitingFirstResponse = true;
        dingArmed = true;
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
          chat.awaitingFirstResponse = true;
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
      // Sync session ID — server may have resolved to a different ID via alias chain
      const rejoinId = msg.sessionId || wsClient.activeSessionId;
      if (msg.sessionId && msg.sessionId !== wsClient.activeSessionId) {
        wsClient.setActiveSession(msg.sessionId);
        chat.sessionId = msg.sessionId;
        sessionUI.currentSessionId = msg.sessionId;
        localStorage.setItem('pilotcode_session', msg.sessionId);
      }
      // Rejoin confirmed — safe to flush queued messages now
      wsClient.onRejoinComplete();
      // Reload history from disk — picks up messages that arrived while
      // the user was away (phone locked, tab backgrounded, etc.).
      // Chain showThinking AFTER loadHistory resolves so the thinking
      // element isn't cleared by the DOM rebuild inside loadHistory.
      chat.suppressReplay = true;
      // suppressReplay is cleared when the user sends a message (doSend),
      // NOT on a timer — buffer replay can take longer than any fixed timeout.
      const loaded = rejoinId ? chat.loadHistory(rejoinId) : Promise.resolve();
      loaded.then(() => {
        if (msg.busy) chat.showThinking('Thinking...');
        if (rejoinId) window._restoreScrollPos?.(rejoinId);
        // If history is empty but session is live, let user know
        if (chat.history.length === 0) {
          chat.addSystemMessage('Session connected. Chat history was cleared during a server restart — your conversation with Claude is intact.');
        }
      });
      hideNoSessionPrompt();
      break;
    }

    // Session is still busy — sent AFTER buffer replay to re-show the spinner
    // (replayed result messages may have cleared it during replay).
    // Also clear suppressReplay: buffer replay is done, new live messages follow.
    case 'session_busy':
      chat.suppressReplay = false;
      chat.showThinking('Thinking...');
      hideNoSessionPrompt();
      break;

    // Reconnect: process died while we were disconnected.
    // Only auto-resume if Claude was mid-task (wasBusy). If idle, the session
    // will restart lazily when the user sends their next message.
    case 'session_not_running': {
      // Rejoin resolved (session gone) — safe to flush queued messages
      wsClient.onRejoinComplete();
      const sid = msg.sessionId || wsClient.activeSessionId;
      if (sid) chat.loadHistory(sid).then(() => window._restoreScrollPos?.(sid));
      if (sid && msg.wasBusy && !sessionUI._resumeAttempted?.has(sid)) {
        if (!sessionUI._resumeAttempted) sessionUI._resumeAttempted = new Set();
        sessionUI._resumeAttempted.add(sid);
        chat.addSystemMessage('Session interrupted mid-task — resuming...');
        wsClient.send({ type: 'resume_session', sessionId: sid });
        dingArmed = true;
      } else {
        chat.addSystemMessage('Session ended. Send a message to resume.');
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
      // Ding when a different session finishes — alerts user to check it
      if (!msg.busy && msg.sessionId !== chat.sessionId) {
        playDing();
      }
      break;

    // Session context size update
    case 'session_context':
      sessionUI.updateSessionContext(msg.sessionId, msg.contextTokens);
      break;

    // System message from server (e.g. handoff progress)
    case 'system_message':
      chat.addSystemMessage(msg.text || '');
      break;

    // Transitioning to a continued new session — clear the chat
    case 'session_continued':
      chat.switchSession(null); // clear chat
      chat.addSystemMessage(msg.text || 'Continuing in new session...');
      chat.showThinking('Preparing handoff...');
      hideNoSessionPrompt();
      break;

    // User message from another device
    case 'user_broadcast': {
      const images = (msg.images || []).map((f) => ({ filename: f, objectUrl: `/data/images/${f}` }));
      chat.addUserMessage(msg.content || '', images.length ? images : undefined);
      chat.showThinking('Thinking...');
      chat.awaitingFirstResponse = true;
      break;
    }

    // Result received — don't ding here (user is viewing this session).
    // Cross-session dings are handled by session_status above.
    case 'result':
      dingArmed = false;
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

  // Check current state from server and seed localStorage
  try {
    const res = await fetch('/api/ntfy');
    const data = await res.json();
    btn.style.display = 'inline-block';
    updateNtfyButton(btn, !!data.topic);
    if (data.topic) localStorage.setItem('pilotcode_ntfy_topic', data.topic);
  } catch {
    btn.style.display = 'inline-block';
    updateNtfyButton(btn, false);
  }

  btn.onclick = async () => {
    const res = await fetch('/api/ntfy');
    const data = await res.json();

    if (data.topic) {
      // Disable — remember topic so user can re-enable easily
      localStorage.setItem('pilotcode_ntfy_topic', data.topic);
      await fetch('/api/ntfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: null }),
      });
      updateNtfyButton(btn, false);
    } else {
      // Enable — pre-fill with last-used topic so user can just press Enter
      const lastTopic = localStorage.getItem('pilotcode_ntfy_topic') || '';
      const topic = prompt(
        lastTopic
          ? 'Re-enable with your previous topic? Edit or press OK.'
          : 'Enter your ntfy topic (from the ntfy app on your phone).\n\n' +
            'If you don\'t have one yet:\n' +
            '1. Install "ntfy" from the App Store\n' +
            '2. Tap + to subscribe to a topic\n' +
            '3. Pick any name and paste it here',
        lastTopic
      );
      if (topic && topic.trim()) {
        localStorage.setItem('pilotcode_ntfy_topic', topic.trim());
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
  // Show banner above input — input stays visible for interaction
  let banner = document.getElementById('watch-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'watch-banner';
    const inputArea = document.getElementById('input-area');
    inputArea.parentNode.insertBefore(banner, inputArea);
  }
  banner.innerHTML = '<span class="watch-dot"></span> Live session';
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

// ── Archive Mode ──

function initArchives() {
  const chip = document.getElementById('archives-chip');
  const dropdown = document.getElementById('archives-dropdown');
  const backBtn = document.getElementById('archive-back-btn');

  chip.onclick = () => {
    dropdown.classList.toggle('hidden');
  };

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!chip.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  backBtn.onclick = () => exitArchiveMode();
}

async function refreshArchivesChip(cwd) {
  const chipWrap = document.getElementById('archives-chip-wrap');
  const chip = document.getElementById('archives-chip');
  if (!cwd) { chipWrap.style.display = 'none'; return; }

  try {
    const res = await fetch(`/api/archives?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) { chipWrap.style.display = 'none'; return; }
    const archives = await res.json();
    if (archives.length === 0) { chipWrap.style.display = 'none'; return; }

    chipWrap.style.display = '';
    chip.textContent = `${archives.length} prev`;
    chip.title = `${archives.length} previous session${archives.length > 1 ? 's' : ''} for this project`;

    const dropdown = document.getElementById('archives-dropdown');
    dropdown.innerHTML = archives.map((a) => {
      const date = new Date(a.lastUsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<div class="archive-item" data-id="${a.id}">
        <span class="archive-name">${a.name}</span>
        <span class="archive-date">${date}</span>
      </div>`;
    }).join('');

    dropdown.querySelectorAll('.archive-item').forEach((el) => {
      el.onclick = () => {
        dropdown.classList.add('hidden');
        enterArchiveMode(el.dataset.id);
      };
    });
  } catch { chipWrap.style.display = 'none'; }
}

async function enterArchiveMode(archiveSessionId) {
  archiveMode = true;
  archiveReturnSessionId = sessionUI.currentSessionId;

  // Hide input, show banner
  document.getElementById('input-area').style.display = 'none';
  const banner = document.getElementById('archive-banner');
  banner.style.display = '';

  // Load archive history read-only
  chat.messagesEl.innerHTML = '';
  try {
    const res = await fetch(`/api/history/${archiveSessionId}`);
    if (res.ok) {
      const history = await res.json();
      if (Array.isArray(history)) {
        // Render all entries (no cap — archives tend to be finite)
        const RENDER_CAP = 100;
        const offset = Math.max(0, history.length - RENDER_CAP);
        for (let i = offset; i < history.length; i++) {
          chat._renderHistoryEntry(history[i]);
        }
      }
    }
  } catch {}
  chat.forceScrollToBottom();
}

function exitArchiveMode() {
  archiveMode = false;
  document.getElementById('input-area').style.display = '';
  document.getElementById('archive-banner').style.display = 'none';

  // Restore active session
  if (archiveReturnSessionId) {
    chat.switchSession(archiveReturnSessionId);
    chat.loadHistory(archiveReturnSessionId);
  }
  archiveReturnSessionId = null;
}

// Register service worker with auto-update for iOS Safari.
// iOS checks for SW updates very lazily, especially in PWA mode.
// We force an update check every time the user returns to the app,
// and auto-reload when a new SW takes control.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
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
