import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedFlows } from './combine-selection.mjs';
import { editorRowsHtml } from './editor-table.mjs';
import { moveFlow, moveFlowByKey } from './flow-ordering.mjs';
import { playbackFromForm, playbackToForm } from './playback-form.mjs';

test('flow ordering preserves group membership and selection order', () => {
  const flows = [{ id: 'a', groupId: 'g' }, { id: 'b', groupId: 'g' }, { id: 'c', groupId: null }];
  assert.deepEqual(moveFlowByKey(flows, 'b', -1).map(({ id }) => id), ['b', 'a', 'c']);
  const moved = moveFlow(flows, 'c', 'a', 'g');
  assert.deepEqual(moved.map(({ id }) => id), ['c', 'a', 'b']);
  assert.equal(moved[0].groupId, 'g');
  assert.deepEqual(selectedFlows(['b', 'a'], moved).map(({ id }) => id), ['b', 'a']);
});

test('playback form maps values without global settings', () => {
  const fields = Object.fromEntries(['playbackSpeed','repeatMode','repeatValue','repeatUnit','settleMs','holdMs','untilTime','restoreCursor','focusTarget'].map((id) => [id, { value: '', checked: false }]));
  playbackToForm({ playbackSpeed: 2, repeatMode: 'duration', repeatValue: 3, repeatUnit: 'minutes', settleMs: 4, holdMs: 5, restoreCursor: true, focusTargetWindow: false }, (id) => fields[id]);
  assert.deepEqual(playbackFromForm((id) => fields[id]), { playbackSpeed: 2, repeatMode: 'duration', repeatValue: 3, repeatUnit: 'minutes', settleMs: 4, holdMs: 5, restoreCursor: true, focusTargetWindow: false, untilTime: null });
});

test('editor renders separate X/Y cells and keeps delay with ms', () => {
  const html = editorRowsHtml([{ id: 'a', type: 'click', name: 'Click', screenX: 12, screenY: 34, delayMs: 56 }]);
  assert.match(html, /coord-x[^>]*value="12"/);
  assert.match(html, /<\/td><td><input class="compact-input coord-y"[^>]*value="34"/);
  assert.match(html, /class="delay-input"[\s\S]*>ms<\/span>/);
});
