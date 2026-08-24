import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDurationInput, formatDuration, MAX_DURATION_SECONDS, parseDuration } from './duration-input.mjs';

class Input {
  constructor(value = '') { this.value = value; this.selectionStart = 0; this.listeners = {}; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  fire(type, event = {}) { let prevented = false; this.listeners[type]?.({ preventDefault: () => { prevented = true; }, ...event }); return prevented; }
}

test('formats and parses duration bounds and paste forms', () => {
  assert.equal(formatDuration(), '00:00:01');
  assert.equal(formatDuration(MAX_DURATION_SECONDS + 1), '99:59:59');
  assert.equal(parseDuration('01:02:03'), 3723);
  assert.equal(parseDuration('010203'), 3723);
  for (const value of ['00:00:00', '00:60:00', '1:02:03', 'abcdef']) assert.equal(parseDuration(value), null);
});

test('edits, navigates, clears, and pastes duration segments', () => {
  const input = new Input('00:00:01'), commits = [];
  bindDurationInput(input, (seconds) => commits.push(seconds));
  input.fire('focus');
  input.fire('keydown', { key: '1' }); input.fire('keydown', { key: '2' });
  assert.equal(input.value, '12:00:01'); assert.equal(input.selectionStart, 3);
  assert.equal(input.fire('keydown', { key: '6' }), true); assert.equal(input.value, '12:00:01');
  input.fire('keydown', { key: '5' }); input.fire('keydown', { key: '9' });
  assert.equal(input.value, '12:59:01'); assert.equal(input.selectionStart, 6);
  input.fire('keydown', { key: 'ArrowLeft' }); assert.equal(input.selectionStart, 3);
  input.fire('keydown', { key: 'Delete' }); assert.equal(input.value, '12:00:01');
  input.fire('paste', { clipboardData: { getData: () => '235959' } }); assert.equal(input.value, '23:59:59');
  assert.equal(input.fire('paste', { clipboardData: { getData: () => '24:99:00' } }), true); assert.equal(input.value, '23:59:59');
  assert.deepEqual(commits, [43201, 46741, 43201, 86399]);
});

test('refreshes rollback value after another flow is loaded', () => {
  const input = new Input('00:00:01');
  bindDurationInput(input);
  input.value = '02:00:00'; input.selectionStart = 6; input.fire('focus');
  input.fire('keydown', { key: 'Delete' });
  assert.equal(input.value, '02:00:00');
});
