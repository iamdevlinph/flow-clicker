import type { Flow, LibraryGroup } from "./types.js";

type FlowSummary = Pick<Flow, "id" | "name">;
type EscapeHtml = (value: string) => string;
type FlowMarkupOptions = {
	flow: FlowSummary;
	escapeHtml: EscapeHtml;
	selected?: boolean;
	combineSelected?: boolean;
	running?: boolean;
	playbackBlocked?: boolean;
};
type FlowLibraryOptions = {
	list: HTMLElement;
	groups: LibraryGroup[];
	flows: Flow[];
	selectedFlowId: string | null;
	combineQueue?: string[];
	runningFlowId?: string | null;
	search: string;
	escapeHtml: EscapeHtml;
	moveByKey: (flow: Flow, delta: number) => boolean;
	onSelect: (flow: Flow) => void;
	onSettings: (flow: Flow) => void;
	onPlay: (flow: Flow) => void;
	onToggleCombine: (flow: Flow, selected: boolean) => void;
	onToggleGroup: (groupId: string) => void;
	onMenu: (x: number, y: number, flow: Flow) => void;
	onEdit: (flow: Flow) => void;
	onRenameGroup: (groupId: string) => void;
	onDeleteGroup: (groupId: string) => void;
	onMoveBefore: (flowId: string | null, targetId: string) => void;
	onMoveToGroup: (flowId: string | null, groupId: string | null) => void;
	onCreateFlow: () => void;
	announce: (flow: Flow, direction: string) => void;
};

let draggedFlowId: string | null = null;

export function flowRowMarkup({
	flow,
	escapeHtml,
	combineSelected = false,
	running = false,
	playbackBlocked = false,
}: FlowMarkupOptions): string {
	return `<input class="flow-combine" type="checkbox" aria-label="Select ${escapeHtml(flow.name)} for combining"${combineSelected ? " checked" : ""}><button class="flow-play" type="button" title="${running ? "Playing" : "Play flow"}" aria-label="${running ? "Playing" : `Play ${escapeHtml(flow.name)}`}"${running || playbackBlocked ? " disabled" : ""}>${running ? "●" : "▶"}</button><div class="flow-main"><div class="flow-row-name">${escapeHtml(flow.name)}</div></div><div class="flow-row-actions"><button class="flow-settings" title="Playback settings" aria-label="Playback settings">⚙</button></div>`;
}

export function groupHeaderMarkup({
	group,
	escapeHtml,
	flowListId,
	search = "",
}: {
	group: LibraryGroup;
	escapeHtml: EscapeHtml;
	flowListId: string;
	search?: string;
}): string {
	const expanded = !group.collapsed || !!search;
	return `<button class="group-disclosure" type="button" aria-expanded="${expanded}" aria-controls="${escapeHtml(flowListId)}"><span class="group-chevron" aria-hidden="true">${expanded ? "▾" : "▸"}</span><strong>${escapeHtml(group.name)}</strong></button><span><button class="group-rename" type="button" title="Rename group" aria-label="Rename ${escapeHtml(group.name)}">✎</button><button class="group-delete" type="button" title="Delete group" aria-label="Delete ${escapeHtml(group.name)}">×</button></span>`;
}

