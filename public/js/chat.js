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
    this.toolCards = new Map(); // tool_use id -> DOM element
    this.suppressReplay = false; // true during buffer replay after reconnect
    this.awaitingFirstResponse = false; // true after user sends message, cleared on first assistant msg
    this.sessionCwd = ''; // working directory for resolving relative paths
    this._scrollKey = 'pilotcode_scroll_positions'; // persisted in sessionStorage

    // Callbacks for user message actions (wired by app.js)
    this.onResend = null; // (text) => void
    this.onEdit = null;   // (text) => void

    // Event delegation for resend/edit buttons
    this.messagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.msg-action-btn');
      if (!btn) return;
      const msgEl = btn.closest('.message.user');
      if (!msgEl) return;
      const text = msgEl.dataset.text || '';
      if (btn.classList.contains('msg-resend') && this.onResend) {
        this.onResend(text);
      } else if (btn.classList.contains('msg-edit') && this.onEdit) {
        this.onEdit(text);
      }
    });

    // Scroll-to-bottom button
    this.scrollBtn = document.getElementById('scroll-bottom-btn');
    if (this.scrollBtn) {
      this.scrollBtn.onclick = () => this.forceScrollToBottom();
      // Save scroll position on page unload so refresh preserves it
      window.addEventListener('beforeunload', () => {
        if (this.sessionId) {
          this._saveScrollPos(this.sessionId, this.messagesEl.scrollTop);
        }
      });
      let scrollTicking = false;
      this.messagesEl.addEventListener('scroll', () => {
        if (!scrollTicking) {
          requestAnimationFrame(() => {
            this._updateScrollBtn();
            scrollTicking = false;
          });
          scrollTicking = true;
        }
      }, { passive: true });
    }
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
  }

  setWorking(active) {
    document.getElementById('input-area').classList.toggle('busy', active);
  }

  /**
   * Build a user message DOM element with action buttons (resend / edit).
   * Used by both addUserMessage() and loadHistory() to avoid duplication.
   * @param {string} text - raw message text
   * @param {Array} images - live image objects ({objectUrl, filename}) OR history filename strings
   */
  _createUserMessageEl(text, images) {
    const el = document.createElement('div');
    el.className = 'message user';
    el.dataset.text = text;

    let html = '';
    if (images?.length) {
      for (const img of images) {
        // Live images have objectUrl; history images are plain filename strings
        const src = typeof img === 'string'
          ? `/data/images/${img}`
          : (img.objectUrl || (img.filename ? `/data/images/${img.filename}` : ''));
        if (src) html += `<img class="chat-image" src="${src}">`;
      }
    }
    html += `<span class="user-text">${escapeHtml(text)}</span>`;
    html += `<div class="msg-actions">`;
    html += `<button class="msg-action-btn msg-edit" title="Edit">&#9998;</button>`;
    html += `<button class="msg-action-btn msg-resend" title="Resend">&#8635;</button>`;
    html += `</div>`;
    el.innerHTML = html;
    return el;
  }

  addUserMessage(text, images) {
    // Dedup: skip if the last DOM message is an identical user message
    // (can happen from concurrent loadHistory + addUserMessage races)
    const lastMsg = this.messagesEl.querySelector('.message.user:last-of-type');
    if (lastMsg && lastMsg.dataset.text === text) {
      const lastChild = this.messagesEl.lastElementChild;
      // Only skip if it's literally the most recent element (not buried under assistant msgs)
      if (lastChild === lastMsg) return;
    }

    const el = this._createUserMessageEl(text, images);
    this.messagesEl.appendChild(el);
    this.forceScrollToBottom();

    const entry = { role: 'user', text };
    if (images?.length) {
      entry.images = images.map((i) => i.filename || null).filter(Boolean);
    }
    // Dedup history: don't push if last entry is identical
    const lastEntry = this.history[this.history.length - 1];
    if (lastEntry?.role === 'user' && lastEntry?.text === text) return;
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
    this.forceScrollToBottom();
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
    const tasks = [...this.activeTasks.entries()];
    tasks.forEach(([id, task], i) => {
      const isLast = i === tasks.length - 1;
      const item = document.createElement('div');
      item.className = `task-item ${task.status}`;
      // CLI-style tree with filled/empty squares
      const branch = isLast ? '\u2514' : '\u251C'; // └ or ├
      const icon = task.status === 'done'
        ? '<span class="task-icon done">\u25A0</span>'   // ■ filled
        : task.status === 'running'
          ? '<span class="task-icon running">\u25A0</span>' // ■ active (colored)
          : '<span class="task-icon pending">\u25A1</span>'; // □ empty
      item.innerHTML = `<span class="task-branch">${branch}</span>${icon}<span class="task-label">${escapeHtml(task.name)}</span>`;
      container.appendChild(item);
    });
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
    // During buffer replay after reconnect, suppress rendering since
    // history was already loaded. Only let through result/busy/control messages.
    if (this.suppressReplay && (msg.type === 'assistant' || msg.type === 'user')) {
      return;
    }

    switch (msg.type) {
      case 'system':
        // Handle compaction events from Claude CLI
        if (msg.subtype === 'status' && msg.status === 'compacting') {
          this.addSystemMessage('Compacting context...');
        } else if (msg.subtype === 'compact_boundary') {
          const preTokens = msg.compact_metadata?.pre_tokens;
          this._renderCompactDivider({ preTokens });
          this.pushHistory({ role: 'compact', preTokens });
        }
        // Don't show "Session started" — it fires on every resume too.
        break;

      case 'assistant': {
        this.awaitingFirstResponse = false;
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
        // These are tool results flowing back — update spinner + tool cards
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              if (this.activeTasks.has(block.tool_use_id)) {
                this.activeTasks.set(block.tool_use_id, { ...this.activeTasks.get(block.tool_use_id), status: 'done' });
                this.renderTaskList();
              }
              // Append output to the matching tool card
              this.appendToolResult(block.tool_use_id, block.content);
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
        // Guard: if we just sent a message and haven't received any assistant
        // response yet, this result is stale (from the previous turn). Skip it
        // so it doesn't hide the thinking indicator for the new turn.
        if (this.awaitingFirstResponse && !msg.is_error) {
          this.awaitingFirstResponse = false;
          break;
        }
        this.awaitingFirstResponse = false;
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
        const planCard = renderPlanCard(msg, (approved, notes) => {
          this.wsClient.send({ type: 'plan_response', approved, notes: notes || '' });
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

  renderTurnStats(msg) {
    if (!msg.usage && !msg.duration_ms) return;

    const el = document.createElement('div');
    el.className = 'turn-stats';

    const parts = [];

    if (msg.usage) {
      const inp = msg.usage.input_tokens || 0;
      const out = msg.usage.output_tokens || 0;
      parts.push(`${this.formatTokens(inp)} in / ${this.formatTokens(out)} out`);

      const cacheRead = msg.usage.cache_read_input_tokens || 0;
      if (cacheRead > 0) {
        parts.push(`${this.formatTokens(cacheRead)} cached`);
      }
    }

    if (msg.duration_ms) {
      parts.push(this.formatDuration(msg.duration_ms));
    }

    el.textContent = parts.join('  ·  ');
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
  }

  formatDuration(ms) {
    if (ms >= 60_000) {
      const mins = Math.floor(ms / 60_000);
      const secs = Math.round((ms % 60_000) / 1000);
      return `${mins}m ${secs}s`;
    }
    return (ms / 1000).toFixed(1) + 's';
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
        // Render collapsible tool card (skip interactive tools shown as cards)
        if (!['AskUserQuestion', 'ExitPlanMode'].includes(block.name)) {
          const card = this.renderToolCard(block);
          this.messagesEl.appendChild(card);
        }
      }
    }

    this.scrollToBottom();
  }

  /** Shorten an absolute path to relative using the session's cwd. */
  relativePath(absPath) {
    if (!absPath || !this.sessionCwd) return absPath || '...';
    let cwd = this.sessionCwd;
    if (!cwd.endsWith('/')) cwd += '/';
    if (absPath.startsWith(cwd)) return absPath.slice(cwd.length);
    return absPath;
  }

  /**
   * Get tool card display info. Returns { label, detail } where:
   * - label: the header line (always shown)
   * - detail: optional secondary line (shown below label in smaller text)
   * This matches the CLI's two-line layout.
   */
  getToolDisplay(toolUse) {
    const name = toolUse.name;
    const input = toolUse.input || {};
    switch (name) {
      case 'Bash':
        return {
          label: input.description || 'Running command...',
          detail: `$ ${input.command || '...'}`,
        };
      case 'Read':
        return { label: `Read ${this.relativePath(input.file_path)}` };
      case 'Write':
        return { label: `Write ${this.relativePath(input.file_path)}` };
      case 'Edit':
        return { label: `Edit ${this.relativePath(input.file_path)}` };
      case 'NotebookEdit':
        return { label: `Edit ${this.relativePath(input.notebook_path)}` };
      case 'Grep':
        return {
          label: `Grep "${input.pattern || '...'}"`,
          detail: input.path ? `in ${this.relativePath(input.path)}` : undefined,
        };
      case 'Glob':
        return {
          label: `Glob "${input.pattern || '...'}"`,
          detail: input.path ? `in ${this.relativePath(input.path)}` : undefined,
        };
      case 'WebFetch':
        return { label: `Fetch ${input.url || '...'}` };
      case 'WebSearch':
        return { label: `Search "${input.query || '...'}"` };
      case 'Skill':
        return { label: `/${input.skill || 'skill'}`, detail: input.args || undefined };
      case 'Agent':
        return {
          label: `Agent (${input.subagent_type || 'general'})`,
          detail: input.description || input.prompt?.slice(0, 100) || undefined,
        };
      case 'Task':
        return {
          label: `Task (${input.subagent_type || 'general'})`,
          detail: input.description || undefined,
        };
      default:
        return { label: name };
    }
  }

  renderToolCard(toolUse) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.dataset.toolId = toolUse.id;
    card.dataset.startTime = Date.now();

    const display = this.getToolDisplay(toolUse);

    const header = document.createElement('div');
    header.className = 'tool-card-header';

    const icon = document.createElement('span');
    icon.className = 'tool-card-icon';
    icon.textContent = '\u25B6';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'tool-card-labels';

    const label = document.createElement('span');
    label.className = 'tool-card-label';
    label.textContent = display.label;
    label.title = display.label;
    labelWrap.appendChild(label);

    if (display.detail) {
      const detail = document.createElement('span');
      detail.className = 'tool-card-detail-line';
      detail.textContent = display.detail;
      detail.title = display.detail;
      labelWrap.appendChild(detail);
    }

    const status = document.createElement('span');
    status.className = 'tool-card-status';
    status.innerHTML = '<span class="tool-mini-spinner"></span>';

    header.appendChild(icon);
    header.appendChild(labelWrap);
    header.appendChild(status);

    header.addEventListener('click', () => {
      card.classList.toggle('expanded');
    });

    const detailPane = document.createElement('div');
    detailPane.className = 'tool-card-detail';

    const output = document.createElement('pre');
    output.className = 'tool-card-output';
    detailPane.appendChild(output);

    card.appendChild(header);
    card.appendChild(detailPane);

    this.toolCards.set(toolUse.id, card);
    return card;
  }

  appendToolResult(toolUseId, content) {
    const card = this.toolCards.get(toolUseId);
    if (!card) return;

    // Mark as done with timing
    card.classList.add('done');
    const status = card.querySelector('.tool-card-status');
    if (status) {
      const startTime = parseInt(card.dataset.startTime || '0');
      const elapsed = startTime ? Date.now() - startTime : 0;
      const timing = elapsed > 0 ? this.formatDuration(elapsed) : '';
      status.textContent = timing ? `${timing} ✓` : '✓';
    }

    // Extract text content from the result
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          text += block.text;
        } else if (block.type === 'tool_result' && block.content) {
          if (typeof block.content === 'string') {
            text += block.content;
          } else if (Array.isArray(block.content)) {
            for (const inner of block.content) {
              if (inner.type === 'text') text += inner.text;
            }
          }
        }
      }
    }

    if (!text) return;

    const output = card.querySelector('.tool-card-output');
    if (!output) return;

    const lines = text.split('\n');
    const MAX_LINES = 100;

    if (lines.length > MAX_LINES) {
      output.textContent = lines.slice(0, MAX_LINES).join('\n');

      const existing = card.querySelector('.tool-show-all');
      if (existing) existing.remove();

      const showAll = document.createElement('button');
      showAll.className = 'tool-show-all';
      showAll.textContent = `Show all ${lines.length} lines`;
      showAll.addEventListener('click', (e) => {
        e.stopPropagation();
        output.textContent = text;
        showAll.remove();
      });
      card.querySelector('.tool-card-detail').appendChild(showAll);
    } else {
      output.textContent = text;
    }
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
    // Save scroll position of the session we're leaving
    if (this.sessionId) {
      this._saveScrollPos(this.sessionId, this.messagesEl.scrollTop);
    }

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
    this.toolCards.clear();
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
    } else if (newSessionId) {
      // Restore previous scroll position for this session
      const savedPos = this._getScrollPos(newSessionId);
      if (savedPos != null) {
        requestAnimationFrame(() => {
          this.messagesEl.scrollTop = savedPos;
          this._updateScrollBtn();
        });
      }
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

      // Clear existing message elements to prevent duplication.
      // loadHistory can be called multiple times for the same session
      // (e.g., on boot + session_not_running reconnect), so it must be idempotent.
      this.messagesEl.querySelectorAll('.message, .file-links, .tool-card, .turn-stats, .load-earlier-btn, .compact-divider').forEach(el => el.remove());

      // Only render the last RENDER_CAP entries for fast session switching.
      // Full history stays in this.history for saving back to disk.
      const RENDER_CAP = 50;
      this._renderOffset = Math.max(0, this.history.length - RENDER_CAP);

      if (this._renderOffset > 0) {
        this._insertLoadEarlierButton();
      }

      for (let i = this._renderOffset; i < this.history.length; i++) {
        this._renderHistoryEntry(this.history[i]);
      }
      // Use smart scroll — if the user scrolled up to read history,
      // don't snap them to the bottom on reconnect-triggered reloads.
      // On initial load (messages div was empty), isNearBottom() is true
      // so this still scrolls to show the latest messages.
      this.scrollToBottom();
    } catch { /* offline */ }
  }

  _renderHistoryEntry(entry) {
    switch (entry.role) {
      case 'user': {
        const el = this._createUserMessageEl(entry.text || '', entry.images);
        this.messagesEl.appendChild(el);
        break;
      }
      case 'assistant':
        this.addAssistantText(entry.text);
        break;
      case 'compact':
        this._renderCompactDivider(entry);
        break;
      case 'tool':
        // Skip — don't replay tool use labels
        break;
    }
  }

  _insertLoadEarlierButton() {
    const btn = document.createElement('button');
    btn.className = 'load-earlier-btn';
    btn.textContent = `Load earlier messages (${this._renderOffset} hidden)`;
    btn.onclick = () => this._loadEarlierMessages();
    this.messagesEl.prepend(btn);
  }

  _loadEarlierMessages() {
    const BATCH = 50;
    const newOffset = Math.max(0, this._renderOffset - BATCH);
    const entries = this.history.slice(newOffset, this._renderOffset);
    this._renderOffset = newOffset;

    // Remove old button
    const oldBtn = this.messagesEl.querySelector('.load-earlier-btn');

    // Remember scroll position so we don't jump
    const scrollBefore = this.messagesEl.scrollHeight;

    // Render entries before existing messages (after the button if it stays)
    const firstMsg = this.messagesEl.querySelector('.message, .compact-divider');
    for (const entry of entries) {
      const frag = document.createDocumentFragment();
      this._renderHistoryEntryInto(entry, frag);
      if (firstMsg) {
        this.messagesEl.insertBefore(frag, firstMsg);
      } else {
        this.messagesEl.appendChild(frag);
      }
    }

    // Update or remove the button
    if (this._renderOffset > 0) {
      if (oldBtn) oldBtn.textContent = `Load earlier messages (${this._renderOffset} hidden)`;
    } else {
      if (oldBtn) oldBtn.remove();
    }

    // Restore scroll position so content doesn't jump
    const scrollAfter = this.messagesEl.scrollHeight;
    this.messagesEl.scrollTop += (scrollAfter - scrollBefore);
  }

  _renderHistoryEntryInto(entry, container) {
    switch (entry.role) {
      case 'user': {
        const el = this._createUserMessageEl(entry.text || '', entry.images);
        container.appendChild(el);
        break;
      }
      case 'assistant': {
        const el = document.createElement('div');
        el.className = 'message assistant';
        const content = document.createElement('div');
        content.className = 'content';
        content.innerHTML = renderMarkdown(entry.text);
        addCopyButtons(content);
        linkifyFilePaths(content, this.sessionCwd);
        el.appendChild(content);
        container.appendChild(el);
        break;
      }
      case 'compact':
        this._renderCompactDividerInto(entry, container);
        break;
    }
  }

  _renderCompactDivider(entry) {
    const el = document.createElement('div');
    el.className = 'compact-divider';
    const tokens = entry.preTokens ? ` (${Math.round(entry.preTokens / 1000)}k tokens before)` : '';
    el.innerHTML = `<span class="compact-divider-line"></span><span class="compact-divider-text">Context compacted${tokens}</span><span class="compact-divider-line"></span>`;
    this.messagesEl.appendChild(el);
  }

  _renderCompactDividerInto(entry, container) {
    const el = document.createElement('div');
    el.className = 'compact-divider';
    const tokens = entry.preTokens ? ` (${Math.round(entry.preTokens / 1000)}k tokens before)` : '';
    el.innerHTML = `<span class="compact-divider-line"></span><span class="compact-divider-text">Context compacted${tokens}</span><span class="compact-divider-line"></span>`;
    container.appendChild(el);
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
    if (this.isNearBottom()) {
      this.forceScrollToBottom();
    } else {
      this._updateScrollBtn();
    }
  }

  /** Unconditionally scroll to bottom (used after session switch, history load, etc.). */
  forceScrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      // scroll event will fire and hide the button
    });
  }

  /** Show/hide the scroll-to-bottom button based on scroll position. */
  _updateScrollBtn() {
    if (this.scrollBtn) {
      this.scrollBtn.classList.toggle('visible', !this.isNearBottom());
    }
  }

  _saveScrollPos(sessionId, pos) {
    try {
      const all = JSON.parse(sessionStorage.getItem(this._scrollKey) || '{}');
      all[sessionId] = pos;
      sessionStorage.setItem(this._scrollKey, JSON.stringify(all));
    } catch { /* full storage */ }
  }

  _getScrollPos(sessionId) {
    try {
      const all = JSON.parse(sessionStorage.getItem(this._scrollKey) || '{}');
      return all[sessionId] ?? null;
    } catch { return null; }
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
