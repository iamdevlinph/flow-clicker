import type { Playback } from "./types.js";

export function formatClock(seconds: number): string {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	const remainder = total % 60;
	return hours
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
		: `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatLocalTime(value: string | null | undefined): string {
	const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
	if (!match) return "";
	const hours = Number(match[1]);
	const minutes = match[2];
	return `${hours % 12 || 12}:${minutes}${hours < 12 ? "am" : "pm"}`;
}

export function remainingSeconds(
	totalSeconds: number,
	startedAt: number,
	now: number = Date.now(),
): number {
	return Math.max(
		0,
		Math.ceil(Number(totalSeconds) - (now - startedAt) / 1000),
	);
}

export function durationRemainder(
	active: {
		playback?: Playback;
		configuredDuration: number;
		durationSeconds: number;
		startedAt: number;
	},
	playback: Playback,
	now: number = Date.now(),
): number | null {
	if (
		active.playback?.repeatMode !== "duration" ||
		playback.repeatMode !== "duration" ||
		playback.repeatValue !== active.configuredDuration
	)
		return null;
	return Math.max(
		1,
		remainingSeconds(active.durationSeconds, active.startedAt, now),
	);
}

export function playbackStatus({
	mode,
	execution = 1,
	repeatValue = 1,
	remaining = 0,
	untilTime = null,
}: {
	mode: string;
	execution?: number;
	repeatValue?: number;
	remaining?: number;
	untilTime?: string | null;
}): string {
	const suffix =
		mode === "cycles"
			? `(${execution}/${Math.max(1, Number(repeatValue) || 1)})`
			: mode === "duration"
				? `(${formatClock(remaining)} left)`
				: untilTime
					? `(until ${formatLocalTime(untilTime)})`
					: `(${execution})`;
	return `Playing ${suffix}`;
}
