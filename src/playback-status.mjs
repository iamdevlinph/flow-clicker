export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatLocalTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = match[2];
  return `${hours % 12 || 12}:${minutes}${hours < 12 ? 'am' : 'pm'}`;
}

export function remainingSeconds(totalSeconds, startedAt, now = Date.now()) {
  return Math.max(0, Math.ceil(Number(totalSeconds) - (now - startedAt) / 1000));
}

export function durationRemainder(active, playback, now = Date.now()) {
  if (playback.repeatMode !== 'duration' || playback.repeatValue !== active.configuredDuration) return null;
  return {
    flowId: active.flowId,
    duration: active.configuredDuration,
    remaining: remainingSeconds(active.durationSeconds, active.startedAt, now),
  };
}

export function durationToRun(resume, flowId, duration, mode) {
  return mode === 'duration' && resume?.flowId === flowId && resume.duration === duration
    ? resume.remaining
    : duration;
}

export function durationResumeAfterEnd(resume, stopRequested, errored = false) {
  return stopRequested && !errored ? resume : null;
}

export function playbackStatus({ mode, execution = 1, repeatValue = 1, remaining = 0, untilTime = null }) {
  const suffix = mode === 'cycles'
    ? `(${execution}/${Math.max(1, Number(repeatValue) || 1)})`
    : mode === 'duration'
      ? `(${formatClock(remaining)} left)`
      : untilTime
        ? `(until ${formatLocalTime(untilTime)})`
        : `(${execution})`;
  return `Playing ${suffix}`;
}
