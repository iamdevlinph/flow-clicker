import assert from 'node:assert/strict';
import test from 'node:test';
import { actionClickCount, combineFlows, copyAction, groupContiguous, migrateState, moveItem, nextDeadline, normalizeEditorSize, ungroupAction } from './state-model.mjs';
import { removeFlow, normalizeFlowSelection } from './flow-lifecycle.mjs';
import { hotkeysOverlap, normalizeHotkeyEvent } from './hotkey.mjs';

test('migrates v2 playback to shared settings and strips flow playback', () => {
  const source = { version: 2, groups: [{ id: 'legacy', name: 'Legacy' }, { id: 'closed', name: 'Closed', collapsed: true }], flows: [{ id: 'f', playback: { playbackSpeed: 9 }, actions: [{ id: 'a', type: 'click' }] }], settings: { repeatMode: 'clicks', repeatValue: 4, recordHotkey: 'R' } };
  const migrated = migrateState(source);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.groups, [{ id: 'legacy', name: 'Legacy', collapsed: false }, { id: 'closed', name: 'Closed', collapsed: true }]);
  assert.equal(migrated.settings.playback.repeatMode, 'cycles');
  assert.equal(migrated.settings.playback.repeatValue, 4);
  assert.equal('recordHotkey' in migrated.settings.playback, false);
  assert.equal('playbackHotkey' in migrated.settings.playback, false);
  assert.equal(migrated.flows[0].playback, undefined);
  assert.deepEqual(migrated.settings, { recordHotkey: 'R', playbackHotkey: 'Alt+Shift+P', playback: migrated.settings.playback });
  assert.deepEqual(source.flows[0].actions, [{ id: 'a', type: 'click' }]);
});

test('migrates v3 shared playback with selected, first, and default precedence immutably', () => {
  const selected = { version: 3, selectedFlowId: 'selected', settings: {}, flows: [{ id: 'first', playback: { repeatValue: 2 } }, { id: 'selected', playback: { repeatValue: 3 } }] };
  assert.equal(migrateState(selected).settings.playback.repeatValue, 3);
  const global = { version: 3, selectedFlowId: 'selected', settings: { playback: { repeatValue: 4 } }, flows: [{ id: 'first', playback: { repeatValue: 2 } }, { id: 'selected', playback: { repeatValue: 3 } }] };
  assert.equal(migrateState(global).settings.playback.repeatValue, 4);
  const source = structuredClone(global); const migrated = migrateState(source);
  assert.deepEqual(source.flows[0].playback, { repeatValue: 2 });
  assert.equal(migrated.flows.every((flow) => !('playback' in flow)), true);
  assert.equal(migrateState({ version: 3, flows: [{ id: 'first', playback: { repeatValue: 5 } }], settings: {} }).settings.playback.repeatValue, 5);
  assert.equal(migrateState({ version: 3, flows: [{ id: 'first' }], settings: {} }).settings.playback.repeatValue, 1);
  assert.equal('playback' in combineFlows([{ name: 'A', actions: [] }, { name: 'B', actions: [] }], () => 'id'), false);
});

test('normalizes editor size without mutating persisted state', () => {
  const source = { version: 3, editorSize: { width: 1200, height: 800 }, flows: [] };
  assert.deepEqual(migrateState(source).editorSize, { width: 1200, height: 800 });
  assert.deepEqual(source.editorSize, { width: 1200, height: 800 });
  for (const editorSize of [undefined, null, {}, { width: '1200', height: 800 }, { width: 0, height: 800 }, { width: Infinity, height: 800 }]) {
    assert.equal(normalizeEditorSize(editorSize), null);
    assert.equal(migrateState({ editorSize }).editorSize, null);
  }
});

test('copies grouped actions with fresh recursive ids', () => {
  let id = 0;
  const source = { id: 'g', type: 'group', repeatCount: 3, actions: [{ id: 'c', type: 'click' }] };
  const copy = copyAction(source, () => String(++id));
  assert.deepEqual([copy.id, copy.actions[0].id], ['1', '2']);
  assert.equal(actionClickCount(copy), 3);
  assert.equal(source.actions[0].id, 'c');
});

test('groups only contiguous leaves and ungroups without copying', () => {
  const actions = ['a', 'b', 'c'].map((id) => ({ id, type: 'click' }));
  let id = 0;
  const grouped = groupContiguous(actions, ['a', 'b'], () => `g${++id}`);
  assert.equal(grouped.group.actions.length, 2);
  assert.equal(ungroupAction([grouped.group], grouped.group.id).actions.length, 2);
  assert.equal(groupContiguous(actions, ['a', 'c'], () => 'g'), null);
  assert.equal(groupContiguous([grouped.group], [grouped.group.id], () => 'nested'), null);
});

test('moves manually and rolls past local times to tomorrow', () => {
  assert.deepEqual(moveItem([{ id: 'a' }, { id: 'b' }], 'b', 'a').map(({ id }) => id), ['b', 'a']);
  const now = new Date('2026-08-24T20:00:00');
  assert.equal(new Date(nextDeadline('19:00', now)).getDate(), 25);
  assert.equal(nextDeadline('25:00', now), null);
});

test('normalizes empty flow selection and deletion lifecycle', () => {
  const empty = normalizeFlowSelection({ flows: [], selectedFlowId: 'missing' });
  assert.equal(empty.selectedFlowId, null);
  const state = { flows: [{ id: 'a' }, { id: 'b' }], selectedFlowId: 'b' };
  assert.equal(removeFlow(state, 'a').selectedFlowId, 'b');
  assert.equal(removeFlow(state, 'b').selectedFlowId, 'a');
  assert.equal(removeFlow({ ...state, selectedFlowId: 'a' }, 'a').selectedFlowId, 'b');
  assert.equal(removeFlow({ flows: [{ id: 'a' }], selectedFlowId: 'a' }, 'a').selectedFlowId, null);
});

test('accepts canonical hotkeys and rejects unsupported keys', () => {
  const event = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, key: 'r' };
  assert.equal(normalizeHotkeyEvent(event), 'Ctrl+Shift+R');
  assert.equal(normalizeHotkeyEvent({ ...event, key: 'F12' }), 'Ctrl+Shift+F12');
  assert.equal(normalizeHotkeyEvent({ ...event, ctrlKey: false, shiftKey: false, key: 'F1' }), 'F1');
  assert.equal(normalizeHotkeyEvent({ ...event, ctrlKey: false, shiftKey: false, key: 'F8' }), 'F8');
  assert.equal(normalizeHotkeyEvent({ ...event, ctrlKey: false, shiftKey: false, key: 'F12' }), 'F12');
  assert.equal(normalizeHotkeyEvent({ ...event, key: 'ArrowUp' }), null);
  assert.equal(normalizeHotkeyEvent({ ...event, ctrlKey: false, shiftKey: false }), null);
  assert.equal(hotkeysOverlap('F8', 'Ctrl+F8'), true);
  assert.equal(hotkeysOverlap('F8', 'Ctrl+F9'), false);
  assert.equal(hotkeysOverlap('Ctrl+F8', 'Alt+F8'), false);
});
