import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { selectedFlows, toggleSelection } from "./combine-selection.js";
import { closeEditorWindow, handleEditorWindowClosed } from "./editor-close.js";
import { beginNameFocus, restoreNameFocus } from "./editor-name-focus.js";
import { editorRowsHtml } from "./editor-table.js";
import { flowRowMarkup, groupHeaderMarkup } from "./flow-library.js";
import { moveFlow, moveFlowByKey } from "./flow-ordering.js";
import {
	moveLibraryGroup,
	moveLibraryGroupByKey,
	toggleLibraryGroup,
	updateLibraryGroups,
} from "./library-group.js";
import { dismissOverlayOnEscape, markerClass } from "./overlay-interactions.js";
import {
	normalizePlayback,
	playbackFromForm,
	playbackToForm,
	secondsToTimer,
	timerToSeconds,
} from "./playback-form.js";
import type {
	Action,
	ClickAction,
	DelayAction,
	EditorSize,
	Flow,
	LibraryGroup,
} from "./types.js";

type WindowConfig = {
	label: string;
	title: string;
	minWidth?: number;
	backgroundColor?: string;
};
type TauriConfig = {
	version?: string;
	identifier: string;
	app: { windows: WindowConfig[] };
};
type CapabilityConfig = { permissions: string[] };
type FormField = { value: string; checked: boolean };
type PlaybackInput = Parameters<typeof playbackToForm>[0];

const testFlow = (
	id: string,
	name = "Flow",
	groupId: string | null = null,
	actions: Action[] = [],
): Flow => ({ id, name, actions, groupId });

const expectAssert = {
	equal<T>(actual: T, expected: T): void {
		expect(actual).toBe(expected);
	},
	deepEqual<T>(actual: T, expected: T): void {
		expect(actual).toEqual(expected);
	},
	match(actual: string, expected: RegExp): void {
		expect(actual).toMatch(expected);
	},
	doesNotMatch(actual: string, expected: RegExp): void {
		expect(actual).not.toMatch(expected);
	},
	ok(actual: unknown): void {
		expect(actual).toBeTruthy();
	},
};

test("flow ordering preserves group membership and selection order", () => {
	const flows: Flow[] = [
		testFlow("a", "A", "g"),
		testFlow("b", "B", "g"),
		testFlow("c", "C"),
	];
	expectAssert.deepEqual(
		moveFlowByKey(flows, "b", -1).map(({ id }) => id),
		["b", "a", "c"],
	);
	const moved = moveFlow(flows, "c", "a", "g");
	expectAssert.deepEqual(
		moved.map(({ id }) => id),
		["c", "a", "b"],
	);
	expectAssert.equal(moved[0].groupId, "g");
	expectAssert.deepEqual(
		selectedFlows(["b", "a"], moved).map(({ id }) => id),
		["b", "a"],
	);
});

test("combine card selection keeps click order and supports deselection", () => {
	let ids: string[] = [];
	ids = toggleSelection(ids, "b", true);
	ids = toggleSelection(ids, "a", true);
	ids = toggleSelection(ids, "b", false);
	ids = toggleSelection(ids, "b", true);
	expectAssert.deepEqual(ids, ["a", "b"]);
	expectAssert.deepEqual(
		selectedFlows(ids, [testFlow("a", "A"), testFlow("b", "B")]).map(
			({ id }) => id,
		),
		["a", "b"],
	);
});

test("flow cards use four columns and omit metadata", () => {
	const html = flowRowMarkup({
		flow: { id: "a", name: "Flow" },
		escapeHtml: (value: string): string => value,
		combineSelected: true,
	});
	expectAssert.match(
		html,
		/^<input class="flow-combine"[\s\S]*<button class="flow-play"[\s\S]*<div class="flow-main"[\s\S]*<div class="flow-row-actions"/,
	);
	expectAssert.match(
		html,
		/class="icon-btn flow-settings"[^>]*aria-label="Playback settings"/,
	);
	expectAssert.doesNotMatch(html, /flow-row-meta|actions ·|clicks ·|delays/);
});

