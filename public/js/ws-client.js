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
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;

    this.onStatusChange('connecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.onStatusChange('connected');
      this.reconnectDelay = 1000;

      // Re-associate with the active session after reconnecting
      if (this.activeSessionId) {
        this.send({ type: 'rejoin_session', sessionId: this.activeSessionId });
      }

      // Flush any messages that were queued while disconnected
      this.flushPending();
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Strip internal session tag before passing to the app.
        delete msg._sid;

        this.onMessage(msg);
      } catch { /* ignore non-JSON */ }
    };

    this.ws.onclose = (e) => {
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

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
