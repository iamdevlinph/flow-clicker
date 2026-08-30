import { beginNameFocus, restoreNameFocus } from "./editor-name-focus.js";
import { editorRowsHtml } from "./editor-table.js";
import type { EditorSnapshot } from "./types.js";

type Intent = (type: string, payload?: Record<string, unknown>) => void;
let snapshot: EditorSnapshot | null = null;
let selected = new Set<string>();
let editingNameActionId: string | null = null;

export function mountEditorView(root: HTMLElement): void {
	root.innerHTML = `<header class="editor-window-head"><div class="editor-title"><span class="eyebrow">Editor</span><input id="editorHeading" class="flow-name" value="Untitled flow" aria-label="Flow name" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><div id="flowMeta" class="flow-meta"></div></div></header>
		<div class="transport"><div class="transport-row"><button type="button" id="recordBtn" class="record">● Record</button><button type="button" id="stopRecordBtn" disabled>Stop record</button></div><div class="transport-row"><button type="button" id="runBtn" class="play">▶ Run flow</button><button type="button" id="stopRunBtn" disabled>■ Stop</button></div><button type="button" id="showMapBtn" class="transport-map" aria-pressed="false">Show click map</button></div>
		<div class="editor-toolbar"><div class="toolbar-group"><button type="button" id="addClickBtn">＋ Click</button><button type="button" id="addDelayBtn">＋ Delay</button><button type="button" id="importBtn" class="accent-outline">⇣ Import actions</button></div></div>
		<div class="action-table-wrap"><div id="actionRows" class="action-card-list"></div><div id="actionsEmpty" class="empty-state"><div class="empty-icon">＋</div><h3>No actions yet</h3><p>Record clicks, add an action manually, or import actions from another flow.</p></div></div>`;
}

const child = <T extends Element>(
	root: ParentNode,
	selector: string,
): T | null => root.querySelector<T>(selector);

export function renderEditorView(next: EditorSnapshot | null): void {
	snapshot = next;
	if (!snapshot) return;
	selected = new Set(snapshot.selectedActionIds || []);
	const heading = document.getElementById(
		"editorHeading",
	) as HTMLInputElement | null;
	const meta = document.getElementById("flowMeta");
	const rows = document.getElementById("actionRows");
	const empty = document.getElementById("actionsEmpty");
	if (!heading || !meta || !rows || !empty) return;
	const { flow } = snapshot;
	heading.value = flow.name;
	meta.textContent = `${flow.actions.length} actions`;
	const record = document.getElementById(
		"recordBtn",
	) as HTMLButtonElement | null;
	const stopRecord = document.getElementById(
		"stopRecordBtn",
	) as HTMLButtonElement | null;
	const run = document.getElementById("runBtn") as HTMLButtonElement | null;
	const stop = document.getElementById(
		"stopRunBtn",
	) as HTMLButtonElement | null;
	const map = document.getElementById("showMapBtn") as HTMLButtonElement | null;
	if (record) {
		record.disabled = snapshot.recording;
		record.classList.toggle("active", snapshot.recording);
	}
	if (stopRecord) stopRecord.disabled = !snapshot.recording;
	if (run) run.disabled = snapshot.playing;
	if (stop) stop.disabled = !snapshot.playing;
	if (map) {
		map.textContent = snapshot.mapVisible ? "Hide click map" : "Show click map";
		map.setAttribute("aria-pressed", String(snapshot.mapVisible));
	}
	const openActionIds = new Set(
		Array.from(
			rows.querySelectorAll<HTMLDetailsElement>(".action-card-accordion[open]"),
		)
			.map(
				(accordion) =>
					accordion.closest<HTMLElement>(".action-card")?.dataset.id,
			)
			.filter((id): id is string => !!id),
	);
	rows.innerHTML = editorRowsHtml(
		flow.actions,
		snapshot.mapVisible && snapshot.selectedActionId
			? [snapshot.selectedActionId]
			: [],
	);
	rows
		.querySelectorAll<HTMLDetailsElement>(".action-card-accordion")
		.forEach((accordion) => {
			const id = accordion.closest<HTMLElement>(".action-card")?.dataset.id;
			if (id && openActionIds.has(id)) accordion.open = true;
		});
	empty.classList.toggle("hidden", flow.actions.length > 0);
	const editing = editingNameActionId;
	editingNameActionId = null;
	rows.querySelectorAll<HTMLElement>(".action-card").forEach((card) => {
		const id = card.dataset.id;
		if (!id) return;
		card.addEventListener("click", (event) => {
			if (
				(event.target as Element).closest(
					"input,button,select,textarea,summary",
				)
			)
				return;
			selected = new Set([id]);
			intent?.("select-action", { actionId: id, multi: false });
		});
		const name = child<HTMLInputElement>(card, ".action-name");
		name?.addEventListener("click", (event) => event.stopPropagation());
		name?.addEventListener("keydown", (event) => event.stopPropagation());
		name?.addEventListener("focus", () => {
			if (beginNameFocus(selected, id, name)) {
				selected = new Set([id]);
				editingNameActionId = id;
				intent?.("select-action", { actionId: id, multi: false });
			}
		});
		name?.addEventListener("change", () =>
			intent?.("action-update", {
				actionId: id,
				field: "name",
				value: name.value,
			}),
		);
		for (const [selector, field] of [
			[".action-delay", "delayMs"],
			[".coord-x", "screenX"],
			[".coord-y", "screenY"],
			[".action-button", "button"],
		] as const) {
			child<HTMLInputElement | HTMLSelectElement>(
				card,
				selector,
			)?.addEventListener("change", (event) => {
				const target = event.currentTarget as
					| HTMLInputElement
					| HTMLSelectElement;
				intent?.("action-update", { actionId: id, field, value: target.value });
			});
		}
		card
			.querySelectorAll<HTMLButtonElement>(".row-action")
			.forEach((button) => {
				button.addEventListener("click", () => {
					intent?.(
						button.dataset.action === "delete"
							? "delete-action"
							: button.dataset.action === "duplicate"
								? "duplicate-action"
								: "move-action",
						{
							actionId: id,
							...(button.dataset.action === "move-up"
								? { delta: -1 }
								: button.dataset.action === "move-down"
									? { delta: 1 }
									: {}),
						},
					);
				});
			});
	});
	if (editing) restoreNameFocus(rows, editing);
}

let intent: Intent | null = null;
export function bindEditorView(send: Intent): void {
	intent = send;
	const click = (id: string, type: string) =>
		document.getElementById(id)?.addEventListener("click", () => send(type));
	document
		.getElementById("editorHeading")
		?.addEventListener("change", (event) =>
			send("rename", {
				value: (event.currentTarget as HTMLInputElement).value,
			}),
		);
	click("recordBtn", "record");
	click("stopRecordBtn", "stop-record");
	click("runBtn", "run");
	click("stopRunBtn", "stop");
	click("showMapBtn", "map");
	click("addClickBtn", "add-click");
	click("addDelayBtn", "add-delay");
	click("importBtn", "import");
}