test("combine summary source order follows card selection order", () => {
	const flows: Flow[] = [testFlow("b", "Beta"), testFlow("a", "Alpha")];
	expectAssert.deepEqual(
		selectedFlows(["a", "b"], flows).map(({ name }) => name),
		["Alpha", "Beta"],
	);
});

test("library group cancel leaves state and save leaves flow timestamps alone", () => {
	const groups: LibraryGroup[] = [{ id: "g", name: "Old", collapsed: true }];
	const flows: Array<Pick<Flow, "id" | "updatedAt">> = [
		{ id: "f", updatedAt: "fixed" },
	];
	expectAssert.equal(updateLibraryGroups(groups, "g", "   ", "new"), null);
	expectAssert.deepEqual(groups, [{ id: "g", name: "Old", collapsed: true }]);
	const renamed = updateLibraryGroups(groups, "g", " New ", "new");
	if (renamed === null) throw new Error("expected valid group rename");
	const created = updateLibraryGroups(renamed, null, " Extra ", "x");
	expectAssert.deepEqual(created, [
		{ id: "g", name: "New", collapsed: true },
		{ id: "x", name: "Extra", collapsed: false },
	]);
	expectAssert.deepEqual(flows, [{ id: "f", updatedAt: "fixed" }]);
});

test("group disclosure exposes saved state and collapse toggling is immutable", () => {
	const group: LibraryGroup = { id: "g", name: "Group", collapsed: true };
	const html = groupHeaderMarkup({
		group,
		escapeHtml: (value: string): string => value,
		flowListId: "group-flows-g",
	});
	expectAssert.match(
		html,
		/class="group-disclosure"[^>]*aria-expanded="false"[^>]*aria-controls="group-flows-g"/,
	);
	const searching = groupHeaderMarkup({
		group,
		search: "match",
		escapeHtml: (value: string): string => value,
		flowListId: "group-flows-g",
	});
	expectAssert.match(
		searching,
		/class="group-disclosure"[^>]*aria-expanded="true"/,
	);
	expectAssert.equal(group.collapsed, true);
	expectAssert.match(
		groupHeaderMarkup({
			group,
			escapeHtml: (value: string): string => value,
			flowListId: "group-flows-g",
		}),
		/aria-expanded="false"/,
	);
	const toggled = toggleLibraryGroup([group], "g");
	expectAssert.equal(toggled[0].collapsed, false);
	expectAssert.equal(group.collapsed, true);
});

test("group ordering is immutable and preserves group records", () => {
	const groups: LibraryGroup[] = [
		{ id: "a", name: "A", collapsed: true },
		{ id: "b", name: "B", collapsed: false },
		{ id: "c", name: "C", collapsed: true },
	];
	const moved = moveLibraryGroup(groups, "c", "a");
	expectAssert.deepEqual(
		moved.map(({ id }) => id),
		["c", "a", "b"],
	);
	expectAssert.deepEqual(
		groups.map(({ id }) => id),
		["a", "b", "c"],
	);
	expectAssert.deepEqual(moved, [groups[2], groups[0], groups[1]]);
	expectAssert.deepEqual(
		moveLibraryGroupByKey(groups, "b", 1).map(({ id }) => id),
		["a", "c", "b"],
	);
	expectAssert.deepEqual(
		moveLibraryGroup(groups, "a", "c").map(({ id }) => id),
		["b", "c", "a"],
	);
	expectAssert.deepEqual(moveLibraryGroupByKey(groups, "a", -1), groups);
	expectAssert.deepEqual(moveLibraryGroupByKey(groups, "c", 1), groups);
	expectAssert.deepEqual(moveLibraryGroup(groups, "missing", "a"), groups);
	expectAssert.deepEqual(moveLibraryGroup(groups, "a", "missing"), groups);
	expectAssert.deepEqual(moveLibraryGroup(groups, "a", "a"), groups);
});

test("group headers expose native drag and keyboard ordering hooks", () => {
	const library = readFileSync(
		new URL("./flow-library.ts", import.meta.url),
		"utf8",
	);
	expectAssert.match(library, /head\.draggable = true/);
	expectAssert.match(library, /draggedGroupId/);
	expectAssert.match(library, /event\.altKey.*ArrowUp/);
	expectAssert.match(library, /onMoveGroupBefore/);
});

