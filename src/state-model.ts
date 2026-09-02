import { normalizePlayback, playbackDefaults } from "./playback-form.js";
import type {
	Action,
	AppState,
	EditorSize,
	Flow,
	LibraryGroup,
	Playback,
} from "./types.js";

type IdSource = (() => string) | string;
type LegacyPlayback = Partial<Playback> & {
	repeatMode?: string;
	repeatUnit?: string;
	untilTime?: string | null;
};
type LegacyFlow = Omit<Partial<Flow>, "playback"> & {
	actions?: Action[];
	playback?: LegacyPlayback;
};
type LegacyGroup = Partial<LibraryGroup> & {
	id?: string;
	name?: string;
	collapsed?: boolean;
};
type LegacySettings = Omit<Partial<AppState["settings"]>, "playback"> &
	LegacyPlayback & { playback?: LegacyPlayback };
type PersistedStateInput = {
	version?: number;
	editorSize?: unknown;
	selectedFlowId?: string | null;
	settings?: LegacySettings;
	groups?: LegacyGroup[];
	flows?: LegacyFlow[];
};

export { playbackDefaults };

export function normalizeEditorSize(
	size: Partial<NonNullable<EditorSize>> | null | undefined,
): EditorSize {
	if (
		typeof size?.width !== "number" ||
		typeof size?.height !== "number" ||
		!Number.isFinite(size.width) ||
		!Number.isFinite(size.height) ||
		size.width <= 0 ||
		size.height <= 0
	)
		return null;
	return { width: size.width, height: size.height };
}

export const actionClickCount = (action: Action): number =>
	action.type === "click"
		? 1
		: action.type === "group"
			? (action.actions ?? []).reduce(
					(n, child) => n + actionClickCount(child),
					0,
				) * Math.max(1, Number(action.repeatCount) || 1)
			: 0;

export const flattenActions = (actions: Action[] = []): Action[] =>
	actions.flatMap((action) =>
		action.type === "group" ? flattenActions(action.actions) : [action],
	);
export const actionById = (
	actions: Action[] = [],
	id: string,
): Action | null => {
	for (const action of actions) {
		if (action.id === id) return action;
		if (action.type === "group") {
			const found = actionById(action.actions, id);
			if (found) return found;
		}
	}
	return null;
};
export const actionDelay = (action: Action): number =>
	action.type === "group"
		? (action.actions ?? []).reduce((n, child) => n + actionDelay(child), 0) *
			Math.max(1, Number(action.repeatCount) || 1)
		: Math.max(0, Number(action.delayMs) || 0);
export const effectiveClickCount = (flow: Flow | null | undefined): number =>
	(flow?.actions ?? []).reduce((n, action) => n + actionClickCount(action), 0);

const nextId = (id: IdSource): string => (typeof id === "function" ? id() : id);

export function copyAction(
	action: Action,
	id: IdSource = () => crypto.randomUUID(),
): Action {
	const copy = structuredClone(action);
	copy.id = nextId(id);
	if (copy.type === "group")
		copy.actions = (copy.actions ?? []).map((child) => copyAction(child, id));
	return copy;
}

function normalizeActionButton(action: Action): Action {
	if (action.type === "click")
		action.button = action.button === "right" ? "right" : "left";
	if (action.type === "group")
		(action.actions ?? []).forEach(normalizeActionButton);
	return action;
}

export function copyActions(
	actions: Action[] = [],
	id: IdSource = () => crypto.randomUUID(),
): Action[] {
	return actions.map((action) => copyAction(action, id));
}

export function groupContiguous(
	actions: Action[],
	ids: string[],
	id: IdSource = () => crypto.randomUUID(),
): { index: number; group: Extract<Action, { type: "group" }> } | null {
	const selected = new Set(ids);
	const indexes = actions
		.map((action, index) => (selected.has(action.id) ? index : -1))
		.filter((index) => index >= 0);
	if (
		!indexes.length ||
		indexes.some((index, i) => i && index !== indexes[i - 1] + 1)
	)
		return null;
	const first = indexes[0];
	const last = indexes[indexes.length - 1];
	if (first === undefined || last === undefined) return null;
	const children = actions.slice(first, last + 1);
	if (children.some((action) => action.type === "group")) return null;
	return {
		index: first,
		group: {
			id: nextId(id),
			type: "group",
			name: "Group",
			repeatCount: 1,
			actions: copyActions(children, id),
		},
	};
}

