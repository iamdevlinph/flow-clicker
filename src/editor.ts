import { beginNameFocus, restoreNameFocus } from "./editor-name-focus.js";
import { editorRowsHtml } from "./editor-table.js";
import type { EditorSnapshot, Flow } from "./types.js";

const tauri = window.__TAURI__;
const emit = tauri?.event?.emit;
const listen = tauri?.event?.listen;
const $ = <T extends HTMLElement>(id: string): T => {
	const element: HTMLElement | null = document.getElementById(id);
	if (!element) throw new Error(`Missing editor element: ${id}`);
	return element as T;
};
const send = (type: string, payload: Record<string, unknown> = {}): void => {
	emit?.("editor-intent", { type, ...payload });
};

let snapshot: EditorSnapshot | null = null;
let selected: Set<string> = new Set<string>();
let editingNameActionId: string | null = null;

function render(): void {
	const flow: Flow | undefined = snapshot?.flow;
	if (!flow || !snapshot) return;
	const heading: HTMLInputElement = $("editorHeading");
	const meta: HTMLElement = $("flowMeta");
	const recordButton: HTMLButtonElement = $("recordBtn");
	const stopRecordButton: HTMLButtonElement = $("stopRecordBtn");
	const runButton: HTMLButtonElement = $("runBtn");
	const stopRunButton: HTMLButtonElement = $("stopRunBtn");
	const mapButton: HTMLButtonElement = $("showMapBtn");
	const rows: HTMLTableSectionElement = $("actionRows");
	const empty: HTMLElement = $("actionsEmpty");
	heading.value = flow.name;
	meta.textContent = `${flow.actions.length} actions`;
	recordButton.disabled = snapshot.recording;
	recordButton.classList.toggle("active", snapshot.recording);
	stopRecordButton.disabled = !snapshot.recording;
	runButton.disabled = snapshot.playing;
	stopRunButton.disabled = !snapshot.playing;
	mapButton.textContent = snapshot.mapVisible
		? "Hide click map"
		: "Show click map";
	mapButton.setAttribute("aria-pressed", String(snapshot.mapVisible));
	rows.innerHTML = editorRowsHtml(
		flow.actions,
		snapshot.mapVisible && snapshot.selectedActionId
			? [snapshot.selectedActionId]
			: [],
	);
	empty.classList.toggle("hidden", flow.actions.length > 0);
	const editingName: string | null = editingNameActionId;
	editingNameActionId = null;
	rows
		.querySelectorAll<HTMLTableRowElement>("tr")
		.forEach((row: HTMLTableRowElement): void => {
			const id: string | undefined = row.dataset.id;
			if (!id) return;
			row.onclick = (event: MouseEvent): void => {
				if (
					event.target instanceof Element &&
					event.target.closest("input, button, select, textarea, a")
				)
					return;
				selected = new Set<string>([id]);
				send("select-action", { actionId: id, multi: false });
			};
			const nameInput: HTMLInputElement = requiredChild<HTMLInputElement>(
				row,
				".action-name",
			);
			nameInput.onfocus = (event: FocusEvent): void => {
				const input: EventTarget | null = event.currentTarget;
				if (!(input instanceof HTMLInputElement)) return;
				if (beginNameFocus(selected, id, input)) {
					selected = new Set<string>([id]);
					editingNameActionId = id;
					send("select-action", { actionId: id, multi: false });
				}
			};
			nameInput.onchange = (event: Event): void => {
				const input: EventTarget | null = event.currentTarget;
				if (input instanceof HTMLInputElement)
					send("action-update", {
						actionId: id,
						field: "name",
						value: input.value,
					});
			};
			bindChange<HTMLInputElement>(row, ".action-delay", "delayMs", id);
			bindChange<HTMLSelectElement>(row, ".action-button", "button", id);
			bindChange<HTMLInputElement>(row, ".coord-x", "screenX", id);
			bindChange<HTMLInputElement>(row, ".coord-y", "screenY", id);
			row
				.querySelectorAll<HTMLButtonElement>(".row-action")
				.forEach((button: HTMLButtonElement): void => {
					button.addEventListener("click", (): void => {
						const type: string | undefined = button.dataset.action;
						if (type === "move-up")
							send("move-action", { actionId: id, delta: -1 });
						if (type === "move-down")
							send("move-action", { actionId: id, delta: 1 });
						if (type === "duplicate")
							send("duplicate-action", { actionId: id });
						if (type === "delete") send("delete-action", { actionId: id });
					});
				});
		});
	if (editingName) restoreNameFocus(rows, editingName);
}

function requiredChild<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element: T | null = root.querySelector<T>(selector);
	if (!element) throw new Error(`Missing editor child: ${selector}`);
	return element;
}

function bindChange<T extends HTMLInputElement | HTMLSelectElement>(
	row: HTMLTableRowElement,
	selector: string,
	field: string,
	actionId: string,
): void {
	const input: T | null = row.querySelector<T>(selector);
	input?.addEventListener("change", (event: Event): void => {
		const target: EventTarget | null = event.currentTarget;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLSelectElement
		)
			send("action-update", { actionId, field, value: target.value });
	});
}

const click = (
	id: string,
	type: string,
	payload?: Record<string, unknown>,
): void => {
	$(id).addEventListener("click", (): void => send(type, payload));
};

listen?.<EditorSnapshot>("editor-snapshot", (event): void => {
	snapshot = event.payload;
	selected = new Set<string>(snapshot.selectedActionIds || []);
	render();
});
$<HTMLInputElement>("editorHeading").addEventListener(
	"change",
	(event: Event): void => {
		const target: EventTarget | null = event.currentTarget;
		if (target instanceof HTMLInputElement)
			send("rename", { value: target.value });
	},
);
click("recordBtn", "record");
click("stopRecordBtn", "stop-record");
click("runBtn", "run");
click("stopRunBtn", "stop");
click("showMapBtn", "map");
click("addClickBtn", "add-click");
click("addDelayBtn", "add-delay");
click("importBtn", "import");