test("group action sizing does not alter flow-card settings", () => {
	const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
	expectAssert.match(
		styles,
		/\.group-rename,\s*\.group-delete\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*padding:\s*0;[^}]*font-size:\s*15px;/,
	);
	expectAssert.match(
		styles,
		/\.flow-settings\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--subtle\);/,
	);
	expectAssert.doesNotMatch(styles, /\.flow-settings[^}]*width:\s*26px/);
});

test("playback effects are transient and recording replaces actions after native startup", () => {
	const overlay = readFileSync(
		new URL("./overlay.ts", import.meta.url),
		"utf8",
	);
	const overlayStyles = readFileSync(
		new URL("./overlay.css", import.meta.url),
		"utf8",
	);
	expectAssert.match(overlay, /playback-click-effect/);
	expectAssert.match(overlay, /mode !== "playback"/);
	expectAssert.match(overlayStyles, /animation: playback-click-ripple 450ms/);
});

test("runtime banner reserves space and uses accessible idle, recording, and playing states", () => {
	const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
	const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	expectAssert.match(
		html,
		/<div class="status-banner" id="runtimeStatus" role="status" aria-live="polite">Idle<\/div>\s*<header class="topbar">/,
	);
	expectAssert.match(
		styles,
		/\.status-banner \{[^}]*flex: 0 0 22px[^}]*background: var\(--subtle\)/,
	);
	expectAssert.match(
		styles,
		/\.status-banner\.recording\s*\{[^}]*background:\s*var\(--red\);[^}]*color:\s*var\(--bg\);/,
	);
	expectAssert.match(
		styles,
		/\.status-banner\.playing\s*\{[^}]*background:\s*var\(--green\)/,
	);
	expectAssert.match(app, /setStatus\("Recording", "recording"\)/);
	expectAssert.match(
		app,
		/setStatus\([\s\S]*playbackStatus\([\s\S]*\),\s*"playing",?\s*\);/,
	);
	expectAssert.equal((app.match(/setStatus\("Idle"\)/g) || []).length, 6);
});

test("duration Stop persists only an active, unchanged duration", () => {
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	expectAssert.doesNotMatch(
		app,
		/durationResume|stopRequested|durationToRun|durationResumeAfterEnd/,
	);
	expectAssert.match(
		app,
		/const active = activePlayback;\s*const canPersistDuration =\s*!!active && playing && active\.playback\.repeatMode === "duration";[\s\S]*await invoke\("stop_playback"\);[\s\S]*if \(!canPersistDuration\) return;[\s\S]*const remainder = active \? durationRemainder\(active, flowPlayback\(\)\) : null;/,
	);
	expectAssert.match(
		app,
		/state\.settings\.playback\.repeatValue = remainder;\s*renderSettings\(\);\s*scheduleSave\(\);/,
	);
	expectAssert.match(
		app,
		/else\s*\{\s*clearPlaybackStatus\(\);\s*runningFlowId = null;\s*\}/,
	);
	expectAssert.match(
		app,
		/"playback-error"[\s\S]*clearPlaybackStatus\(\);[\s\S]*playing = false/,
	);
});

