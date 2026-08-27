export function beginNameFocus(selected, actionId, input) {
  if (selected.size === 1 && selected.has(actionId)) { input.select(); return false; }
  return true;
}

export function restoreNameFocus(root, actionId) {
  const input = root.querySelector(`tr[data-id="${CSS.escape(actionId)}"] .action-name`);
  if (input) { input.focus(); input.select(); }
}
