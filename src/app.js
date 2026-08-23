import { actionClickCount, migrateState as migratePersistedState, nextDeadline } from './state-model.mjs';

(() => {
  const T = window.__TAURI__ || null;
  const invoke = T?.core?.invoke;
  const listen = T?.event?.listen;
  const $ = (id) => document.getElementById(id);

  const playbackDefaults = {
    playbackSpeed: 1, repeatMode: 'cycles', repeatValue: 1, repeatUnit: 'seconds',
    settleMs: 12, holdMs: 30, restoreCursor: false, focusTargetWindow: true, untilTime: null,
  };
  const defaults = {
    version: 3,
    selectedFlowId: null,
    flows: [],
    groups: [],
    settings: {
      recordHotkey: 'Alt+Shift+R',
      playbackHotkey: 'Alt+Shift+P',
    },
  };

  let state = structuredClone(defaults);
  let combineQueue = [];
  let selectedActionId = null;
  let selectedActionIds = new Set();
  let recording = false;
  let playing = false;
  let mapVisible = false;
  let saveTimer = null;
  let importSelection = new Set();

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nowIso = () => new Date().toISOString();
  const currentFlow = () => state.flows.find((f) => f.id === state.selectedFlowId) || null;
  const actionDelay = (a) => a.type === 'group' ? (a.actions || []).reduce((n, child) => n + actionDelay(child), 0) * Math.max(1, Number(a.repeatCount) || 1) : Math.max(0, Number(a.delayMs) || 0);
  const clickCount = (flow) => (flow?.actions || []).reduce((n, a) => n + actionClickCount(a), 0);
  const totalDelay = (flow) => (flow?.actions || []).reduce((sum, a) => sum + actionDelay(a), 0);
  const deepActionCopy = (a, index = 0) => {
    const copy = structuredClone(a); copy.id = uid(); copy.name ||= `${a.type === 'click' ? 'Click' : a.type === 'delay' ? 'Delay' : 'Group'} ${index + 1}`;
    if (copy.type === 'group') copy.actions = (copy.actions || []).map((child, i) => deepActionCopy(child, i));
    return copy;
  };
  const flowPlayback = (flow) => ({ ...playbackDefaults, ...(flow?.playback || {}) });
  const findAction = (actions, id) => {
    for (const action of actions || []) {
      if (action.id === id) return action;
      const child = action.type === 'group' && findAction(action.actions, id);
      if (child) return child;
    }
    return null;
  };

  function newFlow(name = 'New flow') {
    const flow = { id: uid(), name, actions: [], playback: { ...playbackDefaults }, groupId: null, createdAt: nowIso(), updatedAt: nowIso() };
    state.flows.push(flow);
    state.selectedFlowId = flow.id;
    selectedActionId = null;
    scheduleSave();
    renderAll();
    return flow;
  }

  function toast(title, message = '', type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
    $('toastStack').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
  }

  function setStatus(text, kind = '') {
    const el = $('runtimeStatus');
    el.className = `status-pill ${kind}`.trim();
    el.querySelector('span:last-child').textContent = text;
  }

  async function loadState() {
    try {
      let json = null;
      if (invoke) json = await invoke('load_state');
      else json = localStorage.getItem('flowclicker-mock-state');
      if (json) {
        const parsed = JSON.parse(json);
        state = migratePersistedState(parsed);
      }
    } catch (err) {
      toast('Could not load saved state', String(err), 'error');
    }
    if (!state.flows.length) newFlow('My first flow');
    if (!state.flows.some((f) => f.id === state.selectedFlowId)) state.selectedFlowId = state.flows[0].id;
    renderAll();
    syncHotkeys();
    detectPlatform();
  }

  function persistedState() {
    return { version: 3, selectedFlowId: state.selectedFlowId, flows: state.flows, groups: state.groups, settings: state.settings };
  }

  async function saveState(showFeedback = false) {
    clearTimeout(saveTimer);
    try {
      const json = JSON.stringify(persistedState(), null, 2);
      if (invoke) await invoke('save_state', { stateJson: json });
      else localStorage.setItem('flowclicker-mock-state', json);
      if (showFeedback) toast('Saved', `${state.flows.length} flow${state.flows.length === 1 ? '' : 's'} saved locally.`);
    } catch (err) {
      toast('Save failed', String(err), 'error');
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(false), 350);
  }

  async function detectPlatform() {
    if (!invoke) {
      $('platformOs').textContent = 'Browser preview';
      $('platformMouse').textContent = 'Unavailable';
      $('platformCapture').textContent = 'Unavailable';
      $('platformRelative').textContent = 'Unavailable';
      return;
    }
    try {
      const info = await invoke('platform_info');
      $('platformOs').textContent = info.os;
      $('platformMouse').textContent = info.physicalMouseSupported ? '✓ supported' : '✕ unavailable';
      $('platformCapture').textContent = info.globalRecordingSupported ? '✓ supported' : '✕ unavailable';
      $('platformRelative').textContent = info.windowRelativeSupported ? '✓ supported' : 'Screen only';
      if (info.accessibilityNote) {
        $('platformNote').textContent = info.accessibilityNote;
        $('platformNote').classList.remove('hidden');
      } else $('platformNote').classList.add('hidden');
    } catch (err) {
      $('platformOs').textContent = 'Error';
      toast('Platform detection failed', String(err), 'error');
    }
  }

  function renderAll() {
    renderFlowList();
    renderEditor();
    renderSettings();
  }

  function renderFlowList() {
    const search = $('flowSearch').value.trim().toLowerCase();
    const list = $('flowList');
    list.innerHTML = '';
    const groups = [{ id: null, name: 'Ungrouped' }, ...(state.groups || [])];
    for (const group of groups) {
      const heading = document.createElement('div'); heading.className = 'library-group'; heading.dataset.groupId = group.id || '';
      heading.innerHTML = `<div class="library-group-head"><strong>${escapeHtml(group.name)}</strong><span><button class="group-rename" title="Rename group">✎</button>${group.id ? '<button class="group-delete" title="Delete group">×</button>' : ''}</span></div><div class="group-flow-list"></div>`;
      const groupList = heading.querySelector('.group-flow-list');
      heading.querySelector('.group-rename').addEventListener('click', () => renameLibraryGroup(group.id));
      heading.querySelector('.group-delete')?.addEventListener('click', () => deleteLibraryGroup(group.id));
      list.appendChild(heading);
      for (const flow of state.flows.filter((candidate) => (candidate.groupId ?? null) === group.id)) {
      if (search && !flow.name.toLowerCase().includes(search)) continue;
      const rank = combineQueue.indexOf(flow.id);
      const row = document.createElement('div');
      row.className = `flow-row${flow.id === state.selectedFlowId ? ' selected' : ''}`; row.draggable = true;
      row.dataset.flowId = flow.id;
      row.innerHTML = `
        <input class="combine-check" type="checkbox" ${rank >= 0 ? 'checked' : ''} title="Include in combined flow" />
        <div class="flow-main"><div class="flow-row-name">${escapeHtml(flow.name)}</div><div class="flow-row-meta">${flow.actions.length} actions · ${clickCount(flow)} clicks · ${(totalDelay(flow)/1000).toFixed(1)}s delays</div></div>
        <div class="flow-row-actions"><button class="flow-settings" title="Flow settings">⚙</button><span class="combine-rank ${rank < 0 ? 'empty' : ''}">${rank >= 0 ? rank + 1 : '·'}</span></div>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('combine-check')) return;
        hideOverlay(); state.selectedFlowId = flow.id;
        selectedActionId = null;
        scheduleSave();
        renderAll();
      });
      row.querySelector('.combine-check').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!combineQueue.includes(flow.id)) combineQueue.push(flow.id);
        } else combineQueue = combineQueue.filter((id) => id !== flow.id);
        renderFlowList();
      });
      row.querySelector('.flow-settings').addEventListener('click', (e) => { e.stopPropagation(); openFlowSettings(flow); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openFlowMenu(e.clientX, e.clientY, flow); });
      row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/flow-id', flow.id));
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('drop', (e) => { e.preventDefault(); moveFlowBefore(e.dataTransfer.getData('text/flow-id'), flow.id); });
      groupList.appendChild(row);
      }
      heading.addEventListener('dragover', (e) => e.preventDefault());
      heading.addEventListener('drop', (e) => { e.preventDefault(); moveFlowToGroup(e.dataTransfer.getData('text/flow-id'), group.id); });
    }
    const queue = $('combineQueue');
    if (!combineQueue.length) {
      queue.className = 'combine-queue empty';
      queue.textContent = 'No flows checked';
    } else {
      queue.className = 'combine-queue';
      queue.innerHTML = combineQueue.map((id, i) => {
        const f = state.flows.find((x) => x.id === id);
        return `<span class="queue-chip">${i + 1}. ${escapeHtml(f?.name || 'Missing')}</span>`;
      }).join('');
    }
    $('combineCheckedBtn').disabled = combineQueue.length < 2;
  }

  function renameLibraryGroup(id) {
    if (!id) return;
    const group = state.groups.find((candidate) => candidate.id === id); const name = prompt('Group name', group?.name || 'Group');
    if (group && name?.trim()) { group.name = name.trim(); scheduleSave(); renderFlowList(); }
  }
  function deleteLibraryGroup(id) {
    if (!id || !confirm('Delete this group? Its flows will move to Ungrouped.')) return;
    state.flows.forEach((flow) => { if (flow.groupId === id) flow.groupId = null; }); state.groups = state.groups.filter((group) => group.id !== id); scheduleSave(); renderFlowList();
  }
  function moveFlowToGroup(flowId, groupId) { const flow = state.flows.find((candidate) => candidate.id === flowId); if (!flow) return; flow.groupId = groupId || null; touchFlow(flow); renderFlowList(); }
  function moveFlowBefore(flowId, targetId) {
    if (!flowId || flowId === targetId) return;
    const from = state.flows.findIndex((flow) => flow.id === flowId); if (from < 0) return;
    const [flow] = state.flows.splice(from, 1); const to = state.flows.findIndex((candidate) => candidate.id === targetId); if (to < 0) { state.flows.splice(from, 0, flow); return; }
    flow.groupId = state.flows[to].groupId ?? null; state.flows.splice(to, 0, flow); scheduleSave(); renderFlowList();
  }
  function openFlowSettings(flow) {
    const settings = flowPlayback(flow); const speed = prompt('Playback speed', settings.playbackSpeed); if (speed == null) return;
    flow.playback = { ...settings, playbackSpeed: Math.max(.05, Number(speed) || 1) }; touchFlow(flow); if (flow.id === state.selectedFlowId) renderSettings();
  }
  function openFlowMenu(x, y, flow) {
    document.querySelector('.flow-context-menu')?.remove(); const menu = document.createElement('div'); menu.className = 'context-menu flow-context-menu'; menu.style.left = `${x}px`; menu.style.top = `${y}px`;
    menu.innerHTML = '<button data-menu="edit">Edit</button><button data-menu="duplicate">Duplicate</button><button data-menu="delete">Delete</button>'; document.body.appendChild(menu);
    menu.onclick = (event) => { const choice = event.target.dataset.menu; if (choice === 'edit') { state.selectedFlowId = flow.id; renderAll(); } if (choice === 'duplicate') duplicateFlow(flow); if (choice === 'delete') deleteFlow(flow); menu.remove(); };
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  function duplicateFlow(source) { const copy = structuredClone(source); copy.id = uid(); copy.name = `${source.name} copy`; copy.actions = source.actions.map((action) => deepActionCopy(action)); copy.createdAt = nowIso(); copy.updatedAt = nowIso(); state.flows.splice(state.flows.indexOf(source) + 1, 0, copy); state.selectedFlowId = copy.id; selectedActionId = null; scheduleSave(); renderAll(); }
  function createLibraryGroup() { const name = prompt('New group name', 'New group'); if (!name?.trim()) return; state.groups.push({ id: uid(), name: name.trim() }); scheduleSave(); renderFlowList(); }
  function openGroupModal(group) { $('groupNameInput').value = group.name || 'Group'; $('groupRepeatInput').value = Math.max(1, Number(group.repeatCount) || 1); $('groupModal').classList.remove('hidden'); $('saveGroupBtn').onclick = () => { group.name = $('groupNameInput').value.trim() || 'Group'; group.repeatCount = Math.max(1, Number($('groupRepeatInput').value) || 1); touchFlow(currentFlow()); $('groupModal').classList.add('hidden'); renderAll(); }; }
  function deleteFlow(flow) { if (state.flows.length <= 1 || !confirm(`Delete “${flow.name}”?`)) return; state.flows = state.flows.filter((candidate) => candidate.id !== flow.id); state.selectedFlowId = state.flows[0].id; selectedActionId = null; scheduleSave(); renderAll(); }

  function renderEditor() {
    const flow = currentFlow();
    if (!flow) return;
    $('flowName').value = flow.name;
    $('flowMeta').textContent = `${flow.actions.length} actions · ${clickCount(flow)} clicks · ${(totalDelay(flow)/1000).toFixed(2)}s recorded delays`;
    const tbody = $('actionRows');
    tbody.innerHTML = '';
    flow.actions.forEach((a, index) => {
      const tr = document.createElement('tr');
      tr.dataset.actionId = a.id;
      if (a.id === selectedActionId || selectedActionIds.has(a.id)) tr.classList.add('action-selected');
      const pos = a.type === 'click'
        ? `<div style="display:flex;gap:4px"><input class="compact-input coord-x" type="number" value="${Number(a.screenX)||0}" title="Screen X"><input class="compact-input coord-y" type="number" value="${Number(a.screenY)||0}" title="Screen Y"></div>${a.relativeX != null && a.relativeY != null ? `<div style="font-size:8px;color:#657086;margin-top:3px">window ${a.relativeX}, ${a.relativeY}</div>` : ''}`
        : a.type === 'group' ? `<span class="group-summary">${(a.actions || []).length} children · repeats ${Math.max(1, Number(a.repeatCount) || 1)}</span>` : '—';
      tr.innerHTML = `
        <td><input type="checkbox" class="action-select" ${a.id === selectedActionId || selectedActionIds.has(a.id) ? 'checked' : ''}></td>
        <td class="col-no">${index + 1}</td>
        <td><span class="action-type ${a.type}">${a.type === 'click' ? '● Click' : a.type === 'group' ? '▣ Group' : '◷ Delay'}</span></td>
        <td><input class="compact-input name-input action-name" value="${escapeHtml(a.name)}"></td>
        <td>${pos}</td>
        <td>${a.type === 'group' ? `<button class="group-edit">Edit group</button>` : `<div class="inline-field"><input class="compact-input action-delay" type="number" min="0" value="${Number(a.delayMs)||0}"><span>ms</span></div>`}</td>
        <td class="target-cell" title="${escapeHtml(a.windowTitle || '')}">${a.type === 'click' ? escapeHtml(a.windowTitle || 'screen coordinates') : '—'}</td>`;
      tr.addEventListener('click', (e) => {
        if (['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
        selectedActionId = a.id;
        renderEditor();
      });
      tr.querySelector('.action-select').addEventListener('change', (e) => { if (e.target.checked) selectedActionIds.add(a.id); else selectedActionIds.delete(a.id); selectedActionId = a.id; renderEditor(); });
      tr.querySelector('.action-name').addEventListener('change', (e) => { a.name = e.target.value.trim() || `${a.type === 'click' ? 'Click' : 'Delay'} ${index+1}`; touchFlow(flow); });
      tr.querySelector('.action-delay')?.addEventListener('change', (e) => { a.delayMs = Math.max(0, Number(e.target.value)||0); touchFlow(flow); renderEditor(); });
      tr.querySelector('.group-edit')?.addEventListener('click', (e) => { e.stopPropagation(); openGroupModal(a); });
      if (a.type === 'click') {
        tr.querySelector('.coord-x').addEventListener('change', (e) => updateClickPosition(a, Number(e.target.value)||0, a.screenY));
        tr.querySelector('.coord-y').addEventListener('change', (e) => updateClickPosition(a, a.screenX, Number(e.target.value)||0));
      }
      tbody.appendChild(tr);
    });
    $('actionsEmpty').classList.toggle('hidden', flow.actions.length > 0);
    const hasSelection = !!flow.actions.find((a) => a.id === selectedActionId || selectedActionIds.has(a.id));
    $('moveUpBtn').disabled = !hasSelection;
    $('moveDownBtn').disabled = !hasSelection;
    $('duplicateActionBtn').disabled = !hasSelection;
    $('deleteActionBtn').disabled = !hasSelection;
    $('groupActionsBtn').disabled = selectedActionIds.size < 1;
    $('ungroupActionBtn').disabled = !(flow.actions.find((a) => a.id === selectedActionId)?.type === 'group');
    $('deleteFlowBtn').disabled = state.flows.length <= 1;
  }

  function renderSettings() {
    const s = { ...flowPlayback(currentFlow()), ...state.settings };
    $('playbackSpeed').value = s.playbackSpeed;
    $('repeatMode').value = s.repeatMode;
    $('repeatValue').value = s.repeatValue;
    $('repeatUnit').value = s.repeatUnit;
    $('settleMs').value = s.settleMs;
    $('holdMs').value = s.holdMs;
    $('restoreCursor').checked = !!s.restoreCursor;
    $('focusTarget').checked = !!s.focusTargetWindow;
    $('untilTime').value = s.untilTime || '';
    $('recordHotkey').value = s.recordHotkey;
    $('playbackHotkey').value = s.playbackHotkey;
    const continuous = s.repeatMode === 'continuous';
    $('repeatValueRow').classList.toggle('hidden', continuous);
    $('repeatUnitField').classList.toggle('hidden', s.repeatMode !== 'duration');
  }

  function touchFlow(flow) {
    flow.updatedAt = nowIso();
    scheduleSave();
  }

  async function updateClickPosition(action, x, y) {
    action.screenX = Math.round(x);
    action.screenY = Math.round(y);
    if (invoke) {
      try {
        const meta = await invoke('retarget_click', { windowTitle: action.windowTitle || null, screenX: action.screenX, screenY: action.screenY });
        action.relativeX = meta.relativeX;
        action.relativeY = meta.relativeY;
      } catch (err) { console.warn(err); }
    }
    touchFlow(currentFlow());
    renderEditor();
    if (mapVisible) showOverlay(true);
  }

  async function startRecording() {
    if (!invoke) return toast('Recording requires the desktop build', 'The browser preview only demonstrates the UI.', 'error');
    try {
      await hideOverlay();
      await invoke('start_recording');
      recording = true;
      $('recordBtn').classList.add('active');
      $('recordBtn').disabled = true;
      $('stopRecordBtn').disabled = false;
      setStatus('Recording clicks', 'recording');
      toast('Recording started', `Use ${state.settings.recordHotkey} to stop without returning to FlowClicker.`);
    } catch (err) { toast('Could not start recording', String(err), 'error'); }
  }

  async function stopRecording() {
    if (!invoke) return;
    try { await invoke('stop_recording'); } catch (_) {}
    recording = false;
    $('recordBtn').classList.remove('active');
    $('recordBtn').disabled = false;
    $('stopRecordBtn').disabled = true;
    setStatus('Ready');
    toast('Recording stopped', `${currentFlow()?.actions.length || 0} actions in the current flow.`);
  }

  async function runFlow() {
    const flow = currentFlow();
    if (!flow?.actions?.length) return toast('Nothing to run', 'Add at least one click or delay action.', 'error');
    if (!invoke) return toast('Playback requires the desktop build', 'Build and run the FlowClicker desktop app to use native mouse input.', 'error');
    const options = {
      speed: Number(flowPlayback(flow).playbackSpeed) || 1,
      repeatMode: flowPlayback(flow).repeatMode,
      repeatValue: Math.max(1, Number(flowPlayback(flow).repeatValue) || 1),
      repeatUnit: flowPlayback(flow).repeatUnit,
      settleMs: Math.max(0, Number(flowPlayback(flow).settleMs) || 0),
      holdMs: Math.max(0, Number(flowPlayback(flow).holdMs) || 0),
      restoreCursor: !!flowPlayback(flow).restoreCursor,
      focusTargetWindow: !!flowPlayback(flow).focusTargetWindow,
      untilTime: nextDeadline(flowPlayback(flow).untilTime),
    };
    try {
      await hideOverlay();
      await invoke('play_flow', { actionsJson: JSON.stringify(flow.actions), optionsJson: JSON.stringify(options) });
      playing = true;
      $('runBtn').disabled = true;
      $('stopRunBtn').disabled = false;
      setStatus('Playing flow', 'playing');
    } catch (err) { toast('Playback failed', String(err), 'error'); }
  }

  async function stopPlayback() {
    if (!invoke) return;
    await invoke('stop_playback').catch(() => {});
  }

  async function syncHotkeys() {
    if (!invoke) return;
    try { await invoke('set_hotkeys', { recordHotkey: state.settings.recordHotkey, playbackHotkey: state.settings.playbackHotkey }); }
    catch (err) { toast('Hotkey update failed', String(err), 'error'); }
  }

  async function showOverlay(interactive) {
    const flow = currentFlow();
    if (!flow || clickCount(flow) === 0) return toast('No click points', 'This flow has no click actions.', 'error');
    if (!invoke) return toast('Overlay requires the desktop build', '', 'error');
    try {
      await invoke('show_overlay', { actionsJson: JSON.stringify(flow.actions), interactive: true });
      mapVisible = true;
      $('showMapBtn').textContent = 'Hide click map'; $('showMapBtn').setAttribute('aria-pressed', 'true'); $('showMapBtn').classList.add('active');
    } catch (err) { toast('Could not show click map', String(err), 'error'); }
  }

  async function hideOverlay() {
    if (!invoke) return;
    try { await invoke('hide_overlay'); } catch (_) {}
    mapVisible = false;
    $('showMapBtn').textContent = 'Show click map'; $('showMapBtn').setAttribute('aria-pressed', 'false'); $('showMapBtn').classList.remove('active');
  }

  function openImportModal() {
    const flow = currentFlow();
    const sources = state.flows.filter((f) => f.id !== flow?.id);
    if (!sources.length) return toast('No other flows yet', 'Create another flow before importing actions.', 'error');
    $('importSourceFlow').innerHTML = sources.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    $('importPosition').value = selectedActionId ? 'after' : 'end';
    $('importModal').classList.remove('hidden');
    renderImportActions();
  }

  function renderImportActions() {
    const source = state.flows.find((f) => f.id === $('importSourceFlow').value);
    const list = $('importActionList');
    list.innerHTML = '';
    importSelection = new Set(source?.actions.map((a) => a.id) || []);
    (source?.actions || []).forEach((a, i) => {
      const row = document.createElement('label');
      row.className = 'import-action-row';
      row.innerHTML = `<input type="checkbox" checked data-action-id="${a.id}"><span class="num">${i+1}</span><div><strong>${escapeHtml(a.name)}</strong><div class="summary">${a.type === 'click' ? `Click at ${a.screenX}, ${a.screenY}` : `Delay ${a.delayMs} ms`}</div></div><span class="action-type ${a.type}">${a.type}</span>`;
      row.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) importSelection.add(a.id); else importSelection.delete(a.id);
        $('importSelectAll').checked = importSelection.size === (source?.actions.length || 0);
        updateImportCount();
      });
      list.appendChild(row);
    });
    $('importSelectAll').checked = true;
    updateImportCount();
  }

  function updateImportCount() { $('importCount').textContent = `${importSelection.size} selected`; }
  function closeImportModal() { $('importModal').classList.add('hidden'); }

  function confirmImport() {
    const dest = currentFlow();
    const source = state.flows.find((f) => f.id === $('importSourceFlow').value);
    if (!dest || !source) return;
    const copies = source.actions.filter((a) => importSelection.has(a.id)).map((a, i) => deepActionCopy(a, i));
    if (!copies.length) return toast('Nothing selected', 'Choose at least one source action.', 'error');
    const position = $('importPosition').value;
    let index = dest.actions.length;
    if (position === 'beginning') index = 0;
    if (position === 'after' && selectedActionId) {
      const found = dest.actions.findIndex((a) => a.id === selectedActionId);
      index = found >= 0 ? found + 1 : dest.actions.length;
    }
    dest.actions.splice(index, 0, ...copies);
    selectedActionId = copies[0].id;
    touchFlow(dest);
    closeImportModal();
    renderAll();
    toast('Actions imported', `${copies.length} independent action${copies.length === 1 ? '' : 's'} copied from ${source.name}.`);
  }

  function openCombineModal() {
    const flows = combineQueue.map((id) => state.flows.find((f) => f.id === id)).filter(Boolean);
    if (flows.length < 2) return;
    $('combinedFlowName').value = `Combined — ${flows.map((f) => f.name).join(' + ')}`.slice(0, 120);
    $('combineSummary').innerHTML = flows.map((f, i) => `<div class="combine-summary-row"><strong>${i+1}. ${escapeHtml(f.name)}</strong><span>${f.actions.length} actions</span></div>`).join('');
    $('combineModal').classList.remove('hidden');
  }
  function closeCombineModal() { $('combineModal').classList.add('hidden'); }

  function confirmCombine() {
    const sources = combineQueue.map((id) => state.flows.find((f) => f.id === id)).filter(Boolean);
    if (sources.length < 2) return closeCombineModal();
    const name = $('combinedFlowName').value.trim() || 'Combined flow';
    const actions = [];
    sources.forEach((flow) => flow.actions.forEach((a) => actions.push(deepActionCopy(a, actions.length))));
    const flow = { id: uid(), name, actions, playback: flowPlayback(sources[0]), groupId: sources[0].groupId ?? null, createdAt: nowIso(), updatedAt: nowIso(), combinedFrom: sources.map((f) => ({ id: f.id, name: f.name })) };
    state.flows.push(flow);
    state.selectedFlowId = flow.id;
    combineQueue = [];
    selectedActionId = actions[0]?.id || null;
    scheduleSave();
    closeCombineModal();
    renderAll();
    toast('Combined flow created', `${actions.length} copied actions. Source flows were not changed.`);
  }

  function bindUi() {
    $('newFlowBtn').addEventListener('click', () => newFlow(`Flow ${state.flows.length + 1}`));
    $('libraryMenuBtn').addEventListener('click', (event) => { event.stopPropagation(); $('libraryMenu').classList.toggle('hidden'); });
    $('newGroupBtn').addEventListener('click', () => { $('libraryMenu').classList.add('hidden'); createLibraryGroup(); });
    $('combineMenuBtn').addEventListener('click', () => { $('libraryMenu').classList.add('hidden'); openCombineModal(); });
    $('flowsTab').addEventListener('click', () => { $('flowsTab').classList.add('active'); $('settingsTab').classList.remove('active'); document.querySelector('.settings-panel').classList.remove('settings-page'); });
    $('settingsTab').addEventListener('click', () => { $('settingsTab').classList.add('active'); $('flowsTab').classList.remove('active'); document.querySelector('.settings-panel').classList.add('settings-page'); hideOverlay(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideOverlay(); });
    $('flowSettingsBtn').addEventListener('click', () => openFlowSettings(currentFlow()));
    $('flowSearch').addEventListener('input', renderFlowList);
    $('combineCheckedBtn').addEventListener('click', openCombineModal);
    $('flowName').addEventListener('change', (e) => { const f=currentFlow(); if(!f)return; f.name=e.target.value.trim()||'Untitled flow'; touchFlow(f); renderFlowList(); });
    $('deleteFlowBtn').addEventListener('click', () => {
      const f = currentFlow(); if (!f || state.flows.length <= 1) return;
      if (!confirm(`Delete “${f.name}”?`)) return;
      state.flows = state.flows.filter((x) => x.id !== f.id); combineQueue = combineQueue.filter((id) => id !== f.id); state.selectedFlowId = state.flows[0].id; selectedActionId=null; scheduleSave(); renderAll();
    });
    $('recordBtn').addEventListener('click', startRecording); $('stopRecordBtn').addEventListener('click', stopRecording);
    $('runBtn').addEventListener('click', runFlow); $('stopRunBtn').addEventListener('click', stopPlayback);
    $('showMapBtn').addEventListener('click', () => mapVisible ? hideOverlay() : showOverlay(true));
    $('groupActionsBtn').addEventListener('click', () => {
      const f = currentFlow(); const ids = [...selectedActionIds]; const indexes = f?.actions.map((a, i) => ids.includes(a.id) ? i : -1).filter((i) => i >= 0) || [];
      if (!f || !indexes.length || indexes.some((v, i) => i && v !== indexes[i - 1] + 1) || f.actions.slice(indexes[0], indexes.at(-1) + 1).some((a) => a.type === 'group')) return toast('Select contiguous top-level actions', 'Groups cannot be nested.', 'error');
      const children = f.actions.splice(indexes[0], indexes.length, { id: uid(), type: 'group', name: 'Group', repeatCount: 1, actions: f.actions.slice(indexes[0], indexes[0] + indexes.length) });
      f.actions[indexes[0]].actions = children; selectedActionId = f.actions[indexes[0]].id; selectedActionIds = new Set([selectedActionId]); touchFlow(f); renderAll();
    });
    $('ungroupActionBtn').addEventListener('click', () => { const f=currentFlow(); const i=f?.actions.findIndex((a)=>a.id===selectedActionId && a.type==='group') ?? -1; if(i<0)return; const [group]=f.actions.splice(i,1); f.actions.splice(i,0,...group.actions); selectedActionId=group.actions[0]?.id||null; selectedActionIds=new Set(selectedActionId?[selectedActionId]:[]); touchFlow(f); renderAll(); });
    $('closeGroupBtn').addEventListener('click', () => $('groupModal').classList.add('hidden')); $('cancelGroupBtn').addEventListener('click', () => $('groupModal').classList.add('hidden'));
    $('addClickBtn').addEventListener('click', () => {
      const f=currentFlow(); if(!f)return; const ref=f.actions.find((a)=>a.id===selectedActionId && a.type==='click') || [...f.actions].reverse().find((a)=>a.type==='click');
      const n=clickCount(f)+1; const a={id:uid(),type:'click',name:`Click ${n}`,screenX:ref?.screenX||0,screenY:ref?.screenY||0,relativeX:ref?.relativeX??null,relativeY:ref?.relativeY??null,windowTitle:ref?.windowTitle??null,delayMs:0};
      f.actions.push(a); selectedActionId=a.id; touchFlow(f); renderEditor();
    });
    $('addDelayBtn').addEventListener('click', () => { const f=currentFlow(); if(!f)return; const a={id:uid(),type:'delay',name:`Delay ${f.actions.filter(x=>x.type==='delay').length+1}`,delayMs:500}; f.actions.push(a); selectedActionId=a.id; touchFlow(f); renderEditor(); });
    $('importActionsBtn').addEventListener('click', openImportModal);
    $('moveUpBtn').addEventListener('click', () => moveSelected(-1)); $('moveDownBtn').addEventListener('click', () => moveSelected(1));
    $('duplicateActionBtn').addEventListener('click', () => { const f=currentFlow(); const i=f?.actions.findIndex(a=>a.id===selectedActionId)??-1; if(i<0)return; const copy=deepActionCopy(f.actions[i],i); copy.name=`${copy.name} copy`; f.actions.splice(i+1,0,copy); selectedActionId=copy.id; touchFlow(f); renderEditor(); });
    $('deleteActionBtn').addEventListener('click', () => { const f=currentFlow(); const i=f?.actions.findIndex(a=>a.id===selectedActionId)??-1; if(i<0)return; f.actions.splice(i,1); selectedActionId=f.actions[Math.min(i,f.actions.length-1)]?.id||null; touchFlow(f); renderEditor(); });
    $('saveNowBtn').addEventListener('click', () => saveState(true));

    ['playbackSpeed','repeatValue','settleMs','holdMs','untilTime'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
    ['repeatMode','repeatUnit'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
    ['restoreCursor','focusTarget'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
    ['recordHotkey','playbackHotkey'].forEach((id) => $(id).addEventListener('change', async () => { saveSettingsFromUi(); await syncHotkeys(); }));

    $('closeImportBtn').addEventListener('click', closeImportModal); $('cancelImportBtn').addEventListener('click', closeImportModal); $('confirmImportBtn').addEventListener('click', confirmImport); $('importSourceFlow').addEventListener('change', renderImportActions);
    $('importSelectAll').addEventListener('change', (e) => { const source=state.flows.find(f=>f.id===$('importSourceFlow').value); importSelection=new Set(e.target.checked?(source?.actions||[]).map(a=>a.id):[]); renderImportActionsFromSelection(source); });
    $('closeCombineBtn').addEventListener('click', closeCombineModal); $('cancelCombineBtn').addEventListener('click', closeCombineModal); $('confirmCombineBtn').addEventListener('click', confirmCombine);
  }

  function renderImportActionsFromSelection(source) {
    $('importActionList').querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = importSelection.has(cb.dataset.actionId));
    $('importSelectAll').checked = importSelection.size === (source?.actions.length || 0) && importSelection.size > 0;
    updateImportCount();
  }

  function moveSelected(delta) {
    const f=currentFlow(); const i=f?.actions.findIndex(a=>a.id===selectedActionId)??-1; if(i<0)return; const j=i+delta; if(j<0||j>=f.actions.length)return; [f.actions[i],f.actions[j]]=[f.actions[j],f.actions[i]]; touchFlow(f); renderEditor();
  }

  function saveSettingsFromUi() {
    const flow = currentFlow(); if (!flow) return;
    flow.playback = { ...flowPlayback(flow), playbackSpeed: Math.max(.05, Number($('playbackSpeed').value)||1), repeatMode: $('repeatMode').value, repeatValue: Math.max(1, Number($('repeatValue').value)||1), repeatUnit: $('repeatUnit').value, settleMs: Math.max(0, Number($('settleMs').value)||0), holdMs: Math.max(0, Number($('holdMs').value)||0), restoreCursor: $('restoreCursor').checked, focusTargetWindow: $('focusTarget').checked, untilTime: $('untilTime').value || null };
    state.settings.recordHotkey = $('recordHotkey').value.trim();
    state.settings.playbackHotkey = $('playbackHotkey').value.trim();
    touchFlow(flow); renderSettings();
  }

  async function bindTauriEvents() {
    if (!listen) return;
    await listen('recorded-click', (event) => {
      const flow=currentFlow(); if(!flow)return; const c=event.payload; const a={id:uid(),type:'click',name:`Click ${clickCount(flow)+1}`,screenX:c.screenX,screenY:c.screenY,relativeX:c.relativeX,relativeY:c.relativeY,windowTitle:c.windowTitle,delayMs:c.delayMs}; flow.actions.push(a); selectedActionId=a.id; touchFlow(flow); renderEditor(); renderFlowList();
    });
    await listen('hotkey-record', () => recording ? stopRecording() : startRecording());
    await listen('hotkey-play', () => playing ? stopPlayback() : runFlow());
    await listen('playback-state', (event) => {
      playing = event.payload === 'playing'; $('runBtn').disabled=playing; $('stopRunBtn').disabled=!playing; setStatus(playing?'Playing flow':'Ready', playing?'playing':''); if(!playing) toast('Playback finished');
    });
    await listen('playback-error', (event) => { playing=false; $('runBtn').disabled=false; $('stopRunBtn').disabled=true; setStatus('Ready'); toast('Playback error', String(event.payload), 'error'); });
    await listen('input-listener-error', (event) => toast('Global input listener failed', String(event.payload), 'error'));
    await listen('overlay-action-moved', async (event) => {
      const flow=currentFlow(); const move=event.payload; const action=findAction(flow?.actions, move.actionId); if(!action||action.type!=='click')return; await updateClickPosition(action,move.screenX,move.screenY); toast('Click point moved', `${action.name} → ${move.screenX}, ${move.screenY}`);
    });
  }

  bindUi(); bindTauriEvents(); loadState();
})();
