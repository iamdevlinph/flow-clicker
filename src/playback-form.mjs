export const playbackDefaults = Object.freeze({ playbackSpeed: 1, repeatMode: 'cycles', repeatValue: 1, repeatUnit: 'seconds', settleMs: 12, holdMs: 30, restoreCursor: false, focusTargetWindow: true, untilTime: null });

export const playbackFromForm = (get) => ({
  playbackSpeed: Math.max(.05, Number(get('playbackSpeed').value) || 1), repeatMode: get('repeatMode').value,
  repeatValue: Math.max(1, Number(get('repeatValue').value) || 1), repeatUnit: get('repeatUnit').value,
  settleMs: Math.max(0, Number(get('settleMs').value) || 0), holdMs: Math.max(0, Number(get('holdMs').value) || 0),
  restoreCursor: get('restoreCursor').checked, focusTargetWindow: get('focusTarget').checked, untilTime: get('untilTime').value || null,
});

export function playbackToForm(playback, get) {
  const value = { ...playbackDefaults, ...playback };
  for (const id of ['playbackSpeed', 'repeatMode', 'repeatValue', 'repeatUnit', 'settleMs', 'holdMs', 'untilTime']) get(id).value = value[id] ?? '';
  get('restoreCursor').checked = !!value.restoreCursor;
  get('focusTarget').checked = !!value.focusTargetWindow;
  return value;
}