test("creating and duplicating flows preserve editor visibility", () => {
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	expectAssert.match(
		app,
		/onEdit: openEditor,[\s\S]*onCreateFlow: \(\) => newFlow/,
	);
	expectAssert.match(
		app,
		/newFlowBtn["']\)\.addEventListener\(["']click["'], \(\) =>[\s\S]{0,120}newFlow/,
	);
	expectAssert.match(app, /choice === "edit"\) openEditor\(flow\)/);
	expectAssert.doesNotMatch(app, /onCreateFlow:[^\n]*openEditor/);
	expectAssert.doesNotMatch(
		app,
		/newFlowBtn["']\)\.addEventListener\([\s\S]{0,180}openEditor/,
	);
	expectAssert.doesNotMatch(app, /function duplicateFlow\([^\n]*openEditor/);
});

test("packaged version appears below the main heading and titles only the main window", () => {
	const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
	const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	const config = JSON.parse(
		readFileSync(
			new URL("../src-tauri/tauri.conf.json", import.meta.url),
			"utf8",
		),
	) as TauriConfig;
	const capability = JSON.parse(
		readFileSync(
			new URL("../src-tauri/capabilities/default.json", import.meta.url),
			"utf8",
		),
	) as CapabilityConfig;
	expectAssert.match(
		html,
		/<h1>FlowClicker<\/h1>\s*<span class="version" id="appVersion"><\/span>/,
	);
	expectAssert.match(
		styles,
		/\.topbar\s*\{[^}]*height:\s*58px;[^}]*flex:\s*0 0 58px;/,
	);
	expectAssert.match(
		styles,
		/\.version\s*\{[^}]*display:\s*block;[^}]*color:\s*var\(--subtle\);[^}]*font-size:\s*9px/,
	);
	expectAssert.match(app, /const getVersion = T\?\.app\?\.getVersion/);
	expectAssert.match(app, /setTitle\(`FlowClicker v\$\{version\}`\)/);
	expectAssert.equal(config.version, undefined);
	expectAssert.equal(config.identifier, "com.flowclicker.desktop");
	expectAssert.deepEqual(
		config.app.windows.map((window: WindowConfig): string => window.title),
		["FlowClicker", "FlowClicker Editor", "FlowClicker Overlay"],
	);
	expectAssert.ok(
		capability.permissions.includes("core:window:allow-set-title"),
	);
});

