import { formatDuration, MAX_DURATION_SECONDS, parseDuration } from './duration-input.mjs';

export const playbackDefaults = Object.freeze({ playbackSpeed: 1, repeatMode: 'cycles', repeatValue: 1, repeatUnit: 'seconds', settleMs: 12, holdMs: 30, restoreCursor: false, focusTargetWindow: true, untilTime: null });

const integer = (value, min = 0, max = Infinity) => Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));

export function timerToSeconds(hours, minutes, seconds) {
  return Math.min(MAX_DURATION_SECONDS, Math.max(1, integer(hours) * 3600 + integer(minutes, 0, 59) * 60 + integer(seconds, 0, 59)));
}

export function secondsToTimer(seconds) {
  const total = Math.min(MAX_DURATION_SECONDS, Math.max(1, integer(seconds)));
  return { hours: Math.floor(total / 3600), minutes: Math.floor(total % 3600 / 60), seconds: total % 60 };
}

export function normalizePlayback(playback = {}) {
  const value = { ...playbackDefaults, ...playback };
  const repeatMode = value.repeatMode === 'clicks' ? 'cycles' : value.repeatMode;
  let repeatValue = Math.max(1, Number(value.repeatValue) || 1);
  if (repeatMode === 'duration') {
    repeatValue = value.repeatUnit === 'hours' ? repeatValue * 3600 : value.repeatUnit === 'minutes' ? repeatValue * 60 : repeatValue;
    repeatValue = Math.min(MAX_DURATION_SECONDS, Math.max(1, Math.trunc(repeatValue)));
  } else if (repeatMode === 'cycles') repeatValue = Math.max(1, Math.trunc(repeatValue));
  else repeatValue = 1;
  const untilTime = value.untilTime || null;
  return { ...value, repeatMode: repeatMode === 'until' || untilTime ? 'continuous' : repeatMode, repeatValue, repeatUnit: 'seconds', untilTime };
}

export const playbackFromForm = (get) => {
  const mode = get('repeatMode').value;
  const timer = mode === 'duration' ? parseDuration(get('repeatDuration').value) ?? 1 : 1;
  return {
    playbackSpeed: Math.max(.05, Number(get('playbackSpeed').value) || 1), repeatMode: mode === 'until' ? 'continuous' : mode,
    repeatValue: mode === 'cycles' ? Math.max(1, Math.trunc(Number(get('repeatValue').value) || 1)) : mode === 'duration' ? timer : 1,
    repeatUnit: 'seconds', settleMs: Math.max(0, Number(get('settleMs').value) || 0), holdMs: Math.max(0, Number(get('holdMs').value) || 0),
    restoreCursor: get('restoreCursor').checked, focusTargetWindow: get('focusTarget').checked, untilTime: mode === 'until' ? get('untilTime').value || null : null,
  };
};

export function playbackToForm(playback, get) {
  const value = normalizePlayback(playback);
  const mode = value.repeatMode === 'continuous' && value.untilTime ? 'until' : value.repeatMode;
  for (const id of ['playbackSpeed', 'settleMs', 'holdMs', 'untilTime']) get(id).value = value[id] ?? '';
  get('repeatMode').value = mode;
  get('repeatValue').value = mode === 'cycles' ? value.repeatValue : '';
  get('repeatDuration').value = mode === 'duration' ? formatDuration(value.repeatValue) : '';
  get('restoreCursor').checked = !!value.restoreCursor;
  get('focusTarget').checked = !!value.focusTargetWindow;
  return { ...value, repeatMode: mode };
}
