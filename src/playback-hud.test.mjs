import assert from 'node:assert/strict';
import test from 'node:test';
import { setActivityBadge, setPlaybackHud } from './playback-hud.mjs';

function body() {
  const classes = new Set();
  return { classes, classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name), remove: (name) => classes.delete(name) } };
}

test('enters and exits HUD mode after native success', async () => {
  const calls = [];
  const target = body();
  await setPlaybackHud(async (command, args) => calls.push([command, args]), target, true);
  assert.equal(target.classes.has('hud-mode'), true);
  await setPlaybackHud(async (command, args) => calls.push([command, args]), target, false);
  assert.equal(target.classes.has('hud-mode'), false);
  assert.deepEqual(calls, [['set_playback_hud', { active: true }], ['set_playback_hud', { active: false }]]);
});

test('failed HUD entry rolls back normal UI', async () => {
  const target = body();
  target.classes.add('hud-mode');
  assert.equal(await setPlaybackHud(async () => { throw new Error('no HUD'); }, target, true), false);
  assert.equal(target.classes.has('hud-mode'), false);
});

test('recording badge does not enter HUD mode and badge failures are nonfatal', async () => {
  const calls = [];
  await setActivityBadge(async (command, args) => calls.push([command, args]), 'recording');
  await setActivityBadge(async () => { throw new Error('no badge'); }, 'idle');
  assert.deepEqual(calls, [['set_activity_badge', { activity: 'recording' }]]);
});