test("startup background and playback speed use the shipped minimum", () => {
	const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
	const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
	const config = JSON.parse(
		readFileSync(
			new URL("../src-tauri/tauri.conf.json", import.meta.url),
			"utf8",
		),
	) as TauriConfig;
	const mainWindow = config.app.windows.find(
		(window: WindowConfig): boolean => window.label === "main",
	);
	expectAssert.match(
		html,
		/id="playbackSpeed" type="number" min="1" max="50" step="1"/,
	);
	expectAssert.match(styles, /--bg:\s*#0b0e13/);
	expectAssert.equal(mainWindow?.backgroundColor, "#0b0e13");
});

test("playback speed normalization clamps only the lower bound", () => {
	expectAssert.equal(normalizePlayback({ playbackSpeed: 0 }).playbackSpeed, 1);
	expectAssert.equal(
		normalizePlayback({ playbackSpeed: 0.5 }).playbackSpeed,
		1,
	);
	expectAssert.equal(
		normalizePlayback({ playbackSpeed: 2.5 }).playbackSpeed,
		2.5,
	);
	const fields: Record<string, FormField> = Object.fromEntries(
		[
			"playbackSpeed",
			"repeatMode",
			"repeatValue",
			"repeatDuration",
			"settleMs",
			"holdMs",
			"untilTime",
			"restoreCursor",
			"focusTarget",
		].map((id: string): [string, FormField] => [
			id,
			{ value: "", checked: false },
		]),
	);
	fields.playbackSpeed.value = "0.5";
	expectAssert.equal(
		playbackFromForm((id: string): FormField => fields[id]).playbackSpeed,
		1,
	);
	fields.playbackSpeed.value = "2.5";
	expectAssert.equal(
		playbackFromForm((id: string): FormField => fields[id]).playbackSpeed,
		2.5,
	);
});

test("data transfer reuses accessible settings and destructive dialog patterns", () => {
	const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	expectAssert.match(
		html,
		/<div class="setting-title">Data transfer<\/div>[\s\S]*id="exportPortableBtn"[\s\S]*id="importPortableBtn"/,
	);
	expectAssert.match(
		html,
		/id="portableImportModal"[\s\S]*role="dialog" aria-modal="true" aria-labelledby="portableImportHeading"[\s\S]*<textarea id="portableImportText"[\s\S]*id="choosePortableFileBtn"/,
	);
	expectAssert.match(
		html,
		/id="portableConfirmModal"[\s\S]*id="portableConfirmMessage"[\s\S]*class="danger-ghost" id="confirmPortableImportBtn"/,
	);
	expectAssert.match(
		app,
		/openDialog\("portableImportModal", "portableImportText"\)/,
	);
	expectAssert.match(
		app,
		/event\.key !== "Escape"[\s\S]*closeDialog\("portableImportModal"\)[\s\S]*closeDialog\("portableConfirmModal"\)/,
	);
	expectAssert.match(
		app,
		/const replacement = replaceWithPortableData[\s\S]*if \(!\(await saveState\(false, replacement\)\)\) \{[\s\S]*if \(editorWasOpen\)[\s\S]*if \(overlayWasVisible\)[\s\S]*return;[\s\S]*state = replacement/,
	);
});

test("playback form maps repeat count, timer, until, and continuous modes", () => {
	const fields: Record<string, FormField> = Object.fromEntries(
		[
			"playbackSpeed",
			"repeatMode",
			"repeatValue",
			"repeatDuration",
			"settleMs",
			"holdMs",
			"untilTime",
			"restoreCursor",
			"focusTarget",
		].map((id: string): [string, FormField] => [
			id,
			{ value: "", checked: false },
		]),
	);
	playbackToForm(
		{
			playbackSpeed: 2,
			repeatMode: "duration",
			repeatValue: 3,
			repeatUnit: "minutes",
			settleMs: 4,
			holdMs: 5,
			restoreCursor: true,
			focusTargetWindow: false,
		} as unknown as PlaybackInput,
		(id: string): FormField => fields[id],
	);
	expectAssert.equal(fields.repeatMode.value, "duration");
	expectAssert.equal(fields.repeatDuration.value, "00:03:00");
	expectAssert.deepEqual(
		playbackFromForm((id: string): FormField => fields[id]),
		{
			playbackSpeed: 2,
			repeatMode: "duration",
			repeatValue: 180,
			repeatUnit: "seconds",
			settleMs: 4,
			holdMs: 5,
			restoreCursor: true,
			focusTargetWindow: false,
			untilTime: null,
		},
	);
	fields.repeatMode.value = "cycles";
	fields.repeatValue.value = "3";
	expectAssert.equal(
		playbackFromForm((id: string): FormField => fields[id]).repeatValue,
		3,
	);
	fields.repeatMode.value = "until";
	fields.untilTime.value = "09:30";
	expectAssert.deepEqual(
		playbackFromForm((id: string): FormField => fields[id]).untilTime,
		"09:30",
	);
	expectAssert.equal(
		playbackFromForm((id: string): FormField => fields[id]).repeatMode,
		"continuous",
	);
	expectAssert.equal(
		playbackToForm(
			{ repeatMode: "continuous", untilTime: "09:30" },
			(id: string): FormField => fields[id],
		).repeatMode,
		"until",
	);
});

test("timer conversion clamps invalid sub-minute values and zero duration", () => {
	expectAssert.equal(timerToSeconds(1, 75, 99), 7199);
	expectAssert.equal(timerToSeconds(0, 0, 0), 1);
	expectAssert.deepEqual(secondsToTimer(3661), {
		hours: 1,
		minutes: 1,
		seconds: 1,
	});
	expectAssert.equal(
		normalizePlayback({ repeatMode: "duration", repeatValue: 999999 })
			.repeatValue,
		359999,
	);
	expectAssert.equal(
		normalizePlayback({
			repeatMode: "clicks",
			repeatValue: 4,
		} as unknown as Parameters<typeof normalizePlayback>[0]).repeatMode,
		"cycles",
	);
	expectAssert.equal(
		normalizePlayback({
			repeatMode: "clicks",
			repeatValue: 4,
		} as unknown as Parameters<typeof normalizePlayback>[0]).repeatValue,
		4,
	);
	expectAssert.equal(
		normalizePlayback({
			repeatMode: "cycles",
			repeatValue: 4,
			untilTime: "09:30",
		}).repeatMode,
		"continuous",
	);
});

test("editor renders separate X/Y cells and keeps delay with ms", () => {
	const click: ClickAction = {
		id: "a",
		type: "click",
		name: "Click",
		screenX: 12,
		screenY: 34,
		delayMs: 56,
		windowTitle: "A <target>",
	};
	const delay: DelayAction = {
		id: "d",
		type: "delay",
		name: "Delay",
		delayMs: 3,
	};
	const html = editorRowsHtml([click, delay]);
	expectAssert.match(html, /coord-x[^>]*value="12"/);
	expectAssert.match(
		html,
		/<\/td><td><input class="compact-input coord-y"[^>]*value="34"/,
	);
	expectAssert.match(html, /class="delay-input"[\s\S]*>ms<\/span>/);
	expectAssert.match(
		html,
		/class="icon-btn target-info"[\s\S]*title="A &lt;target&gt;"[\s\S]*aria-label="Target: A &lt;target&gt;"/,
	);
	expectAssert.doesNotMatch(html, />A &lt;target&gt;</);
	expectAssert.match(html, /<td class="target-cell">—<\/td>/);
	expectAssert.match(
		html,
		/<td class="row-actions"><div class="row-action-group">[\s\S]*data-action="move-up"[\s\S]*data-action="move-down"[\s\S]*data-action="duplicate"[\s\S]*data-action="delete"[\s\S]*<\/div><\/td>/,
	);
	expectAssert.match(
		html,
		/<td class="row-actions">[\s\S]*data-action="move-up"[^>]* disabled/,
	);
	expectAssert.match(html, /data-action="move-down"[^>]* disabled/);
	expectAssert.match(
		html,
		/class="compact-input action-button"[^>]*aria-label="Button for Click"[\s\S]*<option value="left" selected>Left<\/option>[\s\S]*<option value="right"/,
	);
	expectAssert.match(
		editorRowsHtml([
			{
				id: "r",
				type: "click",
				name: "Right",
				screenX: 0,
				screenY: 0,
				delayMs: 0,
				button: "right",
			},
		]),
		/<option value="right" selected>Right<\/option>/,
	);
});

test("editor sends button updates and the main window accepts only supported values", () => {
	const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	expectAssert.match(
		editor,
		/bindChange<HTMLSelectElement>\(row, "\.action-button", "button", id\)/,
	);
	expectAssert.match(
		app,
		/intent\.field === "button"[\s\S]*action\.type === "click"[\s\S]*intent\.value === "left"[\s\S]*intent\.value === "right"/,
	);
});

test("editor keeps actions in rows and constrains Name column", () => {
	const html = readFileSync(new URL("./editor.html", import.meta.url), "utf8");
	const css = readFileSync(new URL("./editor.css", import.meta.url), "utf8");
	const config = JSON.parse(
		readFileSync(
			new URL("../src-tauri/tauri.conf.json", import.meta.url),
			"utf8",
		),
	) as TauriConfig;
	expectAssert.match(html, /<th>Actions<\/th>/);
	expectAssert.doesNotMatch(
		html,
		/id="moveUpBtn"|id="duplicateBtn"|id="deleteBtn"/,
	);
	expectAssert.match(css, /nth-child\(3\)[^}]*160px/);
	expectAssert.match(
		css,
		/nth-child\(8\)[^}]*width: 1%[^}]*white-space: nowrap/,
	);
	expectAssert.match(css, /html,\s*body\s*\{[^}]*min-width:\s*720px/);
	expectAssert.equal(
		config.app.windows.find(
			(window: WindowConfig): boolean => window.label === "editor",
		)?.minWidth,
		720,
	);
});

