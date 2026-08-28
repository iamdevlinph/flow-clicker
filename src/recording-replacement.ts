import type { Action, Flow } from "./types.js";

export type RecordingSelection = {
	selectedActionId: string | null;
	selectedActionIds: string[];
};

export type RecordingSnapshot = RecordingSelection & {
	actions: Action[];
	updatedAt?: string;
};

export function beginRecordingReplacement(
	flow: Flow,
	selection: RecordingSelection,
): RecordingSnapshot {
	const snapshot: RecordingSnapshot = {
		actions: structuredClone(flow.actions),
		updatedAt: flow.updatedAt,
		...selection,
	};
	flow.actions = [];
	return snapshot;
}

export function restoreRecordingReplacement(
	flow: Flow,
	snapshot: RecordingSnapshot,
): RecordingSelection {
	flow.actions = snapshot.actions;
	flow.updatedAt = snapshot.updatedAt;
	return {
		selectedActionId: snapshot.selectedActionId,
		selectedActionIds: [...snapshot.selectedActionIds],
	};
}
