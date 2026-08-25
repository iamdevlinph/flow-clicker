import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectedFlows, toggleSelection } from './combine-selection.mjs';
import { editorRowsHtml } from './editor-table.mjs';
import { flowRowMarkup, groupHeaderMarkup } from './flow-library.mjs';
import { toggleLibraryGroup, updateLibraryGroups } from './library-group.mjs';
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
  assert.match(html, /class="flow-settings"[^>]*aria-label="Playback settings"/);
  assert.doesNotMatch(html, /flow-row-meta|actions ·|clicks ·|delays/);
});

test('combine summary source order follows card selection order', () => {
  const flows = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
  assert.deepEqual(selectedFlows(['a', 'b'], flows).map(({ name }) => name), ['Alpha', 'Beta']);
});

test('library group cancel leaves state and save leaves flow timestamps alone', () => {
  const groups = [{ id: 'g', name: 'Old', collapsed: true }];
  const flows = [{ id: 'f', updatedAt: 'fixed' }];
  assert.equal(updateLibraryGroups(groups, 'g', '   ', 'new'), null);
  assert.deepEqual(groups, [{ id: 'g', name: 'Old', collapsed: true }]);
  const renamed = updateLibraryGroups(groups, 'g', ' New ', 'new');
  const created = updateLibraryGroups(renamed, null, ' Extra ', 'x');
  assert.deepEqual(created, [{ id: 'g', name: 'New', collapsed: true }, { id: 'x', name: 'Extra', collapsed: false }]);
  assert.deepEqual(flows, [{ id: 'f', updatedAt: 'fixed' }]);
});

test('group disclosure exposes saved state and collapse toggling is immutable', () => {
  const group = { id: 'g', name: 'Group', collapsed: true };
  const html = groupHeaderMarkup({ group, escapeHtml: (value) => value, flowListId: 'group-flows-g' });
  assert.match(html, /class="group-disclosure"[^>]*aria-expanded="false"[^>]*aria-controls="group-flows-g"/);
  const searching = groupHeaderMarkup({ group, search: 'match', escapeHtml: (value) => value, flowListId: 'group-flows-g' });
  assert.match(searching, /class="group-disclosure"[^>]*aria-expanded="true"/);
  assert.equal(group.collapsed, true);
  assert.match(groupHeaderMarkup({ group, escapeHtml: (value) => value, flowListId: 'group-flows-g' }), /aria-expanded="false"/);
  const toggled = toggleLibraryGroup([group], 'g');
  assert.equal(toggled[0].collapsed, false);
  assert.equal(group.collapsed, true);
});

test('group action sizing does not alter flow-card settings', () => {
  const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.group-rename, \.group-delete \{ width: 26px; height: 26px; padding: 0 !important; font-size: 15px; \}/);
  assert.match(styles, /\.flow-settings \{ border: 0; background: transparent; padding: 2px; color: var\(--subtle\); \}/);
  assert.doesNotMatch(styles, /\.flow-settings[^}]*width:\s*26px/);
});

test('runtime banner reserves space and uses accessible idle, recording, and playing states', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(html, /<div class="status-banner" id="runtimeStatus" role="status" aria-live="polite">Idle<\/div>\s*<header class="topbar">/);
  assert.match(styles, /\.status-banner \{[^}]*flex: 0 0 22px[^}]*background: var\(--subtle\)/);
  assert.match(styles, /\.status-banner\.recording \{ background: var\(--red\); color: var\(--bg\); \}/);
  assert.match(styles, /\.status-banner\.playing \{ background: var\(--green\)/);
  assert.match(app, /setStatus\('Recording', 'recording'\)/);
  assert.match(app, /setStatus\(playing \? 'Playing' : 'Idle', playing \? 'playing' : ''\)/);
  assert.equal((app.match(/setStatus\('Idle'\)/g) || []).length, 5);
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
  assert.match(html, /<td class="row-actions"><div class="row-action-group">[\s\S]*data-action="move-up"[\s\S]*data-action="move-down"[\s\S]*data-action="duplicate"[\s\S]*data-action="delete"[\s\S]*<\/div><\/td>/);
  assert.match(html, /<td class="row-actions">[\s\S]*data-action="move-up"[^>]* disabled/);
  assert.match(html, /data-action="move-down"[^>]* disabled/);
});

test('editor keeps actions in rows and constrains Name column', () => {
  const html = readFileSync(new URL('./editor.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./editor.css', import.meta.url), 'utf8');
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.match(html, /<th>Actions<\/th>/);
  assert.doesNotMatch(html, /id="moveUpBtn"|id="duplicateBtn"|id="deleteBtn"/);
  assert.match(css, /nth-child\(3\)[^}]*160px/);
  assert.match(css, /nth-child\(7\)[^}]*width: 1%[^}]*white-space: nowrap/);
  assert.match(css, /html, body \{ min-width: 720px/);
  assert.equal(config.app.windows.find(({ label }) => label === 'editor').minWidth, 720);
});

test('editor highlights only selected clicks for the click map', () => {
  const html = editorRowsHtml([{ id: 'click', type: 'click' }, { id: 'delay', type: 'delay' }], ['click', 'delay']);
  assert.match(html, /data-id="click" class="action-selected"/);
  assert.doesNotMatch(html, /data-id="delay" class="action-selected"/);
});