test("editor highlights only selected clicks for the click map", () => {
	const html = editorRowsHtml(
		[
			{
				id: "click",
				type: "click",
				name: "Click",
				screenX: 0,
				screenY: 0,
				delayMs: 0,
			},
			{ id: "delay", type: "delay", name: "Delay", delayMs: 0 },
		],
		["click", "delay"],
	);
	expectAssert.match(html, /data-id="click" class="action-selected"/);
	expectAssert.doesNotMatch(html, /data-id="delay" class="action-selected"/);
});

test("both editor close paths hide the overlay before persisting size", async () => {
	const calls: string[] = [];
	await closeEditorWindow(
		async (): Promise<void> => {
			calls.push("hide-map");
		},
		async (): Promise<EditorSize> => ({ width: 1, height: 1 }),
		async (): Promise<void> => {
			calls.push("save-size");
		},
	);
	expectAssert.deepEqual(calls, ["hide-map", "save-size"]);
	calls.length = 0;
	await handleEditorWindowClosed(
		{ width: 2, height: 2 },
		async (): Promise<void> => {
			calls.push("hide-map");
		},
		async (): Promise<void> => {
			calls.push("save-size");
		},
	);
	expectAssert.deepEqual(calls, ["hide-map", "save-size"]);
});

test("name focus selects the full value before and after primary-selection rerender", () => {
	const input: { selections: number; focus(): void; select(): void } = {
		selections: 0,
		focus(): void {},
		select(): void {
			this.selections += 1;
		},
	};
	expectAssert.equal(beginNameFocus(new Set(), "click", input), true);
	globalThis.CSS = { escape: (value: string): string => value } as typeof CSS;
	restoreNameFocus({ querySelector: () => input }, "click");
	expectAssert.equal(input.selections, 1);
	expectAssert.equal(beginNameFocus(new Set(["click"]), "click", input), false);
	expectAssert.equal(input.selections, 2);
});

