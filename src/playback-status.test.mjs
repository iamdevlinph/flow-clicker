import assert from 'node:assert/strict';
import test from 'node:test';
import { durationRemainder, durationResumeAfterEnd, durationToRun, formatLocalTime, playbackStatus, remainingSeconds } from './playback-status.mjs';

test('formats playback status for every mode', () => {
  assert.equal(playbackStatus({ mode: 'continuous', execution: 1 }), 'Playing (1)');
  assert.equal(playbackStatus({ mode: 'cycles', execution: 1, repeatValue: 100 }), 'Playing (1/100)');
  assert.equal(playbackStatus({ mode: 'duration', remaining: 8520 }), 'Playing (2:22:00 left)');
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

test('duration stop resumes only the same flow and duration', () => {
  const active = { flowId: 'flow', configuredDuration: 10, durationSeconds: 10, startedAt: 1000 };
  const playback = { repeatMode: 'duration', repeatValue: 10 };
  const resume = durationRemainder(active, playback, 2001);
  assert.deepEqual(resume, { flowId: 'flow', duration: 10, remaining: 9 });
  assert.equal(durationToRun(resume, 'flow', 10, 'duration'), 9);
  assert.deepEqual(durationRemainder({ ...active, durationSeconds: 9, startedAt: 3000 }, playback, 5001), { flowId: 'flow', duration: 10, remaining: 7 });
  assert.equal(durationRemainder(active, { ...playback, repeatValue: 11 }, 2001), null);
  assert.equal(durationRemainder(active, { ...playback, repeatMode: 'cycles' }, 2001), null);
  assert.equal(durationToRun(resume, 'other', 10, 'duration'), 10);
  assert.equal(durationToRun(resume, 'flow', 11, 'duration'), 11);
  assert.equal(durationToRun(resume, 'flow', 10, 'cycles'), 10);
  assert.equal(durationToRun(null, 'flow', 10, 'duration'), 10);
});

test('duration resume survives Stop but clears after completion or error', () => {
  const resume = { flowId: 'flow', duration: 10, remaining: 7 };
  assert.equal(durationResumeAfterEnd(resume, true), resume);
  assert.equal(durationResumeAfterEnd(resume, false), null);
  assert.equal(durationResumeAfterEnd(resume, true, true), null);
});
