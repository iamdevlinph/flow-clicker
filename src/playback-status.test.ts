import { expect, test } from "vitest";
import {
	durationRemainder,
	formatLocalTime,
	playbackStatus,
	remainingSeconds,
} from "./playback-status.js";
import type { Playback } from "./types.js";

test("formats playback status for every mode", () => {
	expect(playbackStatus({ mode: "continuous", execution: 1 })).toBe(
		"Playing (1)",
	);
	expect(
		playbackStatus({ mode: "cycles", execution: 1, repeatValue: 100 }),
	).toBe("Playing (1/100)");
	expect(playbackStatus({ mode: "duration", remaining: 8520 })).toBe(
		"Playing (2:22:00 left)",
	);
	expect(playbackStatus({ mode: "duration", remaining: 65 })).toBe(
		"Playing (1:05 left)",
	);
	expect(playbackStatus({ mode: "continuous", untilTime: "14:00" })).toBe(
		"Playing (until 2:00pm)",
	);
});

test("advances executions and rounds remaining duration up", () => {
	expect(playbackStatus({ mode: "cycles", execution: 3, repeatValue: 5 })).toBe(
		"Playing (3/5)",
	);
	expect(remainingSeconds(10, 1000, 1999)).toBe(10);
	expect(remainingSeconds(10, 1000, 2001)).toBe(9);
	expect(remainingSeconds(10, 1000, 12001)).toBe(0);
});

test("formats midnight and noon in 12-hour time", () => {
	expect(formatLocalTime("00:00")).toBe("12:00am");
	expect(formatLocalTime("12:00")).toBe("12:00pm");
	expect(formatLocalTime("23:05")).toBe("11:05pm");
});

test("duration stop returns the rounded-up remainder only for unchanged duration settings", () => {
	const playback: Playback = {
		playbackSpeed: 1,
		repeatMode: "duration",
		repeatValue: 10,
		repeatUnit: "seconds",
		settleMs: 0,
		holdMs: 0,
		restoreCursor: false,
		focusTargetWindow: true,
		untilTime: null,
	};
	const active = {
		playback,
		configuredDuration: 10,
		durationSeconds: 10,
		startedAt: 1000,
	};
	const resume = durationRemainder(active, playback, 2001);
	expect(resume).toBe(9);
	expect(
		durationRemainder(
			{ ...active, durationSeconds: 9, startedAt: 3000 },
			playback,
			5001,
		),
	).toBe(7);
	expect(
		durationRemainder(active, { ...playback, repeatValue: 11 }, 2001),
	).toBeNull();
	expect(
		durationRemainder(active, { ...playback, repeatMode: "cycles" }, 2001),
	).toBeNull();
	expect(
		durationRemainder(active, { ...playback, repeatValue: 9 }, 2001),
	).toBeNull();
	expect(
		durationRemainder(
			{ ...active, playback: { ...playback, repeatMode: "cycles" } },
			playback,
			2001,
		),
	).toBeNull();
});

test("duration stop clamps the saved remainder to one second", () => {
	const playback: Playback = {
		playbackSpeed: 1,
		repeatMode: "duration",
		repeatValue: 10,
		repeatUnit: "seconds",
		settleMs: 0,
		holdMs: 0,
		restoreCursor: false,
		focusTargetWindow: true,
		untilTime: null,
	};
	const active = {
		playback,
		configuredDuration: 10,
		durationSeconds: 10,
		startedAt: 1000,
	};
	expect(durationRemainder(active, playback, 12000)).toBe(1);
});
