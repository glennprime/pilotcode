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
      this.list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No sessions yet. Send a message or tap "+ New".</div>';
      return;
    }

    sessions.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));

    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = 'session-item' + (s.id === this.currentSessionId ? ' active' : '');
      el.innerHTML = `
        <div class="session-item-row">
          <div class="session-item-name">
            ${s.active ? '<span class="active-dot"></span>' : ''}${escapeHtml(s.name)}
          </div>
          <button class="session-rename-btn" title="Rename">&#9998;</button>
          <button class="session-delete-btn" title="Delete">&times;</button>
        </div>
        <div class="session-item-meta">${escapeHtml(s.cwd)} &middot; ${timeAgo(s.lastUsed)}</div>
      `;

      // Click to resume
      el.querySelector('.session-item-name').onclick = () => {
        this.resumeSession(s.id, s.name);
        this.closeDrawer();
      };

      // Rename button
      el.querySelector('.session-rename-btn').onclick = (e) => {
        e.stopPropagation();
        this.renameSession(s.id, s.name, el);
      };

      // Delete button
      el.querySelector('.session-delete-btn').onclick = (e) => {
        e.stopPropagation();
        this.deleteSession(s.id);
      };

      this.list.appendChild(el);
    }
  }

  renameSession(sessionId, currentName, el) {
    const nameEl = el.querySelector('.session-item-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'session-rename-input';
    input.style.cssText = 'width:100%;background:var(--bg);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text);font-size:14px;outline:none;';

    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
      const newName = input.value.trim() || currentName;
      try {
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
      } catch { /* ignore */ }
      // Update header if this is the current session
      if (sessionId === this.currentSessionId) {
        document.getElementById('session-name').textContent = newName;
      }
      this.refreshList();
    };

    input.onblur = save;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    };
  }

  async deleteSession(sessionId) {
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (sessionId === this.currentSessionId) {
      this.currentSessionId = null;
      document.getElementById('session-name').textContent = 'No Session';
    }
    this.refreshList();
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

    // Clear current session so the new one takes over
    this.currentSessionId = null;
    this.wsClient.send({ type: 'create_session', name, cwd });
    this.hideNewSessionModal();
    this.closeDrawer();
    this.onSessionChange(name, null);
  }

  resumeSession(sessionId, name) {
    if (sessionId === this.currentSessionId) return; // already active
    this.currentSessionId = sessionId;
    this.wsClient.send({ type: 'resume_session', sessionId });
    document.getElementById('session-name').textContent = name || sessionId.slice(0, 8);
    this.onSessionChange(name, sessionId);
  }

  setCurrentSession(sessionId) {
    this.currentSessionId = sessionId;
    // Fetch the session name from the server
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((sessions) => {
        const s = sessions.find((s) => s.id === sessionId);
        const name = s?.name || sessionId.slice(0, 8);
        document.getElementById('session-name').textContent = name;
      })
      .catch(() => {
        document.getElementById('session-name').textContent = sessionId.slice(0, 8);
      });
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
