(() => {
  const T = window.__TAURI__ || null;
  const invoke = T?.core?.invoke;
  const listen = T?.event?.listen;
  const $ = (id) => document.getElementById(id);

  const defaults = {
    version: 2,
    selectedFlowId: null,
    flows: [],
    settings: {
      playbackSpeed: 1,
      repeatMode: 'cycles',
      repeatValue: 1,
      repeatUnit: 'seconds',
      settleMs: 12,
      holdMs: 30,
      restoreCursor: false,
      focusTargetWindow: true,
      recordHotkey: 'Alt+Shift+R',
      playbackHotkey: 'Alt+Shift+P',
    },
  };

  let state = structuredClone(defaults);
  let combineQueue = [];
  let selectedActionId = null;
  let recording = false;
  let playing = false;
  let mapVisible = false;
  let saveTimer = null;
  let importSelection = new Set();

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nowIso = () => new Date().toISOString();
  const currentFlow = () => state.flows.find((f) => f.id === state.selectedFlowId) || null;
  const clickCount = (flow) => flow?.actions?.filter((a) => a.type === 'click').length || 0;
  const totalDelay = (flow) => (flow?.actions || []).reduce((sum, a) => sum + Math.max(0, Number(a.delayMs) || 0), 0);
  const deepActionCopy = (a, index = 0) => ({ ...structuredClone(a), id: uid(), name: a.name || `${a.type === 'click' ? 'Click' : 'Delay'} ${index + 1}` });

  function newFlow(name = 'New flow') {
    const flow = { id: uid(), name, actions: [], createdAt: nowIso(), updatedAt: nowIso() };
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
        state = {
          ...structuredClone(defaults),
          ...parsed,
          settings: { ...defaults.settings, ...(parsed.settings || {}) },
          flows: Array.isArray(parsed.flows) ? parsed.flows : [],
        };
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
    return { version: 2, selectedFlowId: state.selectedFlowId, flows: state.flows, settings: state.settings };
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
    for (const flow of state.flows) {
      if (search && !flow.name.toLowerCase().includes(search)) continue;
      const rank = combineQueue.indexOf(flow.id);
      const row = document.createElement('div');
      row.className = `flow-row${flow.id === state.selectedFlowId ? ' selected' : ''}`;
      row.dataset.flowId = flow.id;
      row.innerHTML = `
        <input class="combine-check" type="checkbox" ${rank >= 0 ? 'checked' : ''} title="Include in combined flow" />
        <div class="flow-main"><div class="flow-row-name">${escapeHtml(flow.name)}</div><div class="flow-row-meta">${flow.actions.length} actions · ${clickCount(flow)} clicks · ${(totalDelay(flow)/1000).toFixed(1)}s delays</div></div>
        <div class="combine-rank ${rank < 0 ? 'empty' : ''}">${rank >= 0 ? rank + 1 : '·'}</div>`;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('combine-check')) return;
        state.selectedFlowId = flow.id;
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
      list.appendChild(row);
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
      if (a.id === selectedActionId) tr.classList.add('action-selected');
      const pos = a.type === 'click'
        ? `<div style="display:flex;gap:4px"><input class="compact-input coord-x" type="number" value="${Number(a.screenX)||0}" title="Screen X"><input class="compact-input coord-y" type="number" value="${Number(a.screenY)||0}" title="Screen Y"></div>${a.relativeX != null && a.relativeY != null ? `<div style="font-size:8px;color:#657086;margin-top:3px">window ${a.relativeX}, ${a.relativeY}</div>` : ''}`
        : '—';
      tr.innerHTML = `
        <td><input type="radio" name="selectedAction" ${a.id === selectedActionId ? 'checked' : ''}></td>
        <td class="col-no">${index + 1}</td>
        <td><span class="action-type ${a.type}">${a.type === 'click' ? '● Click' : '◷ Delay'}</span></td>
        <td><input class="compact-input name-input action-name" value="${escapeHtml(a.name)}"></td>
        <td>${pos}</td>
        <td><div class="inline-field"><input class="compact-input action-delay" type="number" min="0" value="${Number(a.delayMs)||0}"><span>ms</span></div></td>
        <td class="target-cell" title="${escapeHtml(a.windowTitle || '')}">${a.type === 'click' ? escapeHtml(a.windowTitle || 'screen coordinates') : '—'}</td>`;
      tr.addEventListener('click', (e) => {
        if (['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) return;
        selectedActionId = a.id;
        renderEditor();
      });
      tr.querySelector('input[type="radio"]').addEventListener('change', () => { selectedActionId = a.id; renderEditor(); });
      tr.querySelector('.action-name').addEventListener('change', (e) => { a.name = e.target.value.trim() || `${a.type === 'click' ? 'Click' : 'Delay'} ${index+1}`; touchFlow(flow); });
      tr.querySelector('.action-delay').addEventListener('change', (e) => { a.delayMs = Math.max(0, Number(e.target.value)||0); touchFlow(flow); renderEditor(); });
      if (a.type === 'click') {
        tr.querySelector('.coord-x').addEventListener('change', (e) => updateClickPosition(a, Number(e.target.value)||0, a.screenY));
        tr.querySelector('.coord-y').addEventListener('change', (e) => updateClickPosition(a, a.screenX, Number(e.target.value)||0));
      }
      tbody.appendChild(tr);
    });
    $('actionsEmpty').classList.toggle('hidden', flow.actions.length > 0);
    const hasSelection = !!flow.actions.find((a) => a.id === selectedActionId);
    $('moveUpBtn').disabled = !hasSelection;
    $('moveDownBtn').disabled = !hasSelection;
    $('duplicateActionBtn').disabled = !hasSelection;
    $('deleteActionBtn').disabled = !hasSelection;
    $('deleteFlowBtn').disabled = state.flows.length <= 1;
  }

  function renderSettings() {
    const s = state.settings;
    $('playbackSpeed').value = s.playbackSpeed;
    $('repeatMode').value = s.repeatMode;
    $('repeatValue').value = s.repeatValue;
    $('repeatUnit').value = s.repeatUnit;
    $('settleMs').value = s.settleMs;
    $('holdMs').value = s.holdMs;
    $('restoreCursor').checked = !!s.restoreCursor;
    $('focusTarget').checked = !!s.focusTargetWindow;
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
    if (!invoke) return toast('Playback requires the desktop build', 'Use the prebuilt Windows probe to test native mouse input.', 'error');
    const options = {
      speed: Number(state.settings.playbackSpeed) || 1,
      repeatMode: state.settings.repeatMode,
      repeatValue: Math.max(1, Number(state.settings.repeatValue) || 1),
      repeatUnit: state.settings.repeatUnit,
      settleMs: Math.max(0, Number(state.settings.settleMs) || 0),
      holdMs: Math.max(0, Number(state.settings.holdMs) || 0),
      restoreCursor: !!state.settings.restoreCursor,
      focusTargetWindow: !!state.settings.focusTargetWindow,
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
      await invoke('show_overlay', { actionsJson: JSON.stringify(flow.actions), interactive });
      mapVisible = true;
      $('hideMapBtn').disabled = false;
    } catch (err) { toast('Could not show click map', String(err), 'error'); }
  }

  async function hideOverlay() {
    if (!invoke) return;
    try { await invoke('hide_overlay'); } catch (_) {}
    mapVisible = false;
    $('hideMapBtn').disabled = true;
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
    const flow = { id: uid(), name, actions, createdAt: nowIso(), updatedAt: nowIso(), combinedFrom: sources.map((f) => ({ id: f.id, name: f.name })) };
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
    $('showMapBtn').addEventListener('click', () => showOverlay(false)); $('editPointsBtn').addEventListener('click', () => showOverlay(true)); $('hideMapBtn').addEventListener('click', hideOverlay);
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

    ['playbackSpeed','repeatValue','settleMs','holdMs'].forEach((id) => $(id).addEventListener('change', saveSettingsFromUi));
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
    state.settings.playbackSpeed = Math.max(.05, Number($('playbackSpeed').value)||1);
    state.settings.repeatMode = $('repeatMode').value;
    state.settings.repeatValue = Math.max(1, Number($('repeatValue').value)||1);
    state.settings.repeatUnit = $('repeatUnit').value;
    state.settings.settleMs = Math.max(0, Number($('settleMs').value)||0);
    state.settings.holdMs = Math.max(0, Number($('holdMs').value)||0);
    state.settings.restoreCursor = $('restoreCursor').checked;
    state.settings.focusTargetWindow = $('focusTarget').checked;
    state.settings.recordHotkey = $('recordHotkey').value.trim();
    state.settings.playbackHotkey = $('playbackHotkey').value.trim();
    scheduleSave(); renderSettings();
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
      const flow=currentFlow(); const move=event.payload; const action=flow?.actions.find(a=>a.id===move.actionId); if(!action||action.type!=='click')return; await updateClickPosition(action,move.screenX,move.screenY); toast('Click point moved', `${action.name} → ${move.screenX}, ${move.screenY}`);
    });
  }

  bindUi(); bindTauriEvents(); loadState();
})();
