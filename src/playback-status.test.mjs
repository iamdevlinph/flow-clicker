import assert from 'node:assert/strict';
import test from 'node:test';
import { durationRemainder, formatLocalTime, playbackStatus, remainingSeconds } from './playback-status.mjs';

test('formats playback status for every mode', () => {
  assert.equal(playbackStatus({ mode: 'continuous', execution: 1 }), 'Playing (1)');
  assert.equal(playbackStatus({ mode: 'cycles', execution: 1, repeatValue: 100 }), 'Playing (1/100)');
  assert.equal(playbackStatus({ mode: 'duration', remaining: 8520 }), 'Playing (2:22:00 left)');
  assert.equal(playbackStatus({ mode: 'duration', remaining: 65 }), 'Playing (1:05 left)');
  assert.equal(playbackStatus({ mode: 'continuous', untilTime: '14:00' }), 'Playing (until 2:00pm)');
});

test('advances executions and rounds remaining duration up', () => {
  assert.equal(playbackStatus({ mode: 'cycles', execution: 3, repeatValue: 5 }), 'Playing (3/5)');
  assert.equal(remainingSeconds(10, 1000, 1999), 10);
  assert.equal(remainingSeconds(10, 1000, 2001), 9);
  assert.equal(remainingSeconds(10, 1000, 12001), 0);
});

test('formats midnight and noon in 12-hour time', () => {
  assert.equal(formatLocalTime('00:00'), '12:00am');
  assert.equal(formatLocalTime('12:00'), '12:00pm');
  assert.equal(formatLocalTime('23:05'), '11:05pm');
});

test('duration stop returns the rounded-up remainder only for unchanged duration settings', () => {
  const active = { flowId: 'flow', playback: { repeatMode: 'duration' }, configuredDuration: 10, durationSeconds: 10, startedAt: 1000 };
  const playback = { repeatMode: 'duration', repeatValue: 10 };
  const resume = durationRemainder(active, playback, 2001);
  assert.equal(resume, 9);
  assert.equal(durationRemainder({ ...active, durationSeconds: 9, startedAt: 3000 }, playback, 5001), 7);
  assert.equal(durationRemainder(active, { ...playback, repeatValue: 11 }, 2001), null);
  assert.equal(durationRemainder(active, { ...playback, repeatMode: 'cycles' }, 2001), null);
  assert.equal(durationRemainder(active, { ...playback, repeatValue: 9 }, 2001), null);
  assert.equal(durationRemainder({ ...active, playback: { repeatMode: 'cycles' } }, playback, 2001), null);
});

test('duration stop clamps the saved remainder to one second', () => {
  const active = { playback: { repeatMode: 'duration' }, configuredDuration: 10, durationSeconds: 10, startedAt: 1000 };
  assert.equal(durationRemainder(active, { repeatMode: 'duration', repeatValue: 10 }, 12000), 1);
});
