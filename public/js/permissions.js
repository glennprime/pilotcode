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
