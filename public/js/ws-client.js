export class WSClient {
  constructor(onMessage, onStatusChange) {
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.shouldReconnect = true;
    this.activeSessionId = null;
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
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Strip internal session tag before passing to the app.
        // Session isolation is handled server-side: the server immediately
        // removes the client from the old session's broadcast list on switch,
        // so only messages from the active session reach this client.
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
    return false;
  }

  setActiveSession(sessionId) {
    this.activeSessionId = sessionId;
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
