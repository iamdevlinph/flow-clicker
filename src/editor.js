import { editorRowsHtml } from './editor-table.mjs';

const T = window.__TAURI__ || {};
const emit = T.event?.emit;
const listen = T.event?.listen;
const $ = (id) => document.getElementById(id);
let snapshot = null;
let selected = new Set();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>\'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const send = (type, payload = {}) => emit?.('editor-intent', { type, ...payload });
function render() {
  const flow = snapshot?.flow;
  if (!flow) return;
  $('editorHeading').value = flow.name;
  $('flowMeta').textContent = `${flow.actions.length} actions`;
  $('recordBtn').disabled = !!snapshot.recording; $('recordBtn').classList.toggle('active', !!snapshot.recording);
  $('stopRecordBtn').disabled = !snapshot.recording; $('runBtn').disabled = !!snapshot.playing; $('stopRunBtn').disabled = !snapshot.playing;
  $('showMapBtn').textContent = snapshot.mapVisible ? 'Hide click map' : 'Show click map'; $('showMapBtn').setAttribute('aria-pressed', String(!!snapshot.mapVisible));
  $('actionRows').innerHTML = editorRowsHtml(flow.actions, snapshot.mapVisible && snapshot.selectedActionId ? [snapshot.selectedActionId] : []);
  $('actionsEmpty').classList.toggle('hidden', flow.actions.length > 0);
  $('actionRows').querySelectorAll('tr').forEach((row) => {
    const id = row.dataset.id;
    row.onclick = (event) => {
      if (event.target.closest('input, button, select, textarea, a')) return;
      selected = new Set([id]); send('select-action', { actionId: id, multi: false });
    };
    row.querySelector('.action-name').onchange = (event) => send('action-update', { actionId: id, field: 'name', value: event.target.value });
    row.querySelector('.action-delay')?.addEventListener('change', (event) => send('action-update', { actionId: id, field: 'delayMs', value: event.target.value }));
    row.querySelector('.coord-x')?.addEventListener('change', (event) => send('action-update', { actionId: id, field: 'screenX', value: event.target.value }));
    row.querySelector('.coord-y')?.addEventListener('change', (event) => send('action-update', { actionId: id, field: 'screenY', value: event.target.value }));
    row.querySelectorAll('.row-action').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.action;
      if (type === 'move-up') send('move-action', { actionId: id, delta: -1 });
      if (type === 'move-down') send('move-action', { actionId: id, delta: 1 });
      if (type === 'duplicate') send('duplicate-action', { actionId: id });
      if (type === 'delete') send('delete-action', { actionId: id });
    }));
  });
}
const click = (id, type, payload) => $(id)?.addEventListener('click', () => send(type, typeof payload === 'function' ? payload() : payload));
listen?.('editor-snapshot', (event) => { snapshot = event.payload; selected = new Set(snapshot.selectedActionIds || []); render(); });
$('editorHeading').addEventListener('change', (event) => send('rename', { value: event.target.value }));
click('recordBtn', 'record'); click('stopRecordBtn', 'stop-record'); click('runBtn', 'run'); click('stopRunBtn', 'stop'); click('showMapBtn', 'map');
click('addClickBtn', 'add-click'); click('addDelayBtn', 'add-delay'); click('importBtn', 'import');
