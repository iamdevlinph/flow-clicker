import { actionClickCount, migrateState as migratePersistedState, nextDeadline, normalizeEditorSize } from './state-model.mjs';
import { selectedFlows, selectionName, toggleSelection } from './combine-selection.mjs';
import { moveFlow, moveFlowByKey } from './flow-ordering.mjs';
import { normalizePlayback, playbackDefaults, playbackFromForm, playbackToForm } from './playback-form.mjs';
import { renderFlowLibrary } from './flow-library.mjs';
import { toggleLibraryGroup, updateLibraryGroups } from './library-group.mjs';
import { normalizeFlowSelection, removeFlow } from './flow-lifecycle.mjs';
import { hotkeysOverlap, normalizeHotkeyEvent } from './hotkey.mjs';
import { bindDurationInput } from './duration-input.mjs';

(() => {
  const T = window.__TAURI__ || null;
  const invoke = T?.core?.invoke;
  const listen = T?.event?.listen;
  const emitTo = T?.event?.emitTo;
  const $ = (id) => document.getElementById(id);

  const defaults = {
    version: 3,
    editorSize: null,
    selectedFlowId: null,
    flows: [],
    groups: [],
    settings: {
      recordHotkey: 'Alt+Shift+R',
      playbackHotkey: 'Alt+Shift+P',
      playback: { ...playbackDefaults },
    },
  };

  let state = structuredClone(defaults);
  let combineQueue = [];
  let selectedActionId = null;
  let selectedActionIds = new Set();
  let recording = false;
  let playing = false;
  let runningFlowId = null;
  let mapVisible = false;
  let saveTimer = null;
  let saveQueue = Promise.resolve();
  let importSelection = new Set();
  const dialogFocus = new Map();
  let editorOpen = false;
  let restoreEditor = false;
  let pendingDeleteFlow = null;
  let deleteInProgress = false;
  let capturingHotkey = null;

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
  const flowPlayback = () => normalizePlayback(state.settings.playback);
  const findAction = (actions, id) => {
    for (const action of actions || []) {
      if (action.id === id) return action;
      const child = action.type === 'group' && findAction(action.actions, id);
      if (child) return child;
    }
    return null;
  };

  function newFlow(name = 'New flow') {
    const flow = { id: uid(), name, actions: [], groupId: null, createdAt: nowIso(), updatedAt: nowIso() };
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
    state = normalizeFlowSelection(state);
    setView('compact');
    renderAll();
    syncHotkeys();
    detectPlatform();
  }

  function persistedState() {
    return { version: 3, editorSize: normalizeEditorSize(state.editorSize), selectedFlowId: state.selectedFlowId, flows: state.flows, groups: state.groups, settings: state.settings };
  }

  function saveState(showFeedback = false) {
    clearTimeout(saveTimer);
    const json = JSON.stringify(persistedState(), null, 2);
    saveQueue = saveQueue.then(async () => {
      try {
        if (invoke) await invoke('save_state', { stateJson: json });
        else localStorage.setItem('flowclicker-mock-state', json);
        if (showFeedback) toast('Saved', `${state.flows.length} flow${state.flows.length === 1 ? '' : 's'} saved locally.`);
      } catch (err) {
        toast('Save failed', String(err), 'error');
      }
    });
    return saveQueue;
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
    publishEditorSnapshot();
    renderSettings();
  }

  function setView(view) {
    document.body.classList.toggle('settings-view', view === 'settings');
    if (view !== 'settings') closeSettingsModal();
  }

  function editorSnapshot() {
    const flow = currentFlow();
    return flow ? structuredClone({ flow, selectedActionId, selectedActionIds: [...selectedActionIds], recording, playing, mapVisible }) : null;
  }

  function publishEditorSnapshot() {
    const snapshot = editorSnapshot();
    if (snapshot && emitTo) emitTo('editor', 'editor-snapshot', snapshot).catch(() => {});
  }

  async function openEditor(flow) {
    if (!flow) return;
    state.selectedFlowId = flow.id;
    selectedActionId = null;
    setView('compact');
    try { await invoke('show_editor', { editorSize: state.editorSize }); editorOpen = true; } catch (err) { toast('Editor unavailable', String(err), 'error'); return; }
    publishEditorSnapshot();
  }

  async function closeEditor() {
    editorOpen = false;
    try {
      const size = await invoke('hide_editor');
      if (size) { state.editorSize = normalizeEditorSize(size); await saveState(); }
    } catch (_) {}
  }
  function suspendEditorForModal() { if (!editorOpen) return; restoreEditor = true; invoke('hide_editor').catch(() => {}); }
  async function restoreEditorAfterModal() { if (!restoreEditor) return; restoreEditor = false; try { await invoke('show_editor', { editorSize: state.editorSize }); publishEditorSnapshot(); } catch (_) {} }

  function applyEditorIntent(intent = {}) {
    const flow = currentFlow();
    if (intent.type === 'close') return closeEditor();
    if (!flow) return;
    if (intent.type === 'select-action') { selectedActionId = intent.actionId || null; selectedActionIds = new Set(intent.multi ? intent.actionIds || [] : (intent.actionId ? [intent.actionId] : [])); return publishEditorSnapshot(); }
    const action = intent.actionId ? findAction(flow.actions, intent.actionId) : null;
    if (intent.type === 'rename') flow.name = String(intent.value || '').trim() || 'Untitled flow';
    if (intent.type === 'action-update' && action) {
      if (intent.field === 'name') action.name = String(intent.value || '').trim() || action.name;
      if (intent.field === 'delayMs') action.delayMs = Math.max(0, Number(intent.value) || 0);
      if (intent.field === 'screenX') action.screenX = Math.round(Number(intent.value) || 0);
      if (intent.field === 'screenY') action.screenY = Math.round(Number(intent.value) || 0);
    }
    if (intent.type === 'add-click') flow.actions.push({ id: uid(), type: 'click', name: `Click ${clickCount(flow) + 1}`, screenX: 0, screenY: 0, delayMs: 0 });
    if (intent.type === 'add-delay') flow.actions.push({ id: uid(), type: 'delay', name: `Delay ${flow.actions.filter((a) => a.type === 'delay').length + 1}`, delayMs: 500 });
    if (intent.type === 'delete-action' && action) flow.actions = flow.actions.filter((candidate) => candidate.id !== action.id);
    if (intent.type === 'move-action' && action) { const index = flow.actions.indexOf(action); const next = index + Number(intent.delta || 0); if (next >= 0 && next < flow.actions.length) [flow.actions[index], flow.actions[next]] = [flow.actions[next], flow.actions[index]]; }
    if (intent.type === 'duplicate-action' && action) { const copy = deepActionCopy(action, flow.actions.indexOf(action)); flow.actions.splice(flow.actions.indexOf(action) + 1, 0, copy); }
    if (intent.type === 'settings') return openFlowSettings(flow);
    if (intent.type === 'record') return startRecording();
    if (intent.type === 'stop-record') return stopRecording();
    if (intent.type === 'run') return runFlow();
    if (intent.type === 'stop') return stopPlayback();
    if (intent.type === 'map') return mapVisible ? hideOverlay() : showOverlay(true);
    if (intent.type === 'import') return openImportModal();
    touchFlow(flow); renderAll();
  }

  function openDialog(id, focusId, origin = document.activeElement) {
    dialogFocus.set(id, origin);
    $('appShell').inert = true;
    $(id).classList.remove('hidden');
    $(focusId)?.focus();
  }

  function closeDialog(id) {
    $(id)?.classList.add('hidden');
    if (!document.querySelector('.modal-backdrop:not(.hidden)')) $('appShell').inert = false;
    dialogFocus.get(id)?.focus?.();
    dialogFocus.delete(id);
    restoreEditorAfterModal();
  }

  function renderFlowList() {
    const search = $('flowSearch').value.trim().toLowerCase();
    renderFlowLibrary({ list: $('flowList'), groups: state.groups || [], flows: state.flows, selectedFlowId: state.selectedFlowId, combineQueue, runningFlowId, search, escapeHtml,
      onSelect: (flow) => { hideOverlay(); state.selectedFlowId = flow.id; selectedActionId = null; scheduleSave(); renderAll(); },
      onEdit: openEditor, onCreateFlow: () => { const flow = newFlow(`Flow ${state.flows.length + 1}`); openEditor(flow); }, onSettings: openFlowSettings, onPlay: runFlow, onToggleCombine: toggleCombineFlow, onToggleGroup: (id) => { state.groups = toggleLibraryGroup(state.groups, id); scheduleSave(); renderFlowList(); }, onMenu: openFlowMenu, onRenameGroup: renameLibraryGroup, onDeleteGroup: deleteLibraryGroup, onMoveBefore: moveFlowBefore, onMoveToGroup: moveFlowToGroup,
      moveByKey: (flow, delta) => { const moved = moveFlowByKey(state.flows, flow.id, delta); if (moved === state.flows) return false; state.flows = moved; touchFlow(state.flows.find((candidate) => candidate.id === flow.id)); renderFlowList(); return true; },
      announce: (flow, direction) => toast('Flow reordered', `${flow.name} moved ${direction}.`),
    });
  }

  function renameLibraryGroup(id) {
    if (!id) return;
    const group = state.groups.find((candidate) => candidate.id === id);
    if (group) openLibraryGroupModal(group);
  }
  function deleteLibraryGroup(id) {
    if (!id || !confirm('Delete this group? Its flows will move to Ungrouped.')) return;
    state.flows.forEach((flow) => { if (flow.groupId === id) flow.groupId = null; }); state.groups = state.groups.filter((group) => group.id !== id); scheduleSave(); renderFlowList();
  }
  function moveFlowToGroup(flowId, groupId) { if (!state.flows.some((flow) => flow.id === flowId)) return; state.flows = moveFlow(state.flows, flowId, null, groupId); touchFlow(state.flows.find((flow) => flow.id === flowId)); renderFlowList(); }
  function moveFlowBefore(flowId, targetId) {
    if (!flowId || flowId === targetId) return;
    const target = state.flows.find((flow) => flow.id === targetId); const flow = state.flows.find((candidate) => candidate.id === flowId); if (!target || !flow) return;
    state.flows = moveFlow(state.flows, flowId, targetId, target.groupId); touchFlow(state.flows.find((candidate) => candidate.id === flowId)); renderFlowList();
  }
  function openFlowSettings(flow) {
    if (!flow) return;
    suspendEditorForModal();
    renderSettings();
    openDialog('flowSettingsModal', 'closeFlowSettingsBtn');
  }
  function closeSettingsModal() {
    if (!$('flowSettingsModal')?.classList.contains('hidden')) closeDialog('flowSettingsModal');
  }
  function openFlowMenu(x, y, flow) {
    document.querySelector('.flow-context-menu')?.remove(); const menu = document.createElement('div'); menu.className = 'context-menu flow-context-menu'; menu.style.left = `${x}px`; menu.style.top = `${y}px`;
    menu.innerHTML = '<button data-menu="edit">Edit</button><button data-menu="duplicate">Duplicate</button><button data-menu="delete">Delete</button>'; document.body.appendChild(menu);
    menu.onclick = (event) => { const choice = event.target.dataset.menu; if (choice === 'edit') openEditor(flow); if (choice === 'duplicate') duplicateFlow(flow); if (choice === 'delete') deleteFlow(flow); menu.remove(); };
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  function duplicateFlow(source) { const { playback: _playback, ...copy } = structuredClone(source); copy.id = uid(); copy.name = `${source.name} copy`; copy.actions = source.actions.map((action) => deepActionCopy(action)); copy.createdAt = nowIso(); copy.updatedAt = nowIso(); state.flows.splice(state.flows.indexOf(source) + 1, 0, copy); state.selectedFlowId = copy.id; selectedActionId = null; scheduleSave(); renderAll(); openEditor(copy); }
  function createLibraryGroup() { openLibraryGroupModal(null); }
  function openLibraryGroupModal(group) {
    $('libraryGroupHeading').textContent = group ? 'Rename group' : 'New group';
    $('libraryGroupNameInput').value = group?.name || '';
    suspendEditorForModal();
    openDialog('libraryGroupModal', 'libraryGroupNameInput');
    $('saveLibraryGroupBtn').onclick = () => {
      const name = $('libraryGroupNameInput').value.trim();
      if (!name) return $('libraryGroupNameInput').focus();
      state.groups = updateLibraryGroups(state.groups, group?.id, name, uid());
      scheduleSave(); closeDialog('libraryGroupModal'); renderFlowList();
    };
  }
  function openGroupModal(group) { $('groupNameInput').value = group.name || 'Group'; $('groupRepeatInput').value = Math.max(1, Number(group.repeatCount) || 1); openDialog('groupModal', 'groupNameInput'); $('saveGroupBtn').onclick = () => { group.name = $('groupNameInput').value.trim() || 'Group'; group.repeatCount = Math.max(1, Number($('groupRepeatInput').value) || 1); touchFlow(currentFlow()); closeDialog('groupModal'); renderAll(); }; }
  function deleteFlow(flow) {
    if (!flow) return;
    pendingDeleteFlow = flow;
    $('deleteFlowMessage').textContent = `Delete “${flow.name}”? This cannot be undone.`;
    suspendEditorForModal();
    const origin = document.querySelector(`[data-flow-id="${CSS.escape(flow.id)}"]`) || $('newFlowBtn');
    openDialog('deleteFlowModal', 'cancelDeleteFlowBtn', origin);
  }

  async function confirmDeleteFlow() {
    const flow = pendingDeleteFlow;
    if (deleteInProgress) return;
    if (!flow) return closeDialog('deleteFlowModal');
    deleteInProgress = true;
    try {
      if (recording) await stopRecording();
      state = removeFlow(state, flow.id);
      combineQueue = combineQueue.filter((id) => id !== flow.id);
      importSelection = new Set(); selectedActionId = null; selectedActionIds = new Set(); pendingDeleteFlow = null;
      const empty = !state.flows.length;
      if (empty) restoreEditor = false;
      dialogFocus.set('deleteFlowModal', $('newFlowBtn'));
      closeDialog('deleteFlowModal');
      if (empty) { hideOverlay(); closeEditor(); }
      scheduleSave(); renderAll();
    } finally { deleteInProgress = false; }
  }

  function renderSettings() {
    const s = playbackToForm(flowPlayback(), $);
    $('recordHotkey').textContent = state.settings.recordHotkey;
    $('playbackHotkey').textContent = state.settings.playbackHotkey;
    $('repeatValueRow').classList.toggle('hidden', s.repeatMode !== 'cycles');
    $('repeatTimerRow').classList.toggle('hidden', s.repeatMode !== 'duration');
    $('untilTimeField').classList.toggle('hidden', s.repeatMode !== 'until');
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
    renderAll();
    if (mapVisible) showOverlay(true);
  }

  async function startRecording() {
    if (!invoke) return toast('Recording requires the desktop build', 'The browser preview only demonstrates the UI.', 'error');
    try {
      await hideOverlay();
      await invoke('start_recording');
      recording = true;
      publishEditorSnapshot();
      setStatus('Recording clicks', 'recording');
      toast('Recording started', `Use ${state.settings.recordHotkey} to stop without returning to FlowClicker.`);
    } catch (err) { toast('Could not start recording', String(err), 'error'); }
  }

  async function stopRecording() {
    if (!invoke) { recording = false; publishEditorSnapshot(); setStatus('Ready'); return; }
    try { await invoke('stop_recording'); } catch (_) {}
    recording = false;
    publishEditorSnapshot();
    setStatus('Ready');
    toast('Recording stopped', `${currentFlow()?.actions.length || 0} actions in the current flow.`);
  }

  async function runFlow(flow = currentFlow()) {
    if (flow) { state.selectedFlowId = flow.id; scheduleSave(); }
    if (!flow?.actions?.length) return toast('Nothing to run', 'Add at least one click or delay action.', 'error');
    if (!invoke) return toast('Playback requires the desktop build', 'Build and run the FlowClicker desktop app to use native mouse input.', 'error');
    runningFlowId = flow.id;
    renderFlowList();
    const options = {
      speed: Number(flowPlayback().playbackSpeed) || 1,
      repeatMode: flowPlayback().repeatMode,
      repeatValue: Math.max(1, Number(flowPlayback().repeatValue) || 1),
      repeatUnit: 'seconds',
      settleMs: Math.max(0, Number(flowPlayback().settleMs) || 0),
      holdMs: Math.max(0, Number(flowPlayback().holdMs) || 0),
      restoreCursor: !!flowPlayback().restoreCursor,
      focusTargetWindow: !!flowPlayback().focusTargetWindow,
      untilTime: nextDeadline(flowPlayback().untilTime),
    };
    try {
      await hideOverlay();
      await invoke('play_flow', { actionsJson: JSON.stringify(flow.actions), optionsJson: JSON.stringify(options) });
      publishEditorSnapshot();
    } catch (err) { playing = false; runningFlowId = null; renderFlowList(); toast('Playback failed', String(err), 'error'); }
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
      mapVisible = true; publishEditorSnapshot();
    } catch (err) { toast('Could not show click map', String(err), 'error'); }
  }

  async function hideOverlay() {
    if (!invoke) return;
    try { await invoke('hide_overlay'); } catch (_) {}
    mapVisible = false; publishEditorSnapshot();
  }

  function openImportModal() {
    const flow = currentFlow();
    const sources = state.flows.filter((f) => f.id !== flow?.id);
    if (!sources.length) return toast('No other flows yet', 'Create another flow before importing actions.', 'error');
    $('importSourceFlow').innerHTML = sources.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    $('importPosition').value = selectedActionId ? 'after' : 'end';
    suspendEditorForModal();
    openDialog('importModal', 'importSourceFlow');
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
  function closeImportModal() { closeDialog('importModal'); }

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
    if (selectedFlows(combineQueue, state.flows).length < 2) return toast('Select two flows', 'Choose at least two flow cards before combining.', 'error');
    $('combinedFlowName').value = 'Combined flow';
    openDialog('combineModal', 'combinedFlowName');
    renderCombineChoices();
  }
  function renderCombineChoices() {
    const flows = selectedFlows(combineQueue, state.flows);
    $('combinedFlowName').value = selectionName(flows) || 'Combined flow';
    $('combineSummary').innerHTML = flows.map((flow, index) => `<div class="combine-summary-row"><strong>${index + 1}. ${escapeHtml(flow.name)}</strong><span>${flow.actions.length} actions</span></div>`).join('');
    $('confirmCombineBtn').disabled = flows.length < 2;
  }
  function toggleCombineFlow(flow, checked) {
    combineQueue = toggleSelection(combineQueue, flow.id, checked);
    renderFlowList();
  }
  function closeCombineModal() { closeDialog('combineModal'); }

  function confirmCombine() {
    const sources = selectedFlows(combineQueue, state.flows);
    if (sources.length < 2) return closeCombineModal();
    const name = $('combinedFlowName').value.trim() || 'Combined flow';
    const actions = [];
    sources.forEach((flow) => flow.actions.forEach((a) => actions.push(deepActionCopy(a, actions.length))));
    const flow = { id: uid(), name, actions, groupId: sources[0].groupId ?? null, createdAt: nowIso(), updatedAt: nowIso(), combinedFrom: sources.map((f) => ({ id: f.id, name: f.name })) };
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
    const closeLibraryMenu = () => { $('libraryMenu').classList.add('hidden'); $('libraryMenuBtn').setAttribute('aria-expanded', 'false'); };
    $('newFlowBtn').addEventListener('click', () => { const flow = newFlow(`Flow ${state.flows.length + 1}`); openEditor(flow); });
    $('libraryMenuBtn').addEventListener('click', (event) => { event.stopPropagation(); const hidden = $('libraryMenu').classList.toggle('hidden'); $('libraryMenuBtn').setAttribute('aria-expanded', String(!hidden)); });
    $('newGroupBtn').addEventListener('click', () => { closeLibraryMenu(); createLibraryGroup(); });
    $('combineMenuBtn').addEventListener('click', () => { closeLibraryMenu(); openCombineModal(); });
    $('flowsTab').addEventListener('click', () => { $('flowsTab').classList.add('active'); $('settingsTab').classList.remove('active'); setView('compact'); });
    $('settingsTab').addEventListener('click', () => { $('settingsTab').classList.add('active'); $('flowsTab').classList.remove('active'); setView('settings'); hideOverlay(); renderSettings(); });
    $('closeFlowSettingsBtn').addEventListener('click', () => closeDialog('flowSettingsModal'));
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.library-menu-wrap')) closeLibraryMenu();
      for (const id of ['importModal', 'combineModal', 'groupModal', 'libraryGroupModal', 'flowSettingsModal', 'deleteFlowModal']) if (event.target === $(id)) closeDialog(id);
    });
    document.addEventListener('keydown', (event) => {
      const modal = document.querySelector('.modal-backdrop:not(.hidden) .modal');
      if (event.key === 'Tab' && modal) {
        const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        if (focusable.length) {
          const edge = event.shiftKey ? focusable[0] : focusable.at(-1);
          if (document.activeElement === edge || !modal.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus(); }
        }
        return;
      }
      if (event.key !== 'Escape') return;
      closeLibraryMenu(); closeSettingsModal(); hideOverlay(); closeCombineModal(); closeImportModal(); closeDialog('groupModal'); closeDialog('libraryGroupModal'); closeDialog('deleteFlowModal');
    });
    $('flowSearch').addEventListener('input', renderFlowList);
    ['playbackSpeed','repeatValue','settleMs','holdMs','untilTime'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
    bindDurationInput($('repeatDuration'), saveSettingsFromUi);
    $('repeatMode').addEventListener('change', () => {
      const mode = $('repeatMode').value;
      $('repeatValueRow').classList.toggle('hidden', mode !== 'cycles');
      $('repeatTimerRow').classList.toggle('hidden', mode !== 'duration');
      $('untilTimeField').classList.toggle('hidden', mode !== 'until');
      if (mode !== 'until') saveSettingsFromUi();
    });
    ['restoreCursor','focusTarget'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
    ['recordHotkey','playbackHotkey'].forEach((id) => {
      const button = $(id);
      button.addEventListener('click', () => { capturingHotkey = { id, accepted: false, syncing: false, released: false }; button.classList.add('capturing'); button.textContent = 'Press a shortcut…'; button.focus(); });
      button.addEventListener('blur', () => {
        if (!capturingHotkey || capturingHotkey.id !== id) return;
        if (capturingHotkey.accepted) return;
        capturingHotkey = null; button.classList.remove('capturing'); button.textContent = state.settings[id];
      });
      button.addEventListener('keydown', async (event) => {
        if (!capturingHotkey || capturingHotkey.id !== id) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') return button.blur();
        if (capturingHotkey.accepted) return;
        const shortcut = normalizeHotkeyEvent(event);
        if (!shortcut) return toast('Unsupported shortcut', 'Use F1–F12 alone, or Ctrl, Alt, Shift, or Meta plus a letter, number, F-key, Space, or Enter.', 'error');
        const other = id === 'recordHotkey' ? 'playbackHotkey' : 'recordHotkey';
        if (state.settings[other] === shortcut || hotkeysOverlap(state.settings[other], shortcut)) return toast('Shortcut already used', 'Choose a shortcut that does not overlap the other toggle.', 'error');
        const capture = capturingHotkey;
        capture.accepted = true; capture.syncing = true; state.settings[id] = shortcut; button.textContent = shortcut; scheduleSave();
        await syncHotkeys();
        if (capturingHotkey !== capture) return;
        capture.syncing = false;
        if (capture.released) { capturingHotkey = null; button.classList.remove('capturing'); }
      });
      button.addEventListener('keyup', (event) => {
        if (!capturingHotkey || capturingHotkey.id !== id || !capturingHotkey.accepted) return;
        capturingHotkey.released = true;
        if (!capturingHotkey.syncing) { capturingHotkey = null; button.classList.remove('capturing'); }
      });
    });
    document.addEventListener('keyup', () => {
      if (!capturingHotkey?.accepted) return;
      capturingHotkey.released = true;
      if (!capturingHotkey.syncing) { document.getElementById(capturingHotkey.id)?.classList.remove('capturing'); capturingHotkey = null; }
    });
    $('cancelDeleteFlowBtn').addEventListener('click', () => { pendingDeleteFlow = null; closeDialog('deleteFlowModal'); });
    $('confirmDeleteFlowBtn').addEventListener('click', confirmDeleteFlow);

    $('closeImportBtn').addEventListener('click', closeImportModal); $('cancelImportBtn').addEventListener('click', closeImportModal); $('confirmImportBtn').addEventListener('click', confirmImport); $('importSourceFlow').addEventListener('change', renderImportActions);
    $('importSelectAll').addEventListener('change', (e) => { const source=state.flows.find(f=>f.id===$('importSourceFlow').value); importSelection=new Set(e.target.checked?(source?.actions||[]).map(a=>a.id):[]); renderImportActionsFromSelection(source); });
    $('closeCombineBtn').addEventListener('click', closeCombineModal); $('cancelCombineBtn').addEventListener('click', closeCombineModal); $('confirmCombineBtn').addEventListener('click', confirmCombine);
    $('closeLibraryGroupBtn').addEventListener('click', () => closeDialog('libraryGroupModal')); $('cancelLibraryGroupBtn').addEventListener('click', () => closeDialog('libraryGroupModal'));
  }

  function renderImportActionsFromSelection(source) {
    $('importActionList').querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = importSelection.has(cb.dataset.actionId));
    $('importSelectAll').checked = importSelection.size === (source?.actions.length || 0) && importSelection.size > 0;
    updateImportCount();
  }

  function moveSelected(delta) {
    const f=currentFlow(); const i=f?.actions.findIndex(a=>a.id===selectedActionId)??-1; if(i<0)return; const j=i+delta; if(j<0||j>=f.actions.length)return; [f.actions[i],f.actions[j]]=[f.actions[j],f.actions[i]]; touchFlow(f); publishEditorSnapshot();
  }

  function saveSettingsFromUi() {
    state.settings.playback = playbackFromForm($);
    scheduleSave(); renderSettings();
  }

  async function bindTauriEvents() {
    if (!listen) return;
    await listen('editor-intent', (event) => applyEditorIntent(event.payload));
    await listen('editor-window-closed', async (event) => {
      editorOpen = false;
      const size = normalizeEditorSize(event.payload);
      if (size) { state.editorSize = size; await saveState(); }
    });
    await listen('recorded-click', (event) => {
      const flow=currentFlow(); if(!flow)return; const c=event.payload; const a={id:uid(),type:'click',name:`Click ${clickCount(flow)+1}`,screenX:c.screenX,screenY:c.screenY,relativeX:c.relativeX,relativeY:c.relativeY,windowTitle:c.windowTitle,delayMs:c.delayMs}; flow.actions.push(a); selectedActionId=a.id; touchFlow(flow); renderAll();
    });
    await listen('hotkey-record', () => { if (!capturingHotkey) return recording ? stopRecording() : startRecording(); });
    await listen('hotkey-play', () => { if (!capturingHotkey) return playing ? stopPlayback() : runFlow(); });
    await listen('playback-state', (event) => {
      playing = event.payload === 'playing'; if (!playing) runningFlowId = null; else if (!runningFlowId) runningFlowId = state.selectedFlowId;
      publishEditorSnapshot(); renderFlowList(); setStatus(playing?'Playing flow':'Ready', playing?'playing':''); if(!playing) toast('Playback finished');
    });
    await listen('playback-error', (event) => { playing=false; runningFlowId = null; publishEditorSnapshot(); renderFlowList(); setStatus('Ready'); toast('Playback error', String(event.payload), 'error'); });
    await listen('input-listener-error', (event) => toast('Global input listener failed', String(event.payload), 'error'));
    await listen('overlay-action-moved', async (event) => {
      const flow=currentFlow(); const move=event.payload; const action=findAction(flow?.actions, move.actionId); if(!action||action.type!=='click')return; await updateClickPosition(action,move.screenX,move.screenY); toast('Click point moved', `${action.name} → ${move.screenX}, ${move.screenY}`);
    });
  }

  bindUi(); bindTauriEvents(); loadState();
})();
