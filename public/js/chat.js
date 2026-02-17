import { renderMarkdown, addCopyButtons } from './markdown.js';
import { renderPermissionCard, cancelPermissionCard } from './permissions.js';

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
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
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
    this.scrollToBottom();

    const entry = { role: 'user', text };
    if (images?.length) {
      entry.images = images.map((i) => i.filename || null).filter(Boolean);
    }
    this.pushHistory(entry);
  }

  addAssistantText(text) {
    const el = document.createElement('div');
    el.className = 'message assistant';
    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = renderMarkdown(text);
    addCopyButtons(content);
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
  }

  handleSDKMessage(msg, onPermissionResponse) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.addSystemMessage('Session started');
        }
        break;

      case 'assistant': {
        // Check if this message has text or just tool_use
        const content = msg.message?.content;
        const blocks = Array.isArray(content) ? content : [];
        const hasText = blocks.some(b => b.type === 'text' && b.text);
        const toolUses = blocks.filter(b => b.type === 'tool_use');

        if (hasText) {
          this.hideThinking();
          this.renderAssistantMessage(msg.message);
        }
        if (toolUses.length > 0) {
          // Show what tool is being used
          const toolName = this.friendlyToolName(toolUses[toolUses.length - 1].name);
          this.updateThinking(toolName);
        }
        break;
      }

      case 'user': {
        // These are tool results flowing back — update spinner
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          const hasToolResult = content.some(b => b.type === 'tool_result');
          if (hasToolResult) {
            this.updateThinking('Processing...');
          }
        }
        break;
      }

      case 'result':
        this.hideThinking();
        this.finishStreaming();
        if (msg.is_error && msg.result) {
          this.addSystemMessage(`Error: ${msg.result}`);
        }
        break;

      case 'control_request':
        this.hideThinking();
        this.finishStreaming();
        const card = renderPermissionCard(msg, (requestId, allow) => {
          onPermissionResponse(requestId, allow);
          this.showThinking('Waiting for Claude...');
        });
        this.messagesEl.appendChild(card);
        this.scrollToBottom();
        break;

      case 'control_cancel_request':
        cancelPermissionCard(msg.request_id);
        break;

      case 'process_exit':
        this.hideThinking();
        this.finishStreaming();
        if (msg.code !== 0 && msg.code !== null) {
          this.addSystemMessage('Session ended');
        }
        break;

      case 'error':
        this.hideThinking();
        if (msg.error && !msg.error.includes('No active session')) {
          this.addSystemMessage(`Error: ${msg.error}`);
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
  }

  finishStreaming() {
    if (this.currentAssistantEl) {
      const content = this.currentAssistantEl.querySelector('.content');
      if (content) {
        content.innerHTML = renderMarkdown(this.currentAssistantText);
        addCopyButtons(content);
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
    await this.saveHistory();
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
    this.sessionId = newSessionId;
    this.history = [];

    if (newSessionId) {
      await this.loadHistory(newSessionId);
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
      this.scrollToBottom();
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

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
