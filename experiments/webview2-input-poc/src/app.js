const $ = (id) => document.getElementById(id);
const invoke = window.__TAURI__?.core?.invoke ?? (cmd => Promise.reject(new Error(`Tauri unavailable: ${cmd}`)));
const status = (text, kind = '') => { $('status').textContent = text; $('status').className = `status ${kind}`; };
const run = (cmd, args) => invoke(cmd, args).catch(error => { status('BACKEND INVESTIGATION REQUIRED', 'error'); throw error; });
const show = (id, value) => { $(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
let replayResult;
const updateGate = () => {
  const names = replayResult?.replay_events?.map(event => event.event);
  const physicalNames = replayResult?.physical_events?.map(event => event.event);
  const ordered = JSON.stringify(names) === JSON.stringify(['pointermove','pointerdown','mousedown','pointerup','mouseup','click']);
  const physicalOrdered = JSON.stringify(physicalNames) === JSON.stringify(['pointermove','pointerdown','mousedown','pointerup','mouseup','click']);
  const physicalClick = replayResult?.physical_events?.at(-1), replayClick = replayResult?.replay_events?.at(-1);
  const sameCoordinates = physicalClick?.x === replayClick?.x && physicalClick?.y === replayClick?.y;
  if (replayResult && !replayResult.cursor_moved && ordered && physicalOrdered && sameCoordinates && replayResult.replay_events.every(event => event.is_trusted) && replayResult.physical_events.every(event => event.is_trusted) && $('physicalConfirm').checked && $('replayConfirm').checked) status('PASS', 'pass');
};

for (const [id, cmd] of [['open','open_game'],['focus','focus_game'],['reload','reload_game'],['close','close_game'],['clear','clear_test']]) $(id).onclick = () => run(cmd);
$('arm').onclick = () => run('arm_physical_capture').then(() => status('CAPTURE ARMED'));
$('replay').onclick = () => run('replay_last_click', { settleMs: Number($('settle').value), holdMs: Number($('hold').value) }).then(result => { replayResult = result; show('cursor', `${result.cursor_before} → ${result.cursor_after}`); show('moved', result.cursor_moved ? 'YES' : 'NO'); show('cdp', result.cdp); show('events', `PHYSICAL\n${result.physical_events?.map(event => event.event).join(' → ')}\nREPLAY\n${result.replay_events?.map(event => `${event.event} trusted=${event.is_trusted}`).join(' → ')}`); status('BACKEND INVESTIGATION REQUIRED', 'error'); updateGate(); });
$('selfTest').onclick = () => run('run_backend_self_test').then(result => show('selfTestResult', result));
for (const id of ['physicalConfirm', 'replayConfirm']) $(id).onchange = updateGate;
window.__TAURI__?.event?.listen('physical-click', event => { show('physical', event.payload); show('events', event.payload.events); });
window.__TAURI__?.event?.listen('physical-diagnostic', event => { show('events', `PHYSICAL\n${event.payload.event}`); });
