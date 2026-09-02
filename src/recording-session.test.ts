import { expect, test } from "vitest";
import {
	acceptsRecordedClick,
	activateRecording,
	beginRecordingAttempt,
	cancelRecordingSession,
	idleRecordingSession,
	isCurrentRecordingAttempt,
	stopRecordingSession,
} from "./recording-session.js";

test("recording attempts invalidate startup work and accept clicks only when active", () => {
	const attempt = beginRecordingAttempt(idleRecordingSession(), "flow");
	const token = attempt.token;
	const cancelled = cancelRecordingSession(attempt);

	expect(isCurrentRecordingAttempt(cancelled.state, token)).toBe(false);
	expect(cancelled.changed).toBe(true);
	expect(acceptsRecordedClick(cancelled.state)).toBe(false);
	const active = activateRecording(attempt);
	expect(acceptsRecordedClick(active)).toBe(true);
	const stopped = stopRecordingSession(active);
	expect(stopped.active).toBe(false);
	expect(stopped.snapshot).toBeNull();
});

test("cancellation is idempotent after the first transition", () => {
	const attempt = beginRecordingAttempt(idleRecordingSession(), null);
	const cancelled = cancelRecordingSession(attempt);
	const repeated = cancelRecordingSession(cancelled.state);

	expect(repeated.changed).toBe(false);
	expect(repeated.state).toEqual(cancelled.state);
});
