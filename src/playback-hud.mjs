export async function setActivityBadge(invoke, activity) {
  if (invoke) await invoke('set_activity_badge', { activity }).catch(() => {});
}

export async function setPlaybackHud(invoke, body, active) {
  if (!invoke) return false;
  try {
    await invoke('set_playback_hud', { active });
    body.classList.toggle('hud-mode', active);
    return true;
  } catch (_) {
    body.classList.remove('hud-mode');
    return false;
  }
}
