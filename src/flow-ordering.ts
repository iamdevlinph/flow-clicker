import { moveItem } from "./state-model.js";
import type { Flow } from "./types.js";

export function moveFlow(
	flows: Flow[],
	id: string,
	beforeId: string | null,
	groupId: string | null,
): Flow[] {
	if (!flows.some((flow) => flow.id === id) || id === beforeId) return flows;
	return moveItem(flows, id, beforeId).map((flow) =>
		flow.id === id ? { ...flow, groupId: groupId ?? null } : flow,
	);
}

export function moveFlowByKey(
	flows: Flow[],
	id: string,
	delta: number,
): Flow[] {
	const flow = flows.find((candidate) => candidate.id === id);
	if (!flow) return flows;
	const peers = flows.filter(
		(candidate) => (candidate.groupId ?? null) === (flow.groupId ?? null),
	);
	const index = peers.indexOf(flow);
	const target = peers[index + delta];
	if (!target) return flows;
	return delta < 0
		? moveFlow(flows, id, target.id, flow.groupId)
		: moveFlow(flows, target.id, flow.id, flow.groupId);
}
