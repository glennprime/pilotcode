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
    document.getElementById('connect-session-btn').onclick = () => this.showConnectModal();
    document.getElementById('connect-modal-cancel').onclick = () => this.hideConnectModal();
    document.getElementById('connect-modal-go').onclick = () => this.connectExternalSession();
    this.selectedCwd = null;
    this.currentBrowsePath = null;
    this.selectedExternal = null;
    this.setupCwdPicker();
    this.setupConnectTabs();
    this.setupExternalSection();
  }

  openDrawer() {
    this.drawer.classList.add('open');
    this.overlay.classList.add('active');
    this.refreshList();
    this.refreshExternalList(); // fetch external sessions once on open
    // Poll while drawer is open so busy dots stay fresh
    this._pollTimer = setInterval(() => this.refreshList(), 3000);
  }

  closeDrawer() {
    this.drawer.classList.remove('open');
    this.overlay.classList.remove('active');
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async refreshList() {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const sessions = await res.json();
      this.pilotcodeSessions = sessions; // cache for active session matching
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
      el.dataset.sessionId = s.id;
      el.innerHTML = `
        <div class="session-item-row">
          <div class="session-item-name">
            ${s.busy ? '<span class="active-dot busy"></span>' : s.active ? '<span class="active-dot"></span>' : ''}${escapeHtml(s.name)}
          </div>
          <button class="session-delete-btn" title="Delete">&times;</button>
        </div>
        <div class="session-item-meta">${escapeHtml(s.cwd)} &middot; ${s.model ? shortModel(s.model) : 'Sonnet'} &middot; ${timeAgo(s.lastUsed)}</div>
      `;

      // Delete button
      el.querySelector('.session-delete-btn').onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${s.name}"?`)) {
          this.deleteSession(s.id);
        }
      };

      // Tap anywhere else to switch session
      el.onclick = () => {
        this.resumeSession(s.id, s.name, s.cwd);
        this.closeDrawer();
      };

      // Long-press for rename/delete actions
      let pressTimer = null;
      let didLongPress = false;
      const startPress = (e) => {
        didLongPress = false;
        pressTimer = setTimeout(() => {
          didLongPress = true;
          e.preventDefault();
          this.showSessionActions(s.id, s.name, el);
        }, 500);
      };
      const cancelPress = () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      };
      const endPress = (e) => {
        cancelPress();
        // If long-press triggered, prevent the tap from also firing
        if (didLongPress) { e.preventDefault(); e.stopPropagation(); }
      };
      el.addEventListener('touchstart', startPress, { passive: false });
      el.addEventListener('touchend', endPress);
      el.addEventListener('touchcancel', cancelPress);
      el.addEventListener('touchmove', cancelPress);
      // Desktop: right-click for actions
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showSessionActions(s.id, s.name, el);
      });

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

  deleteSession(sessionId) {
    // Clear UI immediately — don't wait for the server response
    this.currentSessionId = null;
    this.wsClient.setActiveSession(null);
    localStorage.removeItem('pilotcode_session');
    localStorage.removeItem('pilotcode_session_cwd');
    document.getElementById('session-name').textContent = 'No Session';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('no-session-prompt').classList.add('active');
    document.getElementById('messages').style.display = 'none';
    document.getElementById('input-area').style.display = 'none';
    document.getElementById('input-area').classList.remove('busy');
    this.onSessionChange(null, null);
    // Delete on server in background
    fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    this.refreshList();
  }

  showSessionActions(sessionId, name, el) {
    // Remove any existing action sheet
    document.querySelectorAll('.session-action-sheet').forEach(s => s.remove());

    const sheet = document.createElement('div');
    sheet.className = 'session-action-sheet';
    sheet.innerHTML = `
      <button class="session-action rename-action">Rename</button>
      <button class="session-action delete-action">Delete</button>
      <button class="session-action cancel-action">Cancel</button>
    `;

    sheet.querySelector('.rename-action').onclick = (e) => {
      e.stopPropagation();
      sheet.remove();
      this.renameSession(sessionId, name, el);
    };

    sheet.querySelector('.delete-action').onclick = (e) => {
      e.stopPropagation();
      sheet.remove();
      if (confirm(`Delete "${name}"? This cannot be undone.`)) {
        this.deleteSession(sessionId);
      }
    };

    sheet.querySelector('.cancel-action').onclick = (e) => {
      e.stopPropagation();
      sheet.remove();
    };

    el.appendChild(sheet);
  }

  showNewSessionModal() {
    this.modal.classList.add('active');
    document.getElementById('session-name-input').value = '';
    this.selectedCwd = null;
    this.loadModels();
    this.loadDirectories(); // load root directories
    document.getElementById('session-name-input').focus();
  }

  async loadModels() {
    const select = document.getElementById('session-model-select');
    try {
      const res = await fetch('/api/models');
      if (!res.ok) return;
      const models = await res.json();
      select.innerHTML = '';
      // "Default" option lets Claude CLI pick its own default
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Default (CLI default)';
      select.appendChild(defaultOpt);
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        select.appendChild(opt);
      }
      // Default to first real model (Opus)
      if (models.length > 0) select.value = models[0].id;
    } catch { /* offline — keep whatever's there */ }
  }

  hideNewSessionModal() {
    this.modal.classList.remove('active');
  }

  async loadDirectories(path) {
    const select = document.getElementById('session-cwd-select');
    const breadcrumb = document.getElementById('cwd-breadcrumb');
    const url = path ? `/api/directories?path=${encodeURIComponent(path)}` : '/api/directories';
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      this.currentBrowsePath = data.parent;
      this.selectedCwd = data.parent;

      // Update path input
      const pathInput = document.getElementById('cwd-path-input');
      pathInput.value = data.parent;

      // Render breadcrumb with root
      const parts = data.parent.split('/').filter(Boolean);
      let html = `<span class="crumb${parts.length === 0 ? ' active' : ''}" data-path="/">/</span>`;
      let accumulated = '';
      for (let i = 0; i < parts.length; i++) {
        accumulated += '/' + parts[i];
        const path = accumulated;
        const isLast = i === parts.length - 1;
        html += `<span class="crumb-sep">/</span>`;
        html += `<span class="crumb${isLast ? ' active' : ''}" data-path="${escapeHtml(path)}">${escapeHtml(parts[i])}</span>`;
      }
      breadcrumb.innerHTML = html;
      breadcrumb.querySelectorAll('.crumb:not(.active)').forEach((el) => {
        el.onclick = () => this.loadDirectories(el.dataset.path);
      });

      // Render directory list
      select.innerHTML = '';
      if (data.directories.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = '(no subdirectories)';
        opt.disabled = true;
        select.appendChild(opt);
      } else {
        for (const dir of data.directories) {
          const opt = document.createElement('option');
          opt.value = dir.path;
          opt.textContent = dir.name;
          select.appendChild(opt);
        }
      }
    } catch { /* offline */ }
  }

  setupCwdPicker() {
    const select = document.getElementById('session-cwd-select');
    select.addEventListener('dblclick', () => {
      if (select.value) {
        this.loadDirectories(select.value);
      }
    });
    select.addEventListener('change', () => {
      if (select.value) {
        this.selectedCwd = select.value;
      }
    });

    // Path input: type a path and press Enter or click Go
    const pathInput = document.getElementById('cwd-path-input');
    const goBtn = document.getElementById('cwd-path-go');
    const navigateToInput = () => {
      const val = pathInput.value.trim();
      if (val) this.loadDirectories(val);
    };
    goBtn.addEventListener('click', navigateToInput);
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); navigateToInput(); }
    });

    // "qq" tab-completion: typing two q's in a row triggers directory completion
    pathInput.addEventListener('input', () => {
      const val = pathInput.value;
      if (!val.endsWith('qq')) return;
      // Strip the "qq" trigger
      const partial = val.slice(0, -2);
      pathInput.value = partial;
      this.completePath(pathInput);
    });
  }

  async completePath(pathInput) {
    const partial = pathInput.value.trim();
    if (!partial) return;
    try {
      const res = await fetch(`/api/complete-path?path=${encodeURIComponent(partial)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.completed !== partial) {
        pathInput.value = data.completed;
        // If single match completed to a full directory, also refresh the browser below
        if (data.matches.length === 1) {
          this.loadDirectories(data.completed);
        }
      }
    } catch { /* offline */ }
  }

  createSession() {
    const cwdPath = this.selectedCwd || undefined;
    const dirName = cwdPath ? cwdPath.split('/').filter(Boolean).pop() : null;
    const name = document.getElementById('session-name-input').value.trim() || dirName || 'New Session';
    const model = document.getElementById('session-model-select').value || undefined;

    // Mark as creating — sendMessage() will queue messages until session_created arrives
    this.currentSessionId = '__creating__';
    // Clear the active session filter so the new session's messages aren't blocked
    this.wsClient.setActiveSession(null);
    this.wsClient.send({ type: 'create_session', name, cwd: cwdPath, model });
    this.hideNewSessionModal();
    this.closeDrawer();
    // Show the chat UI immediately — don't wait for server response
    this.onSessionChange(name, '__creating__', cwdPath);
  }

  resumeSession(sessionId, name, cwd) {
    if (sessionId === this.currentSessionId) return; // already active
    this.currentSessionId = sessionId;
    localStorage.setItem('pilotcode_session', sessionId);
    if (cwd) localStorage.setItem('pilotcode_session_cwd', cwd);
    this.wsClient.setActiveSession(sessionId);
    this.wsClient.send({ type: 'resume_session', sessionId });
    document.getElementById('session-name').textContent = name || sessionId.slice(0, 8);
    this.onSessionChange(name, sessionId, cwd);
  }

  // ── External Sessions in Sidebar ──

  setupExternalSection() {
    this.externalSection = document.getElementById('external-section');
    this.externalList = document.getElementById('external-list');
    this.externalCount = document.getElementById('external-count');
    this.externalToggle = document.getElementById('external-section-toggle');

    // Restore collapsed state (default: expanded)
    const collapsed = localStorage.getItem('pilotcode_external_collapsed') === 'true';
    if (collapsed) {
      this.externalList.classList.add('collapsed');
    } else {
      this.externalToggle.classList.add('expanded');
    }

    this.externalToggle.onclick = () => {
      const isCollapsed = this.externalList.classList.toggle('collapsed');
      this.externalToggle.classList.toggle('expanded', !isCollapsed);
      localStorage.setItem('pilotcode_external_collapsed', String(isCollapsed));
    };
  }

  async refreshExternalList() {
    try {
      const res = await fetch('/api/active-sessions');
      if (!res.ok) return;
      const sessions = await res.json();
      this.renderActiveSessions(sessions);
    } catch { /* offline */ }
  }

  renderActiveSessions(sessions) {
    this.externalList.innerHTML = '';

    // Filter out sessions that already have a PilotCode session with the same cwd
    const pcCwds = new Set((this.pilotcodeSessions || []).map(pc => pc.cwd));
    const filtered = sessions.filter(s => !pcCwds.has(s.cwd));

    this.externalCount.textContent = filtered.length;

    if (filtered.length === 0) {
      this.externalSection.style.display = 'none';
      return;
    }

    this.externalSection.style.display = '';

    for (const s of filtered) {
      const dirName = s.cwd.split('/').filter(Boolean).pop() || s.cwd;
      const el = document.createElement('div');
      el.className = 'ext-active-item';
      el.innerHTML = `
        <div class="ext-active-row">
          <span class="active-dot busy"></span>
          <span class="ext-active-name">${escapeHtml(dirName)}</span>
        </div>
        <div class="ext-active-meta">${escapeHtml(s.summary || '')} &middot; ${timeAgo(s.lastModified)}</div>
      `;
      el.title = s.cwd;
      el.onclick = () => this.watchFromSidebar(s.sessionId, s.cwd);
      this.externalList.appendChild(el);
    }
  }

  watchFromSidebar(sessionId, cwd) {
    const name = cwd.split('/').filter(Boolean).pop() || 'External Session';
    this.currentSessionId = `watch:${sessionId}`;
    this.watchMeta = { sessionId, cwd, name }; // for connect-on-send
    this.wsClient.setActiveSession(null);
    this.wsClient.send({ type: 'watch_session', sessionId, cwd });
    this.closeDrawer();
    this.onSessionChange(name, null, cwd);
    document.getElementById('session-name').textContent = `${name}`;
  }

  /** Transition from watch mode to a connected session. */
  connectWatchedSession() {
    const meta = this.watchMeta;
    if (!meta) return;
    this.watchMeta = null;
    this.currentSessionId = '__creating__';
    this.wsClient.setActiveSession(null);
    this.wsClient.send({ type: 'connect_external_session', sessionId: meta.sessionId, cwd: meta.cwd, name: meta.name });
    this.onSessionChange(meta.name, '__creating__', meta.cwd);
  }

  // ── Connect to External Session ──

  setupConnectTabs() {
    const tabs = document.querySelectorAll('.connect-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('connect-browse-tab').style.display =
          tab.dataset.tab === 'browse' ? '' : 'none';
        document.getElementById('connect-manual-tab').style.display =
          tab.dataset.tab === 'manual' ? '' : 'none';
      };
    });
  }

  showConnectModal() {
    document.getElementById('connect-session-modal').classList.add('active');
    this.loadExternalSessions();
  }

  hideConnectModal() {
    document.getElementById('connect-session-modal').classList.remove('active');
    this.selectedExternal = null;
  }

  async loadExternalSessions() {
    const loading = document.getElementById('external-sessions-loading');
    const list = document.getElementById('external-sessions-list');
    const empty = document.getElementById('external-sessions-empty');

    loading.style.display = '';
    list.innerHTML = '';
    empty.style.display = 'none';

    try {
      const res = await fetch('/api/external-sessions');
      if (!res.ok) throw new Error();
      const groups = await res.json();
      loading.style.display = 'none';

      if (groups.length === 0) {
        empty.style.display = '';
        return;
      }

      this.renderExternalSessions(groups, list);
    } catch {
      loading.style.display = 'none';
      empty.style.display = '';
      empty.textContent = 'Failed to load sessions.';
    }
  }

  renderExternalSessions(groups, container) {
    this.selectedExternal = null;

    for (const group of groups) {
      const header = document.createElement('div');
      header.className = 'ext-group-header';
      header.innerHTML = `<span class="ext-group-path">${escapeHtml(group.cwd)}</span>
        <span class="ext-group-count">${group.sessions.length}</span>`;
      container.appendChild(header);

      for (const s of group.sessions) {
        const el = document.createElement('div');
        el.className = 'ext-session-item';
        el.dataset.sessionId = s.id;
        el.dataset.cwd = group.cwd;
        el.innerHTML = `
          <div class="ext-session-id">${s.id.slice(0, 8)}...</div>
          <div class="ext-session-summary">${escapeHtml(s.summary || '(no preview)')}</div>
          <div class="ext-session-meta">${timeAgo(s.lastModified)} &middot; ${formatSize(s.sizeBytes)}</div>
        `;
        el.onclick = () => {
          container.querySelectorAll('.ext-session-item.selected').forEach(
            el => el.classList.remove('selected')
          );
          el.classList.add('selected');
          this.selectedExternal = { id: s.id, cwd: group.cwd, summary: s.summary };
        };
        container.appendChild(el);
      }
    }
  }

  connectExternalSession() {
    const browseActive = document.querySelector('.connect-tab.active')?.dataset.tab === 'browse';

    let sessionId, cwd, name;

    if (browseActive) {
      if (!this.selectedExternal) return;
      sessionId = this.selectedExternal.id;
      cwd = this.selectedExternal.cwd;
      name = cwd.split('/').filter(Boolean).pop() || 'External Session';
    } else {
      sessionId = document.getElementById('connect-session-id').value.trim();
      name = document.getElementById('connect-session-name').value.trim() || 'External Session';
      if (!sessionId) return;
    }

    this.currentSessionId = '__creating__';
    this.wsClient.send({ type: 'connect_external_session', sessionId, cwd, name });
    this.hideConnectModal();
    this.closeDrawer();
    this.onSessionChange(name, null);
  }

  setCurrentSession(sessionId) {
    this.currentSessionId = sessionId;
    localStorage.setItem('pilotcode_session', sessionId);
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

  updateSessionBusy(sessionId, busy) {
    const item = this.list.querySelector(`[data-session-id="${sessionId}"]`);
    if (!item) return;
    const dot = item.querySelector('.active-dot');
    if (dot) {
      dot.classList.toggle('busy', busy);
    }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortModel(model) {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('haiku')) return 'Haiku';
  return 'Sonnet';
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

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
