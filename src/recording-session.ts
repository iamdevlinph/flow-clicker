import type { RecordingSnapshot } from "./recording-replacement.js";

export type RecordingSessionState = {
	active: boolean;
	starting: boolean;
	token: number;
	flowId: string | null;
	snapshot: RecordingSnapshot | null;
};

export const idleRecordingSession = (): RecordingSessionState => ({
	active: false,
	starting: false,
	token: 0,
	flowId: null,
	snapshot: null,
});

export const beginRecordingAttempt = (
	state: RecordingSessionState,
	flowId: string | null,
): RecordingSessionState => ({
	active: false,
	starting: true,
	token: state.token + 1,
	flowId,
	snapshot: null,
});

export const isCurrentRecordingAttempt = (
	state: RecordingSessionState,
	token: number,
): boolean => state.token === token;

export const retainRecordingSnapshot = (
	state: RecordingSessionState,
	snapshot: RecordingSnapshot,
): RecordingSessionState => ({ ...state, snapshot });

export const activateRecording = (
	state: RecordingSessionState,
): RecordingSessionState => ({ ...state, active: true, starting: false });

export const acceptsRecordedClick = (state: RecordingSessionState): boolean =>
	state.active && !!state.flowId;

export const stopRecordingSession = (
	state: RecordingSessionState,
): RecordingSessionState => ({
	...idleRecordingSession(),
	token: state.token + 1,
});

export function cancelRecordingSession(state: RecordingSessionState): {
	state: RecordingSessionState;
	changed: boolean;
} {
	if (!state.active && !state.starting && !state.snapshot)
		return { state, changed: false };
	return {
		state: { ...idleRecordingSession(), token: state.token + 1 },
		changed: true,
	};
}