export function renderFlowLibrary(options: FlowLibraryOptions): void {
	const {
		list,
		groups,
		flows,
		selectedFlowId,
		combineQueue = [],
		runningFlowId = null,
		search,
		escapeHtml,
		moveByKey,
		onSelect,
		onSettings,
		onPlay,
		onToggleCombine,
		onToggleGroup,
		onMenu,
		onEdit,
		onRenameGroup,
		onDeleteGroup,
		onMoveBefore,
		onMoveToGroup,
		onCreateFlow,
		announce,
	} = options;
	list.innerHTML = "";
	if (!flows.length) {
		list.innerHTML =
			'<div class="library-empty"><div class="empty-icon">＋</div><h3>No flows yet</h3><p>Create a flow to start recording and replaying physical clicks.</p><button class="primary" type="button">Create flow</button></div>';
		list
			.querySelector<HTMLButtonElement>("button")
			?.addEventListener("click", onCreateFlow);
		return;
	}
	const renderRows = (container: HTMLElement, groupId: string | null): void => {
		flows
			.filter((candidate: Flow) => (candidate.groupId ?? null) === groupId)
			.forEach((flow: Flow) => {
				if (search && !flow.name.toLowerCase().includes(search)) return;
				const row = document.createElement("div");
				const running = flow.id === runningFlowId;
				row.className = `flow-row${flow.id === selectedFlowId ? " selected" : ""}${running ? " playing" : ""}`;
				row.draggable = true;
				row.tabIndex = 0;
				row.role = "listitem";
				row.ariaLabel = flow.name;
				row.dataset.flowId = flow.id;
				row.innerHTML = flowRowMarkup({
					flow,
					escapeHtml,
					combineSelected: combineQueue.includes(flow.id),
					running,
					playbackBlocked: !!(runningFlowId && !running),
				});
				row.addEventListener("click", (event: MouseEvent) => {
					const target = event.target as Element | null;
					if (!target?.closest("button, input")) onSelect(flow);
				});
				row.addEventListener("dblclick", (event: MouseEvent) => {
					const target = event.target as Element | null;
					if (!target?.closest("button, input")) onEdit(flow);
				});
				row.addEventListener("keydown", (event: KeyboardEvent) => {
					if (["Enter", " "].includes(event.key) && event.target === row) {
						event.preventDefault();
						onSelect(flow);
						return;
					}
					if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
						return;
					event.preventDefault();
					if (!moveByKey(flow, event.key === "ArrowUp" ? -1 : 1)) return;
					document
						.querySelector<HTMLElement>(
							`[data-flow-id="${CSS.escape(flow.id)}"]`,
						)
						?.focus();
					announce(flow, event.key === "ArrowUp" ? "up" : "down");
				});
				row
					.querySelector<HTMLInputElement>(".flow-combine")
					?.addEventListener("click", (event: MouseEvent) =>
						event.stopPropagation(),
					);
				row
					.querySelector<HTMLInputElement>(".flow-combine")
					?.addEventListener("change", (event: Event) =>
						onToggleCombine(flow, (event.target as HTMLInputElement).checked),
					);
				row
					.querySelector<HTMLButtonElement>(".flow-play")
					?.addEventListener("click", (event: MouseEvent) => {
						event.stopPropagation();
						if (!running) onPlay(flow);
					});
				row
					.querySelector<HTMLButtonElement>(".flow-settings")
					?.addEventListener("click", (event: MouseEvent) => {
						event.stopPropagation();
						onSettings(flow);
					});
				row.addEventListener("contextmenu", (event: MouseEvent) => {
					event.preventDefault();
					onMenu(event.clientX, event.clientY, flow);
				});
				row.addEventListener("dragstart", (event: DragEvent) => {
					draggedFlowId = flow.id;
					if (event.dataTransfer) {
						event.dataTransfer.effectAllowed = "move";
						event.dataTransfer.setData("text/plain", flow.id);
					}
				});
				row.addEventListener("dragend", clearDragTargets);
				row.addEventListener("dragover", (event: DragEvent) => {
					event.preventDefault();
					event.stopPropagation();
					row.classList.add("drop-target");
				});
				row.addEventListener("dragleave", () =>
					row.classList.remove("drop-target"),
				);
				row.addEventListener("drop", (event: DragEvent) => {
					event.preventDefault();
					event.stopPropagation();
					onMoveBefore(
						event.dataTransfer?.getData("text/plain") || draggedFlowId,
						flow.id,
					);
					clearDragTargets();
				});
				container.appendChild(row);
			});
	};
	const ungrouped = document.createElement("div");
	ungrouped.className = "group-flow-list ungrouped-drop-area";
	ungrouped.dataset.groupId = "";
	renderRows(ungrouped, null);
	ungrouped.addEventListener("dragover", (event: DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		ungrouped.classList.add("drop-target");
	});
	ungrouped.addEventListener("dragleave", (event: DragEvent) => {
		if (
			!(event.relatedTarget instanceof Node) ||
			!ungrouped.contains(event.relatedTarget)
		)
			ungrouped.classList.remove("drop-target");
	});
	ungrouped.addEventListener("drop", (event: DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		onMoveToGroup(
			event.dataTransfer?.getData("text/plain") || draggedFlowId,
			null,
		);
		clearDragTargets();
	});
	list.appendChild(ungrouped);
	groups.forEach((group: LibraryGroup) => {
		const section = document.createElement("div");
		section.className = "library-group";
		section.dataset.groupId = group.id;
		const flowListId = `group-flows-${group.id}`;
		const expanded = !group.collapsed || !!search;
		section.innerHTML = `<div class="library-group-head">${groupHeaderMarkup({ group, escapeHtml, flowListId, search })}</div><div class="group-flow-list${expanded ? "" : " hidden"}" id="${escapeHtml(flowListId)}"></div>`;
		const head = section.querySelector<HTMLElement>(".library-group-head");
		const groupList = section.querySelector<HTMLElement>(".group-flow-list");
		if (!head || !groupList) return;
		head
			.querySelector(".group-disclosure")
			?.addEventListener("click", () => onToggleGroup(group.id));
		section
			.querySelector(".group-rename")
			?.addEventListener("click", () => onRenameGroup(group.id));
		section
			.querySelector(".group-delete")
			?.addEventListener("click", () => onDeleteGroup(group.id));
		head.addEventListener("dragover", (event: DragEvent) => {
			event.preventDefault();
			event.stopPropagation();
			head.classList.add("drop-target");
		});
		head.addEventListener("dragleave", () =>
			head.classList.remove("drop-target"),
		);
		head.addEventListener("drop", (event: DragEvent) => {
			event.preventDefault();
			event.stopPropagation();
			onMoveToGroup(
				event.dataTransfer?.getData("text/plain") || draggedFlowId,
				group.id,
			);
			clearDragTargets();
		});
		renderRows(groupList, group.id);
		list.appendChild(section);
	});
}

function clearDragTargets(): void {
	draggedFlowId = null;
	document
		.querySelectorAll<HTMLElement>(".drop-target")
		.forEach((element: HTMLElement) => {
			element.classList.remove("drop-target");
		});
}
