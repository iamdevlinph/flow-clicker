let draggedFlowId = null;

export function renderFlowLibrary(options) {
  const { list, groups, flows, selectedFlowId, search, escapeHtml, clickCount, totalDelay, moveByKey, onSelect, onSettings, onMenu, onRenameGroup, onDeleteGroup, onMoveBefore, onMoveToGroup, announce } = options;
  list.innerHTML = '';
  for (const group of [{ id: null, name: 'Ungrouped' }, ...groups]) {
    const section = document.createElement('div');
    section.className = 'library-group'; section.dataset.groupId = group.id || '';
    section.innerHTML = `<div class="library-group-head"><strong>${escapeHtml(group.name)}</strong><span><button class="group-rename" title="Rename group">✎</button>${group.id ? '<button class="group-delete" title="Delete group">×</button>' : ''}</span></div><div class="group-flow-list"></div>`;
    section.querySelector('.group-rename').addEventListener('click', () => onRenameGroup(group.id));
    section.querySelector('.group-delete')?.addEventListener('click', () => onDeleteGroup(group.id));
    list.appendChild(section);
    const groupList = section.querySelector('.group-flow-list');
    for (const flow of flows.filter((candidate) => (candidate.groupId ?? null) === group.id)) {
      if (search && !flow.name.toLowerCase().includes(search)) continue;
      const row = document.createElement('div');
      row.className = `flow-row${flow.id === selectedFlowId ? ' selected' : ''}`; row.draggable = true; row.tabIndex = 0; row.role = 'group'; row.ariaLabel = flow.name; row.dataset.flowId = flow.id;
      row.innerHTML = `<div class="flow-main"><div class="flow-row-name">${escapeHtml(flow.name)}</div><div class="flow-row-meta">${flow.actions.length} actions · ${clickCount(flow)} clicks · ${(totalDelay(flow) / 1000).toFixed(1)}s delays</div></div><div class="flow-row-actions"><button class="flow-settings" title="Playback settings" aria-label="Playback settings for ${escapeHtml(flow.name)}">⚙</button></div>`;
      row.addEventListener('click', (event) => { if (!event.target.closest('button')) onSelect(flow); });
      row.addEventListener('keydown', (event) => {
        if (['Enter', ' '].includes(event.key) && event.target === row) { event.preventDefault(); onSelect(flow); return; }
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); if (!moveByKey(flow, event.key === 'ArrowUp' ? -1 : 1)) return;
        document.querySelector(`[data-flow-id="${CSS.escape(flow.id)}"]`)?.focus(); announce(flow, event.key === 'ArrowUp' ? 'up' : 'down');
      });
      row.querySelector('.flow-settings').addEventListener('click', () => onSettings(flow));
      row.addEventListener('contextmenu', (event) => { event.preventDefault(); onMenu(event.clientX, event.clientY, flow); });
      row.addEventListener('dragstart', (event) => { draggedFlowId = flow.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', flow.id); });
      row.addEventListener('dragend', clearDragTargets);
      row.addEventListener('dragover', (event) => { event.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); onMoveBefore(event.dataTransfer.getData('text/plain') || draggedFlowId, flow.id); clearDragTargets(); });
      groupList.appendChild(row);
    }
    section.addEventListener('dragover', (event) => { event.preventDefault(); section.classList.add('drop-target'); });
    section.addEventListener('dragleave', (event) => { if (!section.contains(event.relatedTarget)) section.classList.remove('drop-target'); });
    section.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); onMoveToGroup(event.dataTransfer.getData('text/plain') || draggedFlowId, group.id); clearDragTargets(); });
  }
}

function clearDragTargets() {
  draggedFlowId = null;
  document.querySelectorAll('.drop-target').forEach((element) => element.classList.remove('drop-target'));
}
