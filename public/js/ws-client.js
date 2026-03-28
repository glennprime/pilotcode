export class WSClient {
  constructor(onMessage, onStatusChange) {
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 10000; // reduced from 30s — mobile users shouldn't wait long
    this.shouldReconnect = true;
    this.activeSessionId = null;
    this.pendingMessages = []; // queue messages while disconnected
    this.heartbeatInterval = null;
    this.lastMessageTime = 0;
  }

  connect() {
    // Close any existing connection to prevent orphaned WebSockets.
    // Without this, the old socket's onclose fires and calls connect() again,
    // creating duplicate connections that each receive broadcasts independently.
    if (this.ws) {
      this.ws.onclose = null; // prevent recursive reconnect from old socket
      this.ws.onmessage = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;

    this.onStatusChange('connecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.onStatusChange('connected');
      this.reconnectDelay = 1000;
      this.lastMessageTime = Date.now();
      this.startHeartbeat();

      // Re-associate with the active session after reconnecting
      if (this.activeSessionId) {
        this.send({ type: 'rejoin_session', sessionId: this.activeSessionId });
      }

      // Flush any messages that were queued while disconnected
      this.flushPending();
    };

    this.ws.onmessage = (e) => {
      this.lastMessageTime = Date.now();
      try {
        const msg = JSON.parse(e.data);

        // Filter out messages from other sessions to prevent cross-contamination.
        // Messages without _sid (direct sends like session_rejoined) always pass through.
        if (msg._sid && this.activeSessionId && msg._sid !== this.activeSessionId) {
          return; // wrong session — discard
        }
        // Preserve source session for secondary checks, then strip the tag
        const fromSession = msg._sid || null;
        delete msg._sid;
        msg._fromSession = fromSession;

        // Handle application-level pong silently
        if (msg.type === 'pong') return;

        this.onMessage(msg);
      } catch { /* ignore non-JSON */ }
    };

    this.ws.onclose = (e) => {
      this.stopHeartbeat();
      this.onStatusChange('disconnected');
      if (e.code === 4001) {
        // Auth failed — don't reconnect
        this.shouldReconnect = false;
        this.onStatusChange('auth_failed');
        return;
      }
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    // Queue user messages and interrupts for delivery after reconnect
    if (msg.type === 'message' || msg.type === 'interrupt' || msg.type === 'permission_response') {
      this.pendingMessages.push(msg);
    }
    return false;
  }

  flushPending() {
    if (this.pendingMessages.length === 0) return;
    // Small delay to let rejoin_session complete first
    setTimeout(() => {
      const msgs = [...this.pendingMessages];
      this.pendingMessages = [];
      for (const msg of msgs) {
        this.send(msg);
      }
    }, 500);
  }

  setActiveSession(sessionId) {
    this.activeSessionId = sessionId;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    // Send app-level pings to keep lastMessageTime fresh.
    // The server responds with a pong (handled silently in onmessage),
    // which proves the connection is alive even when no session messages flow.
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastMessageTime > 45_000) {
          // No messages for 45s — send a ping to check. If the server
          // responds, lastMessageTime updates and we won't hit the 90s limit.
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
        if (Date.now() - this.lastMessageTime > 90_000) {
          // No response to our ping for 90s — connection is truly dead.
          console.warn('[ws] Connection dead — no response for 90s, reconnecting');
          this.ws.close();
        }
      }
    }, 30_000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close();
  }
}
