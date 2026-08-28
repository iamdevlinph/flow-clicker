import type { Flow } from "./types.js";

export const selectedFlows = (ids: string[], flows: Flow[]): Flow[] =>
	ids
		.map((id) => flows.find((flow) => flow.id === id))
		.filter((flow): flow is Flow => flow !== undefined);

export const toggleSelection = (
	ids: string[],
	id: string,
	checked: boolean,
): string[] =>
	checked
		? [...ids.filter((value) => value !== id), id]
		: ids.filter((value) => value !== id);

export const selectionName = (flows: Flow[]): string =>
	flows.length
		? `Combined — ${flows.map((flow) => flow.name).join(" + ")}`.slice(0, 120)
		: "Combined flow";