export function ungroupAction(
	actions: Action[],
	groupId: string,
): { index: number; actions: Action[] } | null {
	const index = actions.findIndex(
		(action) => action.id === groupId && action.type === "group",
	);
	if (index < 0) return null;
	const group = actions[index];
	if (group?.type !== "group") return null;
	return { index, actions: copyActions(group.actions) };
}

export function reorder<T>(items: T[], from: number, to: number): T[] {
	const result = items.slice();
	if (from < 0 || to < 0 || from >= result.length || to >= result.length)
		return result;
	const [item] = result.splice(from, 1);
	result.splice(to, 0, item);
	return result;
}

export function combineFlows(
	flows: Flow[] = [],
	id: IdSource = () => crypto.randomUUID(),
): Flow | null {
	const sources = (flows ?? []).filter(Boolean);
	if (!sources.length) return null;
	return {
		id: nextId(id),
		name: `Combined — ${sources.map((flow) => flow.name).join(" + ")}`,
		actions: copyActions(
			sources.flatMap((flow) => flow.actions ?? []),
			id,
		),
		groupId: sources[0].groupId ?? null,
	};
}

export function migrateState(input: PersistedStateInput = {}): AppState {
	const state: PersistedStateInput = structuredClone(input ?? {});
	const sourceSettings: LegacySettings = input?.settings ?? {};
	const {
		recordHotkey: _recordHotkey,
		playbackHotkey: _playbackHotkey,
		playback: _playback,
		...v2Playback
	} = sourceSettings;
	const sourceFlows: LegacyFlow[] = Array.isArray(input?.flows)
		? input.flows
		: [];
	const selectedFlow = sourceFlows.find(
		(flow) => flow.id === input?.selectedFlowId,
	);
	const legacyPlayback: LegacyPlayback =
		input?.version !== undefined && input.version >= 3
			? (sourceSettings.playback ??
				selectedFlow?.playback ??
				sourceFlows[0]?.playback ??
				{})
			: v2Playback;
	const flows: LegacyFlow[] = Array.isArray(state.flows) ? state.flows : [];
	const groups: LegacyGroup[] = Array.isArray(state.groups) ? state.groups : [];
	const migratedFlows: Flow[] = flows.map((flow) => {
		const {
			playback: _flowPlayback,
			target: _target,
			...rest
		} = flow as LegacyFlow & { target?: unknown };
		return {
			...rest,
			id: flow.id ?? crypto.randomUUID(),
			name: flow.name ?? "Flow",
			groupId: flow.groupId ?? null,
			actions: (Array.isArray(flow.actions) ? flow.actions : []).map(
				normalizeActionButton,
			),
		};
	});
	const migrated: AppState = {
		version: 4,
		editorSize: normalizeEditorSize(
			state.editorSize as Partial<NonNullable<EditorSize>> | null | undefined,
		),
		groups: groups.map((group) => ({
			id: group.id ?? crypto.randomUUID(),
			name: group.name ?? "Group",
			collapsed: group.collapsed === true,
		})),
		settings: {
			recordHotkey: state.settings?.recordHotkey ?? "Alt+Shift+R",
			playbackHotkey: state.settings?.playbackHotkey ?? "Alt+Shift+P",
			playback: normalizePlayback(legacyPlayback),
		},
		flows: migratedFlows,
		selectedFlowId: migratedFlows.some(
			(flow) => flow.id === state.selectedFlowId,
		)
			? (state.selectedFlowId ?? null)
			: (migratedFlows[0]?.id ?? null),
	};
	return migrated;
}

export function moveItem<T extends { id: string }>(
	items: T[],
	id: string,
	beforeId: string | null,
): T[] {
	const from = items.findIndex((item) => item.id === id);
	if (from < 0 || id === beforeId) return items;
	const copy = [...items];
	const [item] = copy.splice(from, 1);
	const to =
		beforeId == null
			? copy.length
			: copy.findIndex((candidate) => candidate.id === beforeId);
	copy.splice(to < 0 ? copy.length : to, 0, item);
	return copy;
}

export function nextDeadline(
	time: string | null | undefined,
	now: Date = new Date(),
): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
	if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
	const deadline = new Date(now);
	deadline.setHours(Number(match[1]), Number(match[2]), 0, 0);
	if (deadline <= now) deadline.setDate(deadline.getDate() + 1);
	return deadline.getTime();
}
