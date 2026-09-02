import { expect, test } from "vitest";
import { normalizeFlowSelection, removeFlow } from "./flow-lifecycle.js";
import { hotkeysOverlap, normalizeHotkeyEvent } from "./hotkey.js";
import {
	actionClickCount,
	combineFlows,
	copyAction,
	groupContiguous,
	migrateState,
	moveItem,
	nextDeadline,
	normalizeEditorSize,
	sameRecordedWindow,
	sameWindowTarget,
	ungroupAction,
} from "./state-model.js";
import type { Action, AppState, ClickAction, Flow } from "./types.js";

type PersistedInput = NonNullable<Parameters<typeof migrateState>[0]>;

test("migrates v2 playback to shared settings and strips flow playback", () => {
	const source: PersistedInput = {
		version: 2,
		groups: [
			{ id: "legacy", name: "Legacy" },
			{ id: "closed", name: "Closed", collapsed: true },
		],
		flows: [
			{
				id: "f",
				playback: { playbackSpeed: 9 },
				actions: [{ id: "a", type: "click" }],
			},
		],
		settings: { repeatMode: "clicks", repeatValue: 4, recordHotkey: "R" },
	} as unknown as PersistedInput;
	const migrated = migrateState(source);
	expect(migrated.version).toBe(4);
	expect(migrated.groups).toEqual([
		{ id: "legacy", name: "Legacy", collapsed: false },
		{ id: "closed", name: "Closed", collapsed: true },
	]);
	expect(migrated.settings.playback.repeatMode).toBe("cycles");
	expect(migrated.settings.playback.repeatValue).toBe(4);
	expect("recordHotkey" in migrated.settings.playback).toBe(false);
	expect("playbackHotkey" in migrated.settings.playback).toBe(false);
	expect(migrated.flows[0].playback).toBeUndefined();
	expect(migrated.settings).toEqual({
		recordHotkey: "R",
		playbackHotkey: "Alt+Shift+P",
		playback: migrated.settings.playback,
	});
	expect(source.flows?.[0].actions).toEqual([{ id: "a", type: "click" }]);
});

test("migrates v3 shared playback with selected, first, and default precedence immutably", () => {
	const selected: PersistedInput = {
		version: 3,
		selectedFlowId: "selected",
		settings: {},
		flows: [
			{ id: "first", playback: { repeatValue: 2 } },
			{ id: "selected", playback: { repeatValue: 3 } },
		],
	};
	expect(migrateState(selected).settings.playback.repeatValue).toBe(3);
	const global: PersistedInput = {
		version: 3,
		selectedFlowId: "selected",
		settings: { playback: { repeatValue: 4 } },
		flows: [
			{ id: "first", playback: { repeatValue: 2 } },
			{ id: "selected", playback: { repeatValue: 3 } },
		],
	};
	expect(migrateState(global).settings.playback.repeatValue).toBe(4);
	const source: PersistedInput = structuredClone(global);
	const migrated = migrateState(source);
	expect(source.flows?.[0].playback).toEqual({ repeatValue: 2 });
	expect(migrated.flows.every((flow: Flow) => !("playback" in flow))).toBe(
		true,
	);
	expect(
		migrateState({
			version: 3,
			flows: [{ id: "first", playback: { repeatValue: 5 } }],
			settings: {},
		}).settings.playback.repeatValue,
	).toBe(5);
	expect(
		migrateState({ version: 3, flows: [{ id: "first" }], settings: {} })
			.settings.playback.repeatValue,
	).toBe(1);
	const combined = combineFlows(
		[bareFlow("a", "A"), bareFlow("b", "B")],
		() => "id",
	);
	expect(combined && "playback" in combined).toBe(false);
});

