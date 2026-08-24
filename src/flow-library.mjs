let draggedFlowId = null;

export function flowRowMarkup({ flow, escapeHtml, selected = false, combineSelected = false, running = false, playbackBlocked = false }) {
  return `<input class="flow-combine" type="checkbox" aria-label="Select ${escapeHtml(flow.name)} for combining"${combineSelected ? ' checked' : ''}><button class="flow-play" type="button" title="${running ? 'Playing' : 'Play flow'}" aria-label="${running ? 'Playing' : `Play ${escapeHtml(flow.name)}`}"${running || playbackBlocked ? ' disabled' : ''}>${running ? '●' : '▶'}</button><div class="flow-main"><div class="flow-row-name">${escapeHtml(flow.name)}</div></div><div class="flow-row-actions"><button class="flow-settings" title="Playback settings" aria-label="Playback settings">⚙</button></div>`;
}

export function groupHeaderMarkup({ group, escapeHtml, flowListId, search = '' }) {
  const expanded = !group.collapsed || !!search;
  return `<button class="group-disclosure" type="button" aria-expanded="${expanded}" aria-controls="${escapeHtml(flowListId)}"><span class="group-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span><strong>${escapeHtml(group.name)}</strong></button><span><button class="group-rename" type="button" title="Rename group" aria-label="Rename ${escapeHtml(group.name)}">✎</button><button class="group-delete" type="button" title="Delete group" aria-label="Delete ${escapeHtml(group.name)}">×</button></span>`;
}

export function renderFlowLibrary(options) {
  const {
    list, groups, flows, selectedFlowId, combineQueue = [], runningFlowId = null,
    search, escapeHtml, moveByKey, onSelect, onSettings, onPlay, onToggleCombine, onToggleGroup,
    onMenu, onEdit, onRenameGroup, onDeleteGroup, onMoveBefore, onMoveToGroup, onCreateFlow, announce,
  } = options;
  list.innerHTML = '';
  if (!flows.length) {
    list.innerHTML = '<div class="library-empty"><div class="empty-icon">＋</div><h3>No flows yet</h3><p>Create a flow to start recording and replaying physical clicks.</p><button class="primary" type="button">Create flow</button></div>';
    list.querySelector('button').addEventListener('click', onCreateFlow);
    return;
  }
  const renderRows = (container, groupId) => {
    flows.filter((candidate) => (candidate.groupId ?? null) === groupId).forEach((flow) => {
      if (search && !flow.name.toLowerCase().includes(search)) return;
      const row = document.createElement('div');
      const running = flow.id === runningFlowId;
      row.className = `flow-row${flow.id === selectedFlowId ? ' selected' : ''}${running ? ' playing' : ''}`;
      row.draggable = true; row.tabIndex = 0; row.role = 'listitem'; row.ariaLabel = flow.name; row.dataset.flowId = flow.id;
      row.innerHTML = flowRowMarkup({ flow, escapeHtml, combineSelected: combineQueue.includes(flow.id), running, playbackBlocked: !!(runningFlowId && !running) });
      row.addEventListener('click', (event) => { if (!event.target.closest('button, input')) onSelect(flow); });
      row.addEventListener('dblclick', (event) => { if (!event.target.closest('button, input')) onEdit(flow); });
      row.addEventListener('keydown', (event) => {
        if (['Enter', ' '].includes(event.key) && event.target === row) { event.preventDefault(); onSelect(flow); return; }
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); if (!moveByKey(flow, event.key === 'ArrowUp' ? -1 : 1)) return;
        document.querySelector(`[data-flow-id="${CSS.escape(flow.id)}"]`)?.focus(); announce(flow, event.key === 'ArrowUp' ? 'up' : 'down');
      });
      row.querySelector('.flow-combine').addEventListener('click', (event) => event.stopPropagation());
      row.querySelector('.flow-combine').addEventListener('change', (event) => onToggleCombine(flow, event.target.checked));
      row.querySelector('.flow-play').addEventListener('click', (event) => { event.stopPropagation(); if (!running) onPlay(flow); });
      row.querySelector('.flow-settings').addEventListener('click', (event) => { event.stopPropagation(); onSettings(flow); });
      row.addEventListener('contextmenu', (event) => { event.preventDefault(); onMenu(event.clientX, event.clientY, flow); });
      row.addEventListener('dragstart', (event) => { draggedFlowId = flow.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', flow.id); });
      row.addEventListener('dragend', clearDragTargets);
      row.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); onMoveBefore(event.dataTransfer.getData('text/plain') || draggedFlowId, flow.id); clearDragTargets(); });
      container.appendChild(row);
    });
  };

  const ungrouped = document.createElement('div');
  ungrouped.className = 'group-flow-list ungrouped-drop-area';
  ungrouped.dataset.groupId = '';
  renderRows(ungrouped, null);
  ungrouped.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); ungrouped.classList.add('drop-target'); });
  ungrouped.addEventListener('dragleave', (event) => { if (!ungrouped.contains(event.relatedTarget)) ungrouped.classList.remove('drop-target'); });
  ungrouped.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); onMoveToGroup(event.dataTransfer.getData('text/plain') || draggedFlowId, null); clearDragTargets(); });
  list.appendChild(ungrouped);

  groups.forEach((group) => {
    const section = document.createElement('div');
    section.className = 'library-group'; section.dataset.groupId = group.id;
    const flowListId = `group-flows-${group.id}`;
    const expanded = !group.collapsed || !!search;
    section.innerHTML = `<div class="library-group-head">${groupHeaderMarkup({ group, escapeHtml, flowListId, search })}</div><div class="group-flow-list${expanded ? '' : ' hidden'}" id="${escapeHtml(flowListId)}"></div>`;
    const head = section.querySelector('.library-group-head');
    head.querySelector('.group-disclosure').addEventListener('click', () => onToggleGroup(group.id));
    section.querySelector('.group-rename').addEventListener('click', () => onRenameGroup(group.id));
    section.querySelector('.group-delete').addEventListener('click', () => onDeleteGroup(group.id));
    head.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); head.classList.add('drop-target'); });
    head.addEventListener('dragleave', () => head.classList.remove('drop-target'));
    head.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); onMoveToGroup(event.dataTransfer.getData('text/plain') || draggedFlowId, group.id); clearDragTargets(); });
    renderRows(section.querySelector('.group-flow-list'), group.id);
    list.appendChild(section);
  });
}

function clearDragTargets() {
  draggedFlowId = null;
  document.querySelectorAll('.drop-target').forEach((element) => element.classList.remove('drop-target'));
}
