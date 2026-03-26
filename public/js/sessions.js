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
    this.selectedCwd = null;
    this.currentBrowsePath = null;
    this.isDragging = false;
    this.setupCwdPicker();
    this.setupExternalSection();
    this.setupDragReorder();
  }

  openDrawer() {
    // Update active highlight on stale DOM immediately (before async fetch)
    this.list.querySelectorAll('.session-item').forEach(el => {
      el.classList.toggle('active', el.dataset.sessionId === this.currentSessionId);
    });
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
    if (this.isDragging) return; // don't re-render during drag
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const sessions = await res.json();
      this.pilotcodeSessions = sessions; // cache for active session matching
      this.renderList(sessions);
    } catch { /* offline */ }
  }

  renderList(sessions) {
    if (this.isDragging) return;
    this.list.innerHTML = '';
    if (sessions.length === 0) {
      this.list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:13px;">No sessions yet. Send a message or tap "+ New".</div>';
      return;
    }

    // Apply custom order if saved, otherwise sort by last used
    const customOrder = this.getSessionOrder();
    if (customOrder) {
      const orderMap = new Map(customOrder.map((id, i) => [id, i]));
      sessions.sort((a, b) => {
        const ai = orderMap.has(a.id) ? orderMap.get(a.id) : -1;
        const bi = orderMap.has(b.id) ? orderMap.get(b.id) : -1;
        if (ai === -1 && bi === -1) return new Date(b.lastUsed) - new Date(a.lastUsed);
        if (ai === -1) return -1; // new sessions at top
        if (bi === -1) return 1;
        return ai - bi;
      });
    } else {
      sessions.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
    }

    for (const s of sessions) {
      const el = document.createElement('div');
      el.className = 'session-item' + (s.id === this.currentSessionId ? ' active' : '');
      el.dataset.sessionId = s.id;
      el.innerHTML = `
        <div class="session-item-row">
          <span class="drag-handle">&#x22EE;</span>
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
        if (this.isDragging) return; // don't switch during drag
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

  // ── Drag-to-Reorder ──

  setupDragReorder() {
    const list = this.list;

    const startDrag = (item, clientY) => {
      const allItems = [...list.querySelectorAll('.session-item')];
      const rects = allItems.map(el => el.getBoundingClientRect());
      const index = allItems.indexOf(item);

      this._dragState = {
        item,
        index,
        currentIndex: index,
        startY: clientY,
        itemRect: rects[index],
        allItems,
        rects,
      };

      item.classList.add('dragging');
      this.isDragging = true;
    };

    const moveDrag = (clientY) => {
      const s = this._dragState;
      if (!s) return;

      const dy = clientY - s.startY;
      s.item.style.transform = `translateY(${dy}px)`;
      s.item.style.zIndex = '100';
      s.item.style.position = 'relative';

      const dragCenter = s.itemRect.top + s.itemRect.height / 2 + dy;

      let newIndex = s.index;
      for (let i = 0; i < s.rects.length; i++) {
        if (i === s.index) continue;
        const center = s.rects[i].top + s.rects[i].height / 2;
        if (s.index < i && dragCenter > center) newIndex = i;
        if (s.index > i && dragCenter < center && i < newIndex) newIndex = i;
      }

      for (let i = 0; i < s.allItems.length; i++) {
        if (i === s.index) continue;
        const shouldShift =
          (s.index < newIndex && i > s.index && i <= newIndex) ||
          (s.index > newIndex && i < s.index && i >= newIndex);
        if (shouldShift) {
          const dir = s.index < newIndex ? -1 : 1;
          s.allItems[i].style.transform = `translateY(${dir * s.itemRect.height}px)`;
          s.allItems[i].style.transition = 'transform 0.15s ease';
        } else {
          s.allItems[i].style.transform = '';
          s.allItems[i].style.transition = 'transform 0.15s ease';
        }
      }

      s.currentIndex = newIndex;
    };

    const endDrag = () => {
      const s = this._dragState;
      if (!s) return;

      s.item.classList.remove('dragging');

      if (s.currentIndex !== s.index) {
        // Calculate new order
        const ids = s.allItems.map(el => el.dataset.sessionId);
        const [moved] = ids.splice(s.index, 1);
        ids.splice(s.currentIndex, 0, moved);
        this.saveSessionOrder(ids);

        // Reorder DOM nodes to match visual positions BEFORE clearing
        // transforms — this prevents any visible snap-back
        for (const id of ids) {
          const el = list.querySelector(`[data-session-id="${id}"]`);
          if (el) list.appendChild(el);
        }
      }

      // Clear transforms after DOM is in final order — no visual jump
      s.allItems.forEach(el => {
        el.style.transform = '';
        el.style.transition = '';
        el.style.zIndex = '';
        el.style.position = '';
      });

      this._dragState = null;
      setTimeout(() => { this.isDragging = false; }, 50);
    };

    // ── Touch events (iOS Safari / mobile) ──
    // Only attach non-passive touchmove/touchend DURING a drag so that
    // normal list scrolling isn't blocked by iOS Safari's scroll optimization.
    const onTouchMove = (e) => {
      e.preventDefault(); // prevent scroll while dragging
      moveDrag(e.touches[0].clientY);
    };
    const onTouchEnd = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      endDrag();
    };

    list.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const item = handle.closest('.session-item');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(item, e.touches[0].clientY);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchEnd);
    }, { passive: false });

    // ── Mouse events (desktop) ──
    list.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const item = handle.closest('.session-item');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(item, e.clientY);

      const onMouseMove = (e) => moveDrag(e.clientY);
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        endDrag();
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  saveSessionOrder(ids) {
    localStorage.setItem('pilotcode_session_order', JSON.stringify(ids));
  }

  getSessionOrder() {
    try {
      const order = localStorage.getItem('pilotcode_session_order');
      return order ? JSON.parse(order) : null;
    } catch { return null; }
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
    const dirList = document.getElementById('cwd-dir-list');
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

      // Render directory list as tappable items
      dirList.innerHTML = '';
      if (data.directories.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cwd-dir-empty';
        empty.textContent = '(no subdirectories)';
        dirList.appendChild(empty);
      } else {
        for (const dir of data.directories) {
          const item = document.createElement('div');
          item.className = 'cwd-dir-item';
          item.dataset.path = dir.path;
          item.innerHTML = `<span class="cwd-dir-icon">\u{1F4C1}</span><span>${escapeHtml(dir.name)}</span>`;
          item.onclick = () => this.loadDirectories(dir.path);
          dirList.appendChild(item);
        }
      }
    } catch { /* offline */ }
  }

  setupCwdPicker() {
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
      const data = await res.json();
      // Update section header based on server platform
      const label = this.externalSection.querySelector('.section-label');
      if (label && data.platform) {
        label.textContent = data.platform === 'darwin' ? 'Active on Mac' : 'Active on Linux';
      }
      this.renderActiveSessions(data.sessions || []);
    } catch { /* offline */ }
  }

  renderActiveSessions(sessions) {
    this.externalList.innerHTML = '';
    this.externalCount.textContent = sessions.length;

    if (sessions.length === 0) {
      this.externalSection.style.display = 'none';
      return;
    }

    this.externalSection.style.display = '';

    for (const s of sessions) {
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

  /** Transition from watch mode to a connected session (stays in Mac section). */
  connectWatchedSession() {
    const meta = this.watchMeta;
    if (!meta) return;
    this.watchMeta = null;
    this.currentSessionId = '__creating__';
    this.wsClient.setActiveSession(null);
    this.wsClient.send({ type: 'connect_external_session', sessionId: meta.sessionId, cwd: meta.cwd, name: meta.name, skipSave: true });
    this.onSessionChange(meta.name, '__creating__', meta.cwd);
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
