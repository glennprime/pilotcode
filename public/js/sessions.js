export class SessionUI {
  constructor(wsClient, onSessionChange) {
    this.wsClient = wsClient;
    this.onSessionChange = onSessionChange;
    this.currentSessionId = null;

    this.drawer = document.getElementById('session-drawer');
    this.overlay = document.getElementById('drawer-overlay');
    this.list = document.getElementById('session-list');
    this.modal = document.getElementById('new-session-modal');

    document.getElementById('menu-btn').onclick = () => this.openDrawer();
    this.overlay.onclick = () => this.closeDrawer();
    document.getElementById('new-session-btn').onclick = () => this.showNewSessionModal();
    document.getElementById('modal-cancel').onclick = () => this.hideNewSessionModal();
    document.getElementById('modal-create').onclick = () => this.createSession();
  }

  openDrawer() {
    this.drawer.classList.add('open');
    this.overlay.classList.add('active');
    this.refreshList();
  }

  closeDrawer() {
    this.drawer.classList.remove('open');
    this.overlay.classList.remove('active');
  }

  async refreshList() {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const sessions = await res.json();
      this.renderList(sessions);
    } catch { /* offline */ }
  }

  renderList(sessions) {
    this.list.innerHTML = '';
    if (sessions.length === 0) {
      this.list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No sessions yet</div>';
      return;
    }

    sessions.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = 'session-item' + (s.id === this.currentSessionId ? ' active' : '');
      el.innerHTML = `
        <div class="session-item-name">
          ${s.active ? '<span class="active-dot"></span>' : ''}${escapeHtml(s.name)}
        </div>
        <div class="session-item-meta">${s.cwd} &middot; ${timeAgo(s.lastUsed)}</div>
      `;
      el.onclick = () => {
        this.resumeSession(s.id);
        this.closeDrawer();
      };
      this.list.appendChild(el);
    }
  }

  showNewSessionModal() {
    this.modal.classList.add('active');
    document.getElementById('session-name-input').value = '';
    document.getElementById('session-cwd-input').value = '';
    document.getElementById('session-name-input').focus();
  }

  hideNewSessionModal() {
    this.modal.classList.remove('active');
  }

  createSession() {
    const name = document.getElementById('session-name-input').value.trim() || 'New Session';
    const cwd = document.getElementById('session-cwd-input').value.trim() || undefined;

    this.wsClient.send({ type: 'create_session', name, cwd });
    this.hideNewSessionModal();
    this.closeDrawer();
    this.onSessionChange(name);
  }

  resumeSession(sessionId) {
    this.wsClient.send({ type: 'resume_session', sessionId });
    this.currentSessionId = sessionId;
  }

  setCurrentSession(sessionId, name) {
    this.currentSessionId = sessionId;
    document.getElementById('session-name').textContent = name || sessionId?.slice(0, 8) || 'No Session';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