test("migrates v3 flows as unbound and preserves valid v4 targets", () => {
	const target = {
		executablePath: "C:\\App.exe",
		className: "Main",
		title: "A",
	};
	expect(
		migrateState({ version: 3, flows: [{ id: "old", target }], settings: {} })
			.flows[0].target,
	).toBeNull();
	expect(
		migrateState({ version: 4, flows: [{ id: "new", target }], settings: {} })
			.flows[0].target,
	).toEqual(target);
	expect(
		migrateState({
			version: 4,
			flows: [{ id: "bad", target: { ...target, className: "" } }],
			settings: {},
		}).flows[0].target,
	).toBeNull();
});

test("window signatures ignore title changes and combine only matching targets", () => {
	const a = { executablePath: "C:\\App.exe", className: "Main", title: "A" };
	const b = { executablePath: "c:\\app.exe", className: "main", title: "B" };
	expect(sameWindowTarget(a, b)).toBe(true);
	expect(sameRecordedWindow(a, 10, b, 10)).toBe(true);
	expect(sameRecordedWindow(a, 10, b, 11)).toBe(false);
	expect(
		combineFlows(
			[
				{ ...bareFlow("a", "A"), target: a },
				{ ...bareFlow("b", "B"), target: b },
			],
			() => "combined",
		)?.target,
	).toEqual(a);
	expect(
		combineFlows(
			[{ ...bareFlow("a", "A"), target: a }, bareFlow("b", "B")],
			() => "combined",
		)?.target,
	).toBeNull();
});

test("preserves combined-flow provenance and normalizes malformed actions", () => {
	const migrated = migrateState({
		version: 3,
		flows: [
			{
				id: "combined",
				combinedFrom: [{ id: "a", name: "A" }],
				actions: "invalid" as unknown as Action[],
			},
		],
	});
	expect(migrated.flows[0]?.combinedFrom).toEqual([{ id: "a", name: "A" }]);
	expect(migrated.flows[0]?.actions).toEqual([]);
});

test("normalizes editor size without mutating persisted state", () => {
	const source: PersistedInput = {
		version: 3,
		editorSize: { width: 1200, height: 800 },
		flows: [],
	};
	expect(migrateState(source).editorSize).toEqual({ width: 1200, height: 800 });
	expect(source.editorSize).toEqual({ width: 1200, height: 800 });
	const invalidSizes: Array<Parameters<typeof normalizeEditorSize>[0]> = [
		undefined,
		null,
		{},
		{ width: "1200", height: 800 } as unknown as {
			width: number;
			height: number;
		},
		{ width: 0, height: 800 },
		{ width: Infinity, height: 800 },
	];
	for (const editorSize of invalidSizes) {
		expect(normalizeEditorSize(editorSize)).toBeNull();
		expect(migrateState({ editorSize }).editorSize).toBeNull();
	}
});

test("copies grouped actions with fresh recursive ids", () => {
	let id = 0;
	const source: Extract<Action, { type: "group" }> = {
		id: "g",
		type: "group",
		name: "Group",
		repeatCount: 3,
		actions: [
			{
				id: "c",
				type: "click",
				name: "Click",
				screenX: 0,
				screenY: 0,
				delayMs: 0,
				button: "right",
			},
		],
	};
	const copy = copyAction(source, () => String(++id));
	expect(copy.type).toBe("group");
	if (copy.type !== "group") return;
	expect([copy.id, copy.actions[0].id]).toEqual(["1", "2"]);
	expect(copy.actions[0]).toMatchObject({ button: "right" });
	expect(actionClickCount(copy)).toBe(3);
	expect(source.actions[0].id).toBe("c");
	const grouped = groupContiguous(source.actions, ["c"], () => "group");
	expect(grouped?.group.actions[0]).toMatchObject({ button: "right" });
	const combined = combineFlows(
		[bareFlow("a", "A", [source])],
		() => "combined",
	);
	expect(combined?.actions[0]).toMatchObject({ type: "group" });
});

