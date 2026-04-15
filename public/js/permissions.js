import { renderMarkdown, addCopyButtons } from './markdown.js';

export function renderPermissionCard(msg, onRespond) {
  const card = document.createElement('div');
  card.className = 'permission-card';
  card.id = `perm-${msg.request_id}`;

  const toolName = msg.request?.tool_name || 'Unknown Tool';
  const input = msg.request?.input;

  let inputDisplay = '';
  if (input) {
    if (typeof input === 'string') {
      inputDisplay = input;
    } else {
      try {
        inputDisplay = JSON.stringify(input, null, 2);
      } catch {
        inputDisplay = String(input);
      }
    }
  }

  card.innerHTML = `
    <div class="tool-label">Permission: ${escapeHtml(toolName)}</div>
    ${inputDisplay ? `<div class="tool-input">${escapeHtml(inputDisplay)}</div>` : ''}
    <div class="permission-actions">
      <button class="btn-allow">Allow</button>
      <button class="btn-deny">Deny</button>
    </div>
  `;

  card.querySelector('.btn-allow').onclick = () => {
    onRespond(msg.request_id, true);
    disableCard(card, 'Allowed');
  };

  card.querySelector('.btn-deny').onclick = () => {
    onRespond(msg.request_id, false);
    disableCard(card, 'Denied');
  };

  return card;
}

export function renderPlanCard(msg, onRespond) {
  const card = document.createElement('div');
  card.className = 'plan-card';

  const planText = msg.plan || '(No plan content)';

  card.innerHTML = `
    <div class="plan-header">Plan Review</div>
    <div class="plan-content"></div>
    <div class="plan-notes">
      <textarea class="plan-notes-input" placeholder="Notes for Claude (optional)..." rows="2"></textarea>
    </div>
    <div class="plan-actions">
      <button class="btn-approve">Approve</button>
      <button class="btn-reject">Reject</button>
    </div>
  `;

  const contentEl = card.querySelector('.plan-content');
  contentEl.innerHTML = renderMarkdown(planText);
  addCopyButtons(contentEl);

  const notesInput = card.querySelector('.plan-notes-input');

  card.querySelector('.btn-approve').onclick = () => {
    const notes = notesInput.value.trim();
    onRespond(true, notes);
    const notesEl = card.querySelector('.plan-notes');
    notesEl.remove();
    const actions = card.querySelector('.plan-actions');
    actions.innerHTML = '<span style="color: var(--green); font-size: 12px; font-weight: 600;">Approved</span>';
  };

  card.querySelector('.btn-reject').onclick = () => {
    const notes = notesInput.value.trim();
    onRespond(false, notes);
    const notesEl = card.querySelector('.plan-notes');
    notesEl.remove();
    const actions = card.querySelector('.plan-actions');
    actions.innerHTML = '<span style="color: var(--red); font-size: 12px; font-weight: 600;">Rejected</span>';
  };

  return card;
}

export function renderQuestionCard(msg, onRespond) {
  const card = document.createElement('div');
  card.className = 'question-card';

  const questions = msg.questions || [];
  const selections = {}; // { questionText: selectedAnswer }

  // Dismiss button
  let html = '<button class="question-dismiss" title="Dismiss">&times;</button>';
  for (const q of questions) {
    const header = q.header ? `<div class="question-header">${escapeHtml(q.header)}</div>` : '';
    html += `<div class="question-group">
      ${header}
      <div class="question-text">${escapeHtml(q.question)}</div>
      <div class="question-options" data-question="${escapeHtml(q.question)}" data-multi="${q.multiSelect ? 'true' : 'false'}">`;
    for (const opt of (q.options || [])) {
      html += `<button class="question-option" data-label="${escapeHtml(opt.label)}">
        <div class="option-label">${escapeHtml(opt.label)}</div>
        ${opt.description ? `<div class="option-desc">${escapeHtml(opt.description)}</div>` : ''}
      </button>`;
    }
    html += `</div>
      <div class="question-freetext">
        <input type="text" class="question-freetext-input" placeholder="Or type your own answer..." data-question="${escapeHtml(q.question)}">
      </div>
    </div>`;
  }

  html += `<div class="question-actions">
    <button class="btn-submit-answers" disabled>Submit</button>
  </div>`;

  card.innerHTML = html;

  // Wire up dismiss
  card.querySelector('.question-dismiss').onclick = () => card.remove();

  // Wire up option selection
  const submitBtn = card.querySelector('.btn-submit-answers');
  const updateSubmitState = () => {
    const hasSelection = Object.values(selections).some(v => v);
    submitBtn.disabled = !hasSelection;
  };

  for (const group of card.querySelectorAll('.question-options')) {
    const qText = group.dataset.question;
    const isMulti = group.dataset.multi === 'true';
    // Find the corresponding freetext input
    const freetextInput = card.querySelector(`.question-freetext-input[data-question="${qText}"]`);

    for (const btn of group.querySelectorAll('.question-option')) {
      btn.onclick = () => {
        if (isMulti) {
          btn.classList.toggle('selected');
          const selected = [...group.querySelectorAll('.question-option.selected')].map(b => b.dataset.label);
          selections[qText] = selected.join(', ');
        } else {
          group.querySelectorAll('.question-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          selections[qText] = btn.dataset.label;
        }
        // Clear freetext when option selected
        if (freetextInput) freetextInput.value = '';
        updateSubmitState();
      };
    }

    // Wire up freetext input
    if (freetextInput) {
      freetextInput.oninput = () => {
        const val = freetextInput.value.trim();
        if (val) {
          // Deselect options when typing custom answer
          group.querySelectorAll('.question-option').forEach(b => b.classList.remove('selected'));
          selections[qText] = val;
        } else {
          delete selections[qText];
        }
        updateSubmitState();
      };
    }
  }

  submitBtn.onclick = () => {
    onRespond(selections);
    const actions = card.querySelector('.question-actions');
    actions.innerHTML = '<span style="color: var(--green); font-size: 12px; font-weight: 600;">Answered</span>';
    card.querySelectorAll('.question-option').forEach(b => {
      b.disabled = true;
      b.style.pointerEvents = 'none';
    });
    card.querySelectorAll('.question-freetext-input').forEach(i => { i.disabled = true; });
    const dismissBtn = card.querySelector('.question-dismiss');
    if (dismissBtn) dismissBtn.remove();
  };

  return card;
}

export function cancelPermissionCard(requestId) {
  const card = document.getElementById(`perm-${requestId}`);
  if (card) {
    disableCard(card, 'Cancelled');
  }
}

function disableCard(card, label) {
  const actions = card.querySelector('.permission-actions');
  if (actions) {
    actions.innerHTML = `<span style="color: var(--text-muted); font-size: 12px;">${label}</span>`;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
