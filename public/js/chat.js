import { renderMarkdown, addCopyButtons } from './markdown.js';
import { renderPermissionCard, cancelPermissionCard } from './permissions.js';

export class Chat {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.messagesEl = document.getElementById('messages');
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
  }

  addUserMessage(text, images) {
    const el = document.createElement('div');
    el.className = 'message user';

    let html = '';
    if (images?.length) {
      for (const img of images) {
        html += `<img class="chat-image" src="${img.objectUrl}">`;
      }
    }
    html += escapeHtml(text);
    el.innerHTML = html;

    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.scrollToBottom();
  }

  handleSDKMessage(msg, onPermissionResponse) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.addSystemMessage(`Session started (${msg.session_id?.slice(0, 8)}...)`);
        }
        break;

      case 'assistant':
        this.renderAssistantMessage(msg.message);
        break;

      case 'result':
        this.finishStreaming();
        if (msg.is_error) {
          this.addSystemMessage(`Error: ${msg.result || 'Unknown error'}`);
        } else {
          const cost = msg.total_cost_usd ? `$${msg.total_cost_usd.toFixed(4)}` : '';
          const tokens = msg.usage
            ? `${msg.usage.input_tokens + msg.usage.output_tokens} tokens`
            : '';
          if (cost || tokens) {
            this.addSystemMessage([cost, tokens].filter(Boolean).join(' | '));
          }
        }
        break;

      case 'control_request':
        this.finishStreaming();
        const card = renderPermissionCard(msg, (requestId, allow) => {
          onPermissionResponse(requestId, allow);
        });
        this.messagesEl.appendChild(card);
        this.scrollToBottom();
        break;

      case 'control_cancel_request':
        cancelPermissionCard(msg.request_id);
        break;

      case 'process_exit':
        this.finishStreaming();
        this.addSystemMessage(`Process exited (code ${msg.code})`);
        break;

      case 'error':
        this.addSystemMessage(`Error: ${msg.error}`);
        break;

      case 'session_resumed':
        this.addSystemMessage('Session resumed');
        break;
    }
  }

  renderAssistantMessage(message) {
    if (!message?.content) return;
    const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: String(message.content) }];

    // Start a new assistant message group
    this.finishStreaming();

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        this.startOrAppendAssistantText(block.text);
      } else if (block.type === 'tool_use') {
        this.finishStreaming();
        const el = document.createElement('div');
        el.className = 'tool-use';
        el.innerHTML = `<span class="tool-name">${escapeHtml(block.name)}</span>`;
        this.messagesEl.appendChild(el);
      } else if (block.type === 'tool_result') {
        // Tool results are shown indirectly via the assistant's next text
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
    }
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
  }

  clear() {
    this.messagesEl.innerHTML = '';
    this.currentAssistantEl = null;
    this.currentAssistantText = '';
    this.isStreaming = false;
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