test("groups only contiguous leaves and ungroups without copying", () => {
	const actions: ClickAction[] = ["a", "b", "c"].map((id) => ({
		id,
		type: "click",
		name: "Click",
		screenX: 0,
		screenY: 0,
		delayMs: 0,
	}));
	let id = 0;
	const grouped = groupContiguous(actions, ["a", "b"], () => `g${++id}`);
	expect(grouped?.group.actions).toHaveLength(2);
	expect(
		grouped && ungroupAction([grouped.group], grouped.group.id)?.actions,
	).toHaveLength(2);
	expect(groupContiguous(actions, ["a", "c"], () => "g")).toBeNull();
	expect(
		grouped &&
			groupContiguous([grouped.group], [grouped.group.id], () => "nested"),
	).toBeNull();
});

test("moves manually and rolls past local times to tomorrow", () => {
	expect(
		moveItem([{ id: "a" }, { id: "b" }], "b", "a").map(
			({ id }: { id: string }) => id,
		),
	).toEqual(["b", "a"]);
	const now = new Date("2026-08-24T20:00:00");
	const deadline = nextDeadline("19:00", now);
	expect(deadline).not.toBeNull();
	expect(new Date(deadline as number).getDate()).toBe(25);
	expect(nextDeadline("25:00", now)).toBeNull();
});

test("normalizes empty flow selection and deletion lifecycle", () => {
	const empty = normalizeFlowSelection(testState([], "missing"));
	expect(empty.selectedFlowId).toBeNull();
	const state = testState([bareFlow("a", "A"), bareFlow("b", "B")], "b");
	expect(removeFlow(state, "a").selectedFlowId).toBe("b");
	expect(removeFlow(state, "b").selectedFlowId).toBe("a");
	expect(
		removeFlow({ ...state, selectedFlowId: "a" }, "a").selectedFlowId,
	).toBe("b");
	expect(
		removeFlow(testState([bareFlow("a", "A")], "a"), "a").selectedFlowId,
	).toBeNull();
});

test("accepts canonical hotkeys and rejects unsupported keys", () => {
	const event = {
		ctrlKey: true,
		altKey: false,
		shiftKey: true,
		metaKey: false,
		key: "r",
	} as unknown as KeyboardEvent;
	expect(normalizeHotkeyEvent(event)).toBe("Ctrl+Shift+R");
	expect(normalizeHotkeyEvent({ ...event, key: "F12" })).toBe("Ctrl+Shift+F12");
	expect(
		normalizeHotkeyEvent({
			...event,
			ctrlKey: false,
			shiftKey: false,
			key: "F1",
		}),
	).toBe("F1");
	expect(
		normalizeHotkeyEvent({
			...event,
			ctrlKey: false,
			shiftKey: false,
			key: "F8",
		}),
	).toBe("F8");
	expect(
		normalizeHotkeyEvent({
			...event,
			ctrlKey: false,
			shiftKey: false,
			key: "F12",
		}),
	).toBe("F12");
	expect(normalizeHotkeyEvent({ ...event, key: "ArrowUp" })).toBeNull();
	expect(
		normalizeHotkeyEvent({ ...event, ctrlKey: false, shiftKey: false }),
	).toBeNull();
	expect(hotkeysOverlap("F8", "Ctrl+F8")).toBe(true);
	expect(hotkeysOverlap("F8", "Ctrl+F9")).toBe(false);
	expect(hotkeysOverlap("Ctrl+F8", "Alt+F8")).toBe(false);
});

const bareFlow = (id: string, name: string, actions: Action[] = []): Flow => ({
	id,
	name,
	actions,
	groupId: null,
});
const testState = (flows: Flow[], selectedFlowId: string | null): AppState => ({
	version: 4,
	editorSize: null,
	selectedFlowId,
	settings: {
		recordHotkey: "R",
		playbackHotkey: "P",
		playback: {
			playbackSpeed: 1,
			repeatMode: "cycles",
			repeatValue: 1,
			repeatUnit: "seconds",
			settleMs: 0,
			holdMs: 0,
			restoreCursor: false,
			focusTargetWindow: true,
			untilTime: null,
		},
	},
	groups: [],
	flows,
});
