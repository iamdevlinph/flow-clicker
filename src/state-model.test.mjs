import assert from 'node:assert/strict';
import test from 'node:test';
import { actionClickCount, copyAction, groupContiguous, migrateState, moveItem, nextDeadline, ungroupAction } from './state-model.mjs';

test('migrates v2 playback to flows and retains only hotkeys globally', () => {
  const source = { version: 2, flows: [{ id: 'f', actions: [{ id: 'a', type: 'click' }] }], settings: { repeatMode: 'clicks', repeatValue: 4, recordHotkey: 'R' } };
  const migrated = migrateState(source);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.flows[0].playback.repeatMode, 'clicks');
  assert.deepEqual(migrated.settings, { recordHotkey: 'R', playbackHotkey: 'Alt+Shift+P' });
  assert.deepEqual(source.flows[0].actions, [{ id: 'a', type: 'click' }]);
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
