const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

export const editorRowsHtml = (actions = []) => actions.map((action, index) => {
  const click = action.type === 'click';
  return `<tr data-id="${escapeHtml(action.id)}"><td>${index + 1}</td><td><span class="action-type ${escapeHtml(action.type)}">${escapeHtml(action.type)}</span></td><td><input class="compact-input action-name" value="${escapeHtml(action.name)}"></td><td>${click ? `<input class="compact-input coord-x" type="number" value="${Number(action.screenX) || 0}">` : '—'}</td><td>${click ? `<input class="compact-input coord-y" type="number" value="${Number(action.screenY) || 0}">` : '—'}</td><td>${action.type === 'group' ? 'Group' : `<span class="delay-input"><input class="compact-input action-delay" type="number" value="${Number(action.delayMs) || 0}"><span>ms</span></span>`}</td><td class="target-cell">${click ? escapeHtml(action.windowTitle || 'screen coordinates') : '—'}</td></tr>`;
}).join('');
