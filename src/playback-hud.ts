import type { NativeInvoke } from "./types.js";

export async function setActivityBadge(
	invoke: NativeInvoke | undefined,
	activity: string,
): Promise<void> {
	if (invoke) await invoke("set_activity_badge", { activity }).catch(() => {});
}

export async function setPlaybackHud(
	invoke: NativeInvoke | undefined,
	body: HTMLElement,
	active: boolean,
): Promise<boolean> {
	if (!invoke) return false;
	try {
		await invoke("set_playback_hud", { active });
		body.classList.toggle("hud-mode", active);
		return true;
	} catch (_) {
		body.classList.remove("hud-mode");
		return false;
	}
}
