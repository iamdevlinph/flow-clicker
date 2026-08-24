import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedFlows, toggleSelection } from './combine-selection.mjs';
import { editorRowsHtml } from './editor-table.mjs';
import { flowRowMarkup } from './flow-library.mjs';
import { updateLibraryGroups } from './library-group.mjs';
import { moveFlow, moveFlowByKey } from './flow-ordering.mjs';
import { normalizePlayback, playbackFromForm, playbackToForm, secondsToTimer, timerToSeconds } from './playback-form.mjs';

test('flow ordering preserves group membership and selection order', () => {
  const flows = [{ id: 'a', groupId: 'g' }, { id: 'b', groupId: 'g' }, { id: 'c', groupId: null }];
  assert.deepEqual(moveFlowByKey(flows, 'b', -1).map(({ id }) => id), ['b', 'a', 'c']);
  const moved = moveFlow(flows, 'c', 'a', 'g');
  assert.deepEqual(moved.map(({ id }) => id), ['c', 'a', 'b']);
  assert.equal(moved[0].groupId, 'g');
  assert.deepEqual(selectedFlows(['b', 'a'], moved).map(({ id }) => id), ['b', 'a']);
});

test('combine card selection keeps click order and supports deselection', () => {
  let ids = [];
  ids = toggleSelection(ids, 'b', true);
  ids = toggleSelection(ids, 'a', true);
  ids = toggleSelection(ids, 'b', false);
  ids = toggleSelection(ids, 'b', true);
  assert.deepEqual(ids, ['a', 'b']);
  assert.deepEqual(selectedFlows(ids, [{ id: 'a' }, { id: 'b' }]).map(({ id }) => id), ['a', 'b']);
});

test('flow cards use four columns and omit metadata', () => {
  const html = flowRowMarkup({ flow: { id: 'a', name: 'Flow', actions: [] }, escapeHtml: (value) => value, combineSelected: true });
  assert.match(html, /^<input class="flow-combine"[\s\S]*<button class="flow-play"[\s\S]*<div class="flow-main"[\s\S]*<div class="flow-row-actions"/);
  assert.doesNotMatch(html, /flow-row-meta|actions ·|clicks ·|delays/);
});

test('combine summary source order follows card selection order', () => {
  const flows = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
  assert.deepEqual(selectedFlows(['a', 'b'], flows).map(({ name }) => name), ['Alpha', 'Beta']);
});

test('library group cancel leaves state and save leaves flow timestamps alone', () => {
  const groups = [{ id: 'g', name: 'Old' }];
  const flows = [{ id: 'f', updatedAt: 'fixed' }];
  assert.equal(updateLibraryGroups(groups, 'g', '   ', 'new'), null);
  assert.deepEqual(groups, [{ id: 'g', name: 'Old' }]);
  const renamed = updateLibraryGroups(groups, 'g', ' New ', 'new');
  const created = updateLibraryGroups(renamed, null, ' Extra ', 'x');
  assert.deepEqual(created, [{ id: 'g', name: 'New' }, { id: 'x', name: 'Extra' }]);
  assert.deepEqual(flows, [{ id: 'f', updatedAt: 'fixed' }]);
});

test('playback form maps repeat count, timer, until, and continuous modes', () => {
  const fields = Object.fromEntries(['playbackSpeed','repeatMode','repeatValue','repeatDuration','settleMs','holdMs','untilTime','restoreCursor','focusTarget'].map((id) => [id, { value: '', checked: false }]));
  playbackToForm({ playbackSpeed: 2, repeatMode: 'duration', repeatValue: 3, repeatUnit: 'minutes', settleMs: 4, holdMs: 5, restoreCursor: true, focusTargetWindow: false }, (id) => fields[id]);
  assert.equal(fields.repeatMode.value, 'duration');
  assert.equal(fields.repeatDuration.value, '00:03:00');
  assert.deepEqual(playbackFromForm((id) => fields[id]), { playbackSpeed: 2, repeatMode: 'duration', repeatValue: 180, repeatUnit: 'seconds', settleMs: 4, holdMs: 5, restoreCursor: true, focusTargetWindow: false, untilTime: null });
  fields.repeatMode.value = 'cycles'; fields.repeatValue.value = '3';
  assert.equal(playbackFromForm((id) => fields[id]).repeatValue, 3);
  fields.repeatMode.value = 'until'; fields.untilTime.value = '09:30';
  assert.deepEqual(playbackFromForm((id) => fields[id]).untilTime, '09:30');
  assert.equal(playbackFromForm((id) => fields[id]).repeatMode, 'continuous');
  assert.equal(playbackToForm({ repeatMode: 'continuous', untilTime: '09:30' }, (id) => fields[id]).repeatMode, 'until');
});

test('timer conversion clamps invalid sub-minute values and zero duration', () => {
  assert.equal(timerToSeconds(1, 75, 99), 7199);
  assert.equal(timerToSeconds(0, 0, 0), 1);
  assert.deepEqual(secondsToTimer(3661), { hours: 1, minutes: 1, seconds: 1 });
  assert.equal(normalizePlayback({ repeatMode: 'duration', repeatValue: 999999 }).repeatValue, 359999);
  assert.equal(normalizePlayback({ repeatMode: 'clicks', repeatValue: 4 }).repeatMode, 'cycles');
  assert.equal(normalizePlayback({ repeatMode: 'clicks', repeatValue: 4 }).repeatValue, 4);
  assert.equal(normalizePlayback({ repeatMode: 'cycles', repeatValue: 4, untilTime: '09:30' }).repeatMode, 'continuous');
});

test('editor renders separate X/Y cells and keeps delay with ms', () => {
  const html = editorRowsHtml([{ id: 'a', type: 'click', name: 'Click', screenX: 12, screenY: 34, delayMs: 56, windowTitle: 'A <target>' }, { id: 'd', type: 'delay', name: 'Delay', delayMs: 3 }]);
  assert.match(html, /coord-x[^>]*value="12"/);
  assert.match(html, /<\/td><td><input class="compact-input coord-y"[^>]*value="34"/);
  assert.match(html, /class="delay-input"[\s\S]*>ms<\/span>/);
  assert.match(html, /class="icon-btn target-info"[\s\S]*title="A &lt;target&gt;"[\s\S]*aria-label="Target: A &lt;target&gt;"/);
  assert.doesNotMatch(html, />A &lt;target&gt;</);
  assert.match(html, /<td class="target-cell">—<\/td>/);
});

test('editor highlights only selected clicks for the click map', () => {
  const html = editorRowsHtml([{ id: 'click', type: 'click' }, { id: 'delay', type: 'delay' }], ['click', 'delay']);
  assert.match(html, /data-id="click" class="action-selected"/);
  assert.doesNotMatch(html, /data-id="delay" class="action-selected"/);
});
