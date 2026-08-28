import type { AppState } from "./types.js";

export function normalizeFlowSelection(state: AppState): AppState {
	const flows = Array.isArray(state?.flows) ? state.flows : [];
	return {
		...state,
		flows,
		selectedFlowId: flows.some((flow) => flow.id === state.selectedFlowId)
			? state.selectedFlowId
			: (flows[0]?.id ?? null),
	};
}

export function removeFlow(state: AppState, flowId: string): AppState {
	const flows = (state.flows || []).filter((flow) => flow.id !== flowId);
	const selected =
		state.selectedFlowId === flowId
			? (flows[0]?.id ?? null)
			: state.selectedFlowId;
	return {
		...state,
		flows,
		selectedFlowId: flows.some((flow) => flow.id === selected)
			? selected
			: (flows[0]?.id ?? null),
	};
}
