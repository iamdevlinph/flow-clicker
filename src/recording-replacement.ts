import type { Action, Flow } from "./types.js";

export type RecordingSelection = {
	selectedActionId: string | null;
	selectedActionIds: string[];
};

export type RecordingSnapshot = RecordingSelection & {
	actions: Action[];
	target?: Flow["target"];
	updatedAt?: string;
};

export function beginRecordingReplacement(
	flow: Flow,
	selection: RecordingSelection,
): RecordingSnapshot {
	const snapshot: RecordingSnapshot = {
		actions: structuredClone(flow.actions),
		updatedAt: flow.updatedAt,
		target: structuredClone(flow.target),
		...selection,
	};
	flow.actions = [];
	flow.target = null;
	return snapshot;
}

export function restoreRecordingReplacement(
	flow: Flow,
	snapshot: RecordingSnapshot,
): RecordingSelection {
	flow.actions = snapshot.actions;
	flow.updatedAt = snapshot.updatedAt;
	flow.target = structuredClone(snapshot.target);
	return {
		selectedActionId: snapshot.selectedActionId,
		selectedActionIds: [...snapshot.selectedActionIds],
	};
}
