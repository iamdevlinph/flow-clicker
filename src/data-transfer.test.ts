import { expect, test } from "vitest";
import {
	exportPortableData,
	parsePortableData,
	replaceWithPortableData,
} from "./data-transfer.js";
import type { AppState, ClickAction } from "./types.js";

const click = (id = "a"): ClickAction => ({
	type: "click",
	id,
	name: "Click",
	screenX: 10,
	screenY: 20,
	relativeX: null,
	relativeY: null,
	windowTitle: null,
	delayMs: 3,
});
const state = (): AppState => ({
	version: 3,
	editorSize: { width: 800, height: 600 },
	selectedFlowId: "old",
	settings: {
		recordHotkey: "R",
		playbackHotkey: "P",
		playback: {
			playbackSpeed: 2,
			repeatMode: "cycles",
			repeatValue: 9,
			repeatUnit: "seconds",
			settleMs: 0,
			holdMs: 0,
			restoreCursor: false,
			focusTargetWindow: true,
			untilTime: null,
		},
	},
	groups: [{ id: "g", name: "Group", collapsed: false }],
	flows: [
		{
			id: "f",
			name: "Flow",
			groupId: "g",
			createdAt: "now",
			updatedAt: "now",
			playback: {
				playbackSpeed: 2,
				repeatMode: "cycles",
				repeatValue: 9,
				repeatUnit: "seconds",
				settleMs: 0,
				holdMs: 0,
				restoreCursor: false,
				focusTargetWindow: true,
				untilTime: null,
			},
			actions: [click()],
		},
	],
});

test("export omits device fields and deep-copies flow data", () => {
	const source = state();
	const exported = JSON.parse(exportPortableData(source)) as {
		version: number;
		flows: Array<{ actions: ClickAction[]; playback?: unknown }>;
		groups: unknown[];
	};
	expect(Object.keys(exported)).toEqual(["version", "flows", "groups"]);
	expect(exported.flows[0].playback).toBeUndefined();
	exported.flows[0].actions[0].name = "changed";
	expect(source.flows[0].actions[0]).toMatchObject({ name: "Click" });
});

test("round-trip import preserves local settings and selects first flow", () => {
	const source = state();
	const imported = replaceWithPortableData(source, exportPortableData(source));
	expect(imported.selectedFlowId).toBe("f");
	expect(imported.settings).toEqual(source.settings);
	expect(imported.editorSize).toEqual(source.editorSize);
	imported.flows[0].name = "new";
	expect(source.flows[0].name).toBe("Flow");
});

test("empty libraries import with no selection", () => {
	const imported = replaceWithPortableData(
		state(),
		JSON.stringify({ version: 3, flows: [], groups: [] }),
	);
	expect(imported.selectedFlowId).toBeNull();
});

test("accepts click actions recorded without optional window coordinates", () => {
	const source = state();
	source.flows[0].actions = [
		{
			type: "click",
			id: "a",
			name: "Click",
			screenX: 10,
			screenY: 20,
			delayMs: 0,
		},
	];
	expect(
		parsePortableData(exportPortableData(source)).flows[0].actions[0].id,
	).toBe("a");
});

test("defaults legacy button and preserves right button through portable transfer", () => {
	const source = state();
	source.flows[0].actions = [click(), { ...click("b"), button: "right" }];
	const imported = parsePortableData(exportPortableData(source));
	expect(imported.flows[0].actions[0]).toMatchObject({ button: "left" });
	expect(imported.flows[0].actions[1]).toMatchObject({ button: "right" });
});

test("round-trips combined-flow provenance", () => {
	const source = state();
	source.flows[0].combinedFrom = [{ id: "source", name: "Source flow" }];
	expect(
		parsePortableData(exportPortableData(source)).flows[0].combinedFrom,
	).toEqual(source.flows[0].combinedFrom);
});

for (const [name, payload] of [
	["malformed JSON", "{"],
	[
		"unsupported version",
		JSON.stringify({ version: 2, flows: [], groups: [] }),
	],
	[
		"invalid action",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: null,
					createdAt: "",
					updatedAt: "",
					actions: [{ type: "wat" }],
				},
			],
			groups: [],
		}),
	],
	[
		"out-of-range coordinates",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: null,
					createdAt: "",
					updatedAt: "",
					actions: [click()],
				},
			],
			groups: [],
		}).replace('"screenX":10', '"screenX":2147483648'),
	],
	[
		"unsafe integer delay",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: null,
					createdAt: "",
					updatedAt: "",
					actions: [{ ...click(), delayMs: 1e100 }],
				},
			],
			groups: [],
		}),
	],
	[
		"unsupported button",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: null,
					createdAt: "",
					updatedAt: "",
					actions: [{ ...click(), button: "middle" }],
				},
			],
			groups: [],
		}),
	],
	[
		"duplicate IDs",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: null,
					createdAt: "",
					updatedAt: "",
					actions: [click("f")],
				},
			],
			groups: [],
		}),
	],
	[
		"broken group reference",
		JSON.stringify({
			version: 3,
			flows: [
				{
					id: "f",
					name: "F",
					groupId: "missing",
					createdAt: "",
					updatedAt: "",
					actions: [],
				},
			],
			groups: [],
		}),
	],
])
	test(`rejects ${name}`, () =>
		expect(() => parsePortableData(payload)).toThrow());
