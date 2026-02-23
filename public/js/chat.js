import { renderMarkdown, addCopyButtons, linkifyFilePaths } from './markdown.js';
import { renderPermissionCard, cancelPermissionCard, renderPlanCard, renderQuestionCard } from './permissions.js';

export class Chat {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.messagesEl = document.getElementById('messages');
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
    this.sessionId = null;
    this.history = [];
    this.saveTimer = null;
    this.thinkingEl = null;
    this.activeTasks = new Map(); // id -> { name, description, status }
    this.renderedMessageIds = new Set(); // dedup assistant messages during buffer replay
    this.renderedFileLinks = new Set(); // dedup file download links by message id
    this.sessionCwd = ''; // working directory for resolving relative paths
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
  }

  setWorking(active) {
    document.getElementById('input-area').classList.toggle('busy', active);
  }

  addUserMessage(text, images) {
    const el = document.createElement('div');
    el.className = 'message user';

    let html = '';
    if (images?.length) {
      for (const img of images) {
        const src = img.objectUrl || (img.filename ? `/data/images/${img.filename}` : '');
        if (src) html += `<img class="chat-image" src="${src}">`;
      }
    }
    html += escapeHtml(text);
    el.innerHTML = html;

    this.messagesEl.appendChild(el);
    this.forceScrollToBottom();

    const entry = { role: 'user', text };
    if (images?.length) {
      entry.images = images.map((i) => i.filename || null).filter(Boolean);
    }
    this.history.push(entry);
    // Save user messages immediately — don't debounce.
    // If the user switches sessions quickly, debounced saves can be lost.
    this.saveHistory();
  }

  addAssistantText(text) {
    const el = document.createElement('div');
    el.className = 'message assistant';
    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = renderMarkdown(text);
    addCopyButtons(content);
    linkifyFilePaths(content, this.sessionCwd);
    el.appendChild(content);
    this.messagesEl.appendChild(el);
  }

  addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  addToolUse(name) {
    const el = document.createElement('div');
    el.className = 'tool-use';
    el.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span>`;
    this.messagesEl.appendChild(el);
  }

  showThinking(label) {
    this.hideThinking();
    this.setWorking(true);
    this.thinkingEl = document.createElement('div');
    this.thinkingEl.className = 'thinking';
    this.thinkingEl.innerHTML = `
      <div class="thinking-spinner"></div>
      <span class="thinking-label">${escapeHtml(label || 'Thinking...')}</span>
    `;
    this.messagesEl.appendChild(this.thinkingEl);
    this.scrollToBottom();
  }

  updateThinking(label) {
    if (this.thinkingEl) {
      this.thinkingEl.querySelector('.thinking-label').textContent = label;
    } else {
      this.showThinking(label);
    }
    this.scrollToBottom();
  }

  hideThinking() {
    if (this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
    this.clearTaskList();
  }

  renderTaskList() {
    if (this.activeTasks.size === 0) return;
    const hasRunning = [...this.activeTasks.values()].some(t => t.status === 'running');
    if (!hasRunning) return;

    let container = document.getElementById('task-list');
    if (!container) {
      container = document.createElement('div');
      container.id = 'task-list';
      // Insert before the thinking spinner or at end of messages
      if (this.thinkingEl) {
        this.messagesEl.insertBefore(container, this.thinkingEl);
      } else {
        this.messagesEl.appendChild(container);
      }
    }

    container.innerHTML = '';
    for (const [id, task] of this.activeTasks) {
      const item = document.createElement('div');
      item.className = `task-item ${task.status}`;
      const icon = task.status === 'running' ? '<div class="task-spinner"></div>' : '<span class="task-check">&#10003;</span>';
      item.innerHTML = `${icon}<span class="task-label">${escapeHtml(task.name)}</span>`;
      container.appendChild(item);
    }
    this.scrollToBottom();
  }

  clearTaskList() {
    this.activeTasks.clear();
    const el = document.getElementById('task-list');
    if (el) el.remove();
  }

  clearInteractiveCards() {
    this.messagesEl.querySelectorAll('.question-card, .plan-approval-card').forEach(el => el.remove());
  }

  renderQuestionCard(questions) {
    if (!questions || questions.length === 0) {
      // No structured questions — just transition to input mode
      this.messagesEl.appendChild(createSystemNote('Claude is waiting for your input.'));
      this.forceScrollToBottom();
      return;
    }

    for (const q of questions) {
      const card = document.createElement('div');
      card.className = 'question-card';

      if (q.header) {
        const header = document.createElement('div');
        header.className = 'question-header';
        header.textContent = q.header;
        card.appendChild(header);
      }

      const questionText = document.createElement('div');
      questionText.className = 'question-text';
      questionText.textContent = q.question;
      card.appendChild(questionText);

      if (q.options?.length) {
        const optionsEl = document.createElement('div');
        optionsEl.className = 'question-options';
        const selected = new Set();

        for (const opt of q.options) {
          const btn = document.createElement('button');
          btn.className = 'question-option';
          btn.innerHTML = `<span class="option-label">${escapeHtml(opt.label)}</span>`;
          if (opt.description) {
            btn.innerHTML += `<span class="option-desc">${escapeHtml(opt.description)}</span>`;
          }

          btn.onclick = () => {
            const input = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');

            if (q.multiSelect) {
              // Toggle selection
              if (selected.has(opt.label)) {
                selected.delete(opt.label);
                btn.classList.remove('selected');
              } else {
                selected.add(opt.label);
                btn.classList.add('selected');
              }
              input.value = [...selected].join(', ');
            } else {
              // Single select — deselect others
              optionsEl.querySelectorAll('.question-option').forEach(b => b.classList.remove('selected'));
              btn.classList.add('selected');
              input.value = opt.label;
            }

            input.focus();
            sendBtn.disabled = !input.value.trim();
          };

          optionsEl.appendChild(btn);
        }
        card.appendChild(optionsEl);
      }

      this.messagesEl.appendChild(card);
    }
    this.forceScrollToBottom();
    document.getElementById('message-input').focus();
  }

  renderPlanApproval() {
    const card = document.createElement('div');
    card.className = 'plan-approval-card';

    const label = document.createElement('div');
    label.className = 'plan-label';
    label.textContent = 'Plan ready for approval';
    card.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'plan-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'plan-btn plan-approve';
    approveBtn.textContent = 'Approve';
    approveBtn.onclick = () => {
      const input = document.getElementById('message-input');
      input.value = 'Looks good, proceed.';
      input.dispatchEvent(new Event('input'));
      document.getElementById('send-btn').click();
    };

    const changesBtn = document.createElement('button');
    changesBtn.className = 'plan-btn plan-changes';
    changesBtn.textContent = 'Request Changes';
    changesBtn.onclick = () => {
      const input = document.getElementById('message-input');
      input.value = '';
      input.placeholder = 'Describe the changes you want...';
      input.focus();
    };

    actions.appendChild(approveBtn);
    actions.appendChild(changesBtn);
    card.appendChild(actions);

    this.messagesEl.appendChild(card);
    this.forceScrollToBottom();
  }

  handleSDKMessage(msg, onPermissionResponse) {
    switch (msg.type) {
      case 'system':
        // Don't show "Session started" — it fires on every resume too.
        // The session_resumed handler already shows a message when relevant.
        break;

      case 'assistant': {
        // Check if this message has text or just tool_use
        const content = msg.message?.content;
        const blocks = Array.isArray(content) ? content : [];
        const hasText = blocks.some(b => b.type === 'text' && b.text);
        const toolUses = blocks.filter(b => b.type === 'tool_use');

        // Clear any previous interactive cards (question/plan) when new assistant content arrives
        this.clearInteractiveCards();

        if (hasText) {
          this.hideThinking();
          this.renderAssistantMessage(msg.message);
        }

        // Check for interactive tools that need user input
        const askQuestion = toolUses.find(tu => tu.name === 'AskUserQuestion');
        const exitPlan = toolUses.find(tu => tu.name === 'ExitPlanMode');

        if (askQuestion) {
          this.hideThinking();
          this.setWorking(false);
          this.renderQuestionCard(askQuestion.input?.questions || []);
        } else if (exitPlan) {
          this.hideThinking();
          this.setWorking(false);
          this.renderPlanApproval();
        } else if (toolUses.length > 0) {
          for (const tu of toolUses) {
            if (tu.name === 'Task' && tu.id) {
              const desc = tu.input?.description || tu.input?.subagent_type || 'Agent';
              this.activeTasks.set(tu.id, { name: desc, status: 'running' });
            }
          }
          const lastTool = toolUses[toolUses.length - 1];
          const toolName = this.friendlyToolName(lastTool.name);
          this.updateThinking(toolName);
          this.renderTaskList();
        }

        // Render download links for file operations (Write/Edit/NotebookEdit)
        const msgId = msg.message?.id;
        if (msgId && !this.renderedFileLinks.has(msgId)) {
          const fileTools = toolUses.filter(tu =>
            ['Write', 'Edit', 'NotebookEdit'].includes(tu.name) && tu.input?.file_path
          );
          if (fileTools.length > 0) {
            this.renderedFileLinks.add(msgId);
            this.renderFileLinks(fileTools);
          }
        }
        break;
      }

      case 'user': {
        // These are tool results flowing back — update spinner
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id && this.activeTasks.has(block.tool_use_id)) {
              this.activeTasks.set(block.tool_use_id, { ...this.activeTasks.get(block.tool_use_id), status: 'done' });
              this.renderTaskList();
            }
          }
          const hasToolResult = content.some(b => b.type === 'tool_result');
          if (hasToolResult) {
            this.updateThinking('Processing...');
          }
        }
        break;
      }

      case 'result':
        // Always process — if session is still busy, session_busy re-shows spinner after replay
        this.hideThinking();
        this.finishStreaming();
        this.setWorking(false);
        if (msg.is_error && msg.result) {
          this.addSystemMessage(`Error: ${msg.result}`);
        }
        break;

      case 'session_context_full':
        this.hideThinking();
        this.finishStreaming();
        break;

      case 'plan_approval': {
        this.hideThinking();
        this.finishStreaming();
        const planCard = renderPlanCard(msg, (approved) => {
          this.wsClient.send({ type: 'plan_response', approved });
          this.showThinking(approved ? 'Implementing plan...' : 'Revising plan...');
        });
        this.messagesEl.appendChild(planCard);
        this.forceScrollToBottom();
        break;
      }

      case 'user_question': {
        this.hideThinking();
        this.finishStreaming();
        const qCard = renderQuestionCard(msg, (answers) => {
          this.wsClient.send({ type: 'question_response', answers });
          this.showThinking('Processing your answers...');
        });
        this.messagesEl.appendChild(qCard);
        this.forceScrollToBottom();
        break;
      }

      case 'control_request':
        this.hideThinking();
        this.finishStreaming();
        const card = renderPermissionCard(msg, (requestId, allow) => {
          onPermissionResponse(requestId, allow);
          this.showThinking('Waiting for Claude...');
        });
        this.messagesEl.appendChild(card);
        this.forceScrollToBottom();
        break;

      case 'control_cancel_request':
        cancelPermissionCard(msg.request_id);
        break;

      case 'process_exit':
        this.hideThinking();
        this.finishStreaming();
        this.setWorking(false);
        if (msg.error) {
          this.addSystemMessage(msg.error);
        } else if (msg.code !== 0 && msg.code !== null) {
          this.addSystemMessage('Session ended');
        }
        break;

      case 'error':
        this.hideThinking();
        this.setWorking(false);
        if (msg.error) {
          this.addSystemMessage(msg.error);
        }
        break;

      case 'session_resumed':
        this.addSystemMessage('Session resumed');
        break;
    }
  }

  friendlyToolName(name) {
    const map = {
      Bash: 'Running command...',
      Read: 'Reading file...',
      Write: 'Writing file...',
      Edit: 'Editing file...',
      Glob: 'Searching files...',
      Grep: 'Searching code...',
      Task: 'Running task...',
      WebFetch: 'Fetching URL...',
      WebSearch: 'Searching web...',
    };
    return map[name] || `Using ${name}...`;
  }

  renderAssistantMessage(message) {
    if (!message?.content) return;
    // Deduplicate: skip if this exact message was already rendered (buffer replay)
    const msgId = message.id;
    if (msgId && this.renderedMessageIds.has(msgId)) return;
    if (msgId) this.renderedMessageIds.add(msgId);
    const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: String(message.content) }];

    this.finishStreaming();

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        this.startOrAppendAssistantText(block.text);
      } else if (block.type === 'tool_use') {
        this.finishStreaming();
        // Don't clutter chat with routine tool use labels
      }
    }

    this.scrollToBottom();
  }

  renderFileLinks(fileTools) {
    // Collect unique file paths from Write/Edit/NotebookEdit tool uses
    const seen = new Set();
    const files = [];
    for (const tu of fileTools) {
      const fp = tu.input.file_path;
      if (!seen.has(fp)) {
        seen.add(fp);
        const action = tu.name === 'Write' ? 'Created' : tu.name === 'NotebookEdit' ? 'Edited' : 'Modified';
        files.push({ path: fp, action });
      }
    }
    if (files.length === 0) return;

    const container = document.createElement('div');
    container.className = 'file-links';
    for (const f of files) {
      const filename = f.path.split('/').pop();
      const link = document.createElement('a');
      link.className = 'file-link';
      link.href = `/api/download?path=${encodeURIComponent(f.path)}`;
      link.download = filename;
      link.title = f.path;
      link.innerHTML = `<span class="file-link-icon">\u2913</span><span class="file-link-name">${this.escapeHtml(filename)}</span><span class="file-link-action">${f.action}</span>`;
      container.appendChild(link);
    }
    this.messagesEl.appendChild(container);
    this.scrollToBottom();
  }

  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  startOrAppendAssistantText(text) {
    this.isStreaming = true;
    this.currentAssistantText += text;

    if (!this.currentAssistantEl) {
      this.currentAssistantEl = document.createElement('div');
      this.currentAssistantEl.className = 'message assistant';
      const content = document.createElement('div');
      content.className = 'content';
      this.currentAssistantEl.appendChild(content);
      this.messagesEl.appendChild(this.currentAssistantEl);
    }

    const content = this.currentAssistantEl.querySelector('.content');
    content.innerHTML = renderMarkdown(this.currentAssistantText);
    addCopyButtons(content);
    linkifyFilePaths(content, this.sessionCwd);
  }

  finishStreaming() {
    if (this.currentAssistantEl) {
      const content = this.currentAssistantEl.querySelector('.content');
      if (content) {
        content.innerHTML = renderMarkdown(this.currentAssistantText);
        addCopyButtons(content);
        linkifyFilePaths(content, this.sessionCwd);
      }
      if (this.currentAssistantText) {
        this.pushHistory({ role: 'assistant', text: this.currentAssistantText });
      }
    }
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
  }

  async switchSession(newSessionId) {
    // Clear UI state synchronously first — before any await —
    // so server messages (session_rejoined, session_busy) that arrive
    // during async operations won't get overridden.
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
    this.activeTasks.clear();
    this.renderedMessageIds.clear();
    this.renderedFileLinks.clear();
    this.hideThinking();
    this.setWorking(false);
    this.sessionId = newSessionId;
    this.history = [];

    // Async operations: save old history, load new history.
    // During these awaits, WebSocket messages (session_rejoined, session_busy)
    // may fire and create a thinking element via showThinking().
    await this.saveHistory();

    if (newSessionId) {
      await this.loadHistory(newSessionId);
    }

    // Race fix: if session_busy arrived during loadHistory's fetch, the
    // thinking element was appended before the history messages, leaving it
    // buried above the chat. Re-append it to move it to the bottom.
    if (this.thinkingEl) {
      this.messagesEl.appendChild(this.thinkingEl);
      this.forceScrollToBottom();
    }
  }

  async clear() {
    await this.saveHistory();
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
    this.history = [];
  }

  // Server-side persistence
  pushHistory(entry) {
    this.history.push(entry);
    this.debouncedSave();
  }

  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveHistory(), 1000);
  }

  async saveHistory() {
    if (!this.sessionId || this.history.length === 0) return;
    try {
      await fetch(`/api/history/${this.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.history),
      });
    } catch { /* offline, will save next time */ }
  }

  async loadHistory(sessionId) {
    try {
      const res = await fetch(`/api/history/${sessionId}`);
      if (!res.ok) return;
      this.history = await res.json();
      if (!Array.isArray(this.history)) { this.history = []; return; }

      for (const entry of this.history) {
        switch (entry.role) {
          case 'user': {
            const el = document.createElement('div');
            el.className = 'message user';
            let html = '';
            if (entry.images?.length) {
              for (const f of entry.images) {
                html += `<img class="chat-image" src="/data/images/${f}">`;
              }
            }
            html += escapeHtml(entry.text || '');
            el.innerHTML = html;
            this.messagesEl.appendChild(el);
            break;
          }
          case 'assistant':
            this.addAssistantText(entry.text);
            break;
          case 'tool':
            // Skip — don't replay tool use labels
            break;
        }
      }
      this.forceScrollToBottom();
    } catch { /* offline */ }
  }

  async migrateSessionId(oldId, newId) {
    try {
      const res = await fetch(`/api/history/${oldId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          await fetch(`/api/history/${newId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
        }
      }
    } catch {}
  }

  /** Returns true if the user is near the bottom of the chat (within 150px). */
  isNearBottom() {
    const el = this.messagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  /** Scroll to bottom only if the user hasn't scrolled up to read history. */
  scrollToBottom() {
    if (!this.isNearBottom()) return;
    this.forceScrollToBottom();
  }

  /** Unconditionally scroll to bottom (used after session switch, history load, etc.). */
  forceScrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createSystemNote(text) {
  const el = document.createElement('div');
  el.className = 'message system';
  el.textContent = text;
  return el;
}
