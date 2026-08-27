import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPortableData, parsePortableData, replaceWithPortableData } from './data-transfer.mjs';

const click = (id = 'a') => ({ type: 'click', id, name: 'Click', screenX: 10, screenY: 20, relativeX: null, relativeY: null, windowTitle: null, delayMs: 3 });
const state = () => ({ version: 3, editorSize: { width: 800, height: 600 }, selectedFlowId: 'old', settings: { recordHotkey: 'R', playbackHotkey: 'P', playback: { playbackSpeed: 2 } }, groups: [{ id: 'g', name: 'Group', collapsed: false }], flows: [{ id: 'f', name: 'Flow', groupId: 'g', createdAt: 'now', updatedAt: 'now', playback: { repeatValue: 9 }, actions: [click()] }] });

test('export omits device fields and deep-copies flow data', () => {
  const source = state();
  const exported = JSON.parse(exportPortableData(source));
  assert.deepEqual(Object.keys(exported), ['version', 'flows', 'groups']);
  assert.equal(exported.flows[0].playback, undefined);
  exported.flows[0].actions[0].name = 'changed';
  assert.equal(source.flows[0].actions[0].name, 'Click');
});

test('round-trip import preserves local settings and selects first flow', () => {
  const source = state();
  const imported = replaceWithPortableData(source, exportPortableData(source));
  assert.equal(imported.selectedFlowId, 'f');
  assert.deepEqual(imported.settings, source.settings);
  assert.deepEqual(imported.editorSize, source.editorSize);
  imported.flows[0].name = 'new';
  assert.equal(source.flows[0].name, 'Flow');
});

test('empty libraries import with no selection', () => {
  const imported = replaceWithPortableData(state(), JSON.stringify({ version: 3, flows: [], groups: [] }));
  assert.equal(imported.selectedFlowId, null);
});

test('accepts click actions recorded without optional window coordinates', () => {
  const source = state();
  source.flows[0].actions = [{ type: 'click', id: 'a', name: 'Click', screenX: 10, screenY: 20, delayMs: 0 }];
  assert.equal(parsePortableData(exportPortableData(source)).flows[0].actions[0].id, 'a');
});

test('defaults legacy button and preserves right button through portable transfer', () => {
  const source = state();
  source.flows[0].actions = [click(), { ...click('b'), button: 'right' }];
  const imported = parsePortableData(exportPortableData(source));
  assert.equal(imported.flows[0].actions[0].button, 'left');
  assert.equal(imported.flows[0].actions[1].button, 'right');
});

test('round-trips combined-flow provenance', () => {
  const source = state();
  source.flows[0].combinedFrom = [{ id: 'source', name: 'Source flow' }];
  assert.deepEqual(parsePortableData(exportPortableData(source)).flows[0].combinedFrom, source.flows[0].combinedFrom);
});

for (const [name, payload] of [
  ['malformed JSON', '{'],
  ['unsupported version', JSON.stringify({ version: 2, flows: [], groups: [] })],
  ['invalid action', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: null, createdAt: '', updatedAt: '', actions: [{ type: 'wat' }] }], groups: [] })],
  ['out-of-range coordinates', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: null, createdAt: '', updatedAt: '', actions: [click()] }], groups: [] }).replace('"screenX":10', '"screenX":2147483648')],
  ['unsafe integer delay', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: null, createdAt: '', updatedAt: '', actions: [{ ...click(), delayMs: 1e100 }] }], groups: [] })],
  ['unsupported button', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: null, createdAt: '', updatedAt: '', actions: [{ ...click(), button: 'middle' }] }], groups: [] })],
  ['duplicate IDs', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: null, createdAt: '', updatedAt: '', actions: [click('f')] }], groups: [] })],
  ['broken group reference', JSON.stringify({ version: 3, flows: [{ id: 'f', name: 'F', groupId: 'missing', createdAt: '', updatedAt: '', actions: [] }], groups: [] })],
]) test(`rejects ${name}`, () => assert.throws(() => parsePortableData(payload)));