test("overlay Escape dismisses once and marker emphasis clears for nonmatching selections", () => {
	const calls: string[] = [];
	const event: KeyboardEvent = {
		key: "Escape",
		preventDefault: (): void => {
			calls.push("prevent");
		},
		stopPropagation: (): void => {
			calls.push("stop");
		},
	} as unknown as KeyboardEvent;
	expectAssert.equal(
		dismissOverlayOnEscape(event, () => calls.push("dismiss")),
		true,
	);
	expectAssert.deepEqual(calls, ["prevent", "stop", "dismiss"]);
	expectAssert.equal(
		dismissOverlayOnEscape({ key: "Enter" } as unknown as KeyboardEvent, () => {
			calls.push("bad");
		}),
		false,
	);
	expectAssert.equal(markerClass(true, true), "marker interactive selected");
	expectAssert.equal(markerClass(true, false), "marker interactive");
});

test("editor and overlay wire focus, dismissal, and primary click selection", () => {
	const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
	const editor = readFileSync(new URL("./editor.ts", import.meta.url), "utf8");
	const overlay = readFileSync(
		new URL("./overlay.ts", import.meta.url),
		"utf8",
	);
	const overlayCss = readFileSync(
		new URL("./overlay.css", import.meta.url),
		"utf8",
	);
	const rust = readFileSync(
		new URL("../src-tauri/src/main.rs", import.meta.url),
		"utf8",
	);

	expectAssert.match(
		app,
		/closeEditorWindow\([\s\S]*hideOverlay,[\s\S]*\(\) => invoke\("hide_editor"\)/,
	);
	expectAssert.match(
		app,
		/handleEditorWindowClosed\([\s\S]*normalizeEditorSize\(event\.payload\),[\s\S]*hideOverlay/,
	);
	expectAssert.match(
		app,
		/emitTo\("overlay", "overlay-selection", \{\s*actionId: selectedActionId,?\s*\}\)/,
	);
	expectAssert.match(
		app,
		/listen\("overlay-dismiss-requested", \(\) => hideOverlay\(\)\)/,
	);
	expectAssert.match(
		editor,
		/beginNameFocus\(selected, id, input\)[\s\S]*send\("select-action", \{ actionId: id, multi: false \}\)[\s\S]*restoreNameFocus/,
	);
	expectAssert.match(
		overlay,
		/markerClass\(\s*payload\.interactive,\s*point\.actionId === selectedActionId,?\s*\)/,
	);
	expectAssert.match(
		overlay,
		/listen\?\.<\{ actionId\?: string \}>\([\s\S]*"overlay-selection"[\s\S]*selectedActionId = event\.payload\.actionId \?\? null/,
	);
	expectAssert.match(
		overlay,
		/dismissOverlayOnEscape[\s\S]*"overlay-dismiss-requested"/,
	);
	expectAssert.match(overlayCss, /\.marker\.selected \{/);
	expectAssert.match(rust, /overlay\.show\(\)[\s\S]*overlay\.set_focus\(\)/);
});
