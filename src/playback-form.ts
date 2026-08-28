import {
	formatDuration,
	MAX_DURATION_SECONDS,
	parseDuration,
} from "./duration-input.js";
import type { Playback, PlaybackMode } from "./types.js";

type PlaybackInput = {
	playbackSpeed?: number;
	repeatMode?: string;
	repeatValue?: number;
	repeatUnit?: string;
	settleMs?: number;
	holdMs?: number;
	restoreCursor?: boolean;
	focusTargetWindow?: boolean;
	untilTime?: string | null;
};
type FormField = { value: string; checked?: boolean };
type FormGetter = (id: string) => FormField;
type FormPlayback = Omit<Playback, "repeatMode"> & {
	repeatMode: PlaybackMode | "until";
};

export const playbackDefaults: Playback = Object.freeze({
	playbackSpeed: 1,
	repeatMode: "cycles",
	repeatValue: 1,
	repeatUnit: "seconds",
	settleMs: 12,
	holdMs: 30,
	restoreCursor: false,
	focusTargetWindow: true,
	untilTime: null,
});

const integer = (value: unknown, min = 0, max = Infinity): number =>
	Math.min(max, Math.max(min, Math.trunc(Number(value) || 0)));

export function timerToSeconds(
	hours: number,
	minutes: number,
	seconds: number,
): number {
	return Math.min(
		MAX_DURATION_SECONDS,
		Math.max(
			1,
			integer(hours) * 3600 +
				integer(minutes, 0, 59) * 60 +
				integer(seconds, 0, 59),
		),
	);
}

export function secondsToTimer(seconds: number): {
	hours: number;
	minutes: number;
	seconds: number;
} {
	const total = Math.min(MAX_DURATION_SECONDS, Math.max(1, integer(seconds)));
	return {
		hours: Math.floor(total / 3600),
		minutes: Math.floor((total % 3600) / 60),
		seconds: total % 60,
	};
}

export function normalizePlayback(playback: PlaybackInput = {}): Playback {
	const value: PlaybackInput = { ...playbackDefaults, ...playback };
	const sourceMode = value.repeatMode ?? playbackDefaults.repeatMode;
	const repeatMode: string = sourceMode === "clicks" ? "cycles" : sourceMode;
	let repeatValue = Math.max(1, Number(value.repeatValue) || 1);
	if (repeatMode === "duration") {
		repeatValue =
			value.repeatUnit === "hours"
				? repeatValue * 3600
				: value.repeatUnit === "minutes"
					? repeatValue * 60
					: repeatValue;
		repeatValue = Math.min(
			MAX_DURATION_SECONDS,
			Math.max(1, Math.trunc(repeatValue)),
		);
	} else if (repeatMode === "cycles")
		repeatValue = Math.max(1, Math.trunc(repeatValue));
	else repeatValue = 1;
	const untilTime = value.untilTime || null;
	const normalizedMode: PlaybackMode =
		repeatMode === "duration" || repeatMode === "cycles"
			? repeatMode
			: "continuous";
	return {
		playbackSpeed: Math.max(
			1,
			Number(value.playbackSpeed) || playbackDefaults.playbackSpeed,
		),
		repeatMode:
			normalizedMode === "continuous" || untilTime
				? "continuous"
				: normalizedMode,
		repeatValue,
		repeatUnit: "seconds",
		settleMs: Number(value.settleMs) || 0,
		holdMs: Number(value.holdMs) || 0,
		restoreCursor: value.restoreCursor === true,
		focusTargetWindow: value.focusTargetWindow !== false,
		untilTime,
	};
}

export const playbackFromForm = (get: FormGetter): Playback => {
	const mode: string = get("repeatMode").value;
	const timer =
		mode === "duration" ? (parseDuration(get("repeatDuration").value) ?? 1) : 1;
	const repeatMode: PlaybackMode =
		mode === "until"
			? "continuous"
			: mode === "duration" || mode === "cycles"
				? mode
				: "continuous";
	return {
		playbackSpeed: Math.max(1, Number(get("playbackSpeed").value) || 1),
		repeatMode,
		repeatValue:
			mode === "cycles"
				? Math.max(1, Math.trunc(Number(get("repeatValue").value) || 1))
				: mode === "duration"
					? timer
					: 1,
		repeatUnit: "seconds",
		settleMs: Math.max(0, Number(get("settleMs").value) || 0),
		holdMs: Math.max(0, Number(get("holdMs").value) || 0),
		restoreCursor: get("restoreCursor").checked === true,
		focusTargetWindow: get("focusTarget").checked !== false,
		untilTime: mode === "until" ? get("untilTime").value || null : null,
	};
};

export function playbackToForm(
	playback: PlaybackInput,
	get: FormGetter,
): FormPlayback {
	const value = normalizePlayback(playback);
	const mode: PlaybackMode | "until" =
		value.repeatMode === "continuous" && value.untilTime
			? "until"
			: value.repeatMode;
	get("playbackSpeed").value = String(value.playbackSpeed);
	get("settleMs").value = String(value.settleMs);
	get("holdMs").value = String(value.holdMs);
	get("untilTime").value = value.untilTime ?? "";
	get("repeatMode").value = mode;
	get("repeatValue").value = mode === "cycles" ? String(value.repeatValue) : "";
	get("repeatDuration").value =
		mode === "duration" ? formatDuration(value.repeatValue) : "";
	get("restoreCursor").checked = value.restoreCursor;
	get("focusTarget").checked = value.focusTargetWindow;
	return { ...value, repeatMode: mode };
}
