import type { Action } from "./types.js";

const escapeHtml = (value: unknown): string => {
	const entities: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"'": "&#39;",
		'"': "&quot;",
	};
	return String(value ?? "").replace(
		/[&<>'"]/g,
		(character: string): string => entities[character] ?? character,
	);
};

export const editorRowsHtml = (
	actions: readonly Action[] = [],
	highlightedIds: readonly string[] = [],
): string => {
	const highlighted: ReadonlySet<string> = new Set(highlightedIds);
	return actions
		.map((action: Action, index: number): string => {
			const isClick: boolean = action.type === "click";
			const target: string =
				action.type === "click"
					? action.windowTitle || "screen coordinates"
					: "";
			const button: "left" | "right" =
				action.type === "click" && action.button === "right" ? "right" : "left";
			const clickFields: string = isClick
				? `<input class="compact-input coord-x" type="number" value="${Number(action.type === "click" ? action.screenX : 0) || 0}"></td><td><input class="compact-input coord-y" type="number" value="${Number(action.type === "click" ? action.screenY : 0) || 0}"></td><td><select class="compact-input action-button" aria-label="Button for ${escapeHtml(action.name || "click")}"><option value="left"${button === "left" ? " selected" : ""}>Left</option><option value="right"${button === "right" ? " selected" : ""}>Right</option></select>`
				: "—</td><td>—</td><td>";
			const delayField: string =
				action.type === "group"
					? "Group"
					: `<span class="delay-input"><input class="compact-input action-delay" type="number" value="${Number(action.delayMs) || 0}"><span>ms</span></span>`;
			return `<tr data-id="${escapeHtml(action.id)}"${isClick && highlighted.has(action.id) ? ' class="action-selected"' : ""}><td>${index + 1}</td><td><span class="action-type ${escapeHtml(action.type)}">${escapeHtml(action.type)}</span></td><td><input class="compact-input action-name" value="${escapeHtml(action.name)}"></td><td>${clickFields}</td><td>${delayField}</td><td class="target-cell">${isClick ? `<button class="icon-btn target-info" type="button" title="${escapeHtml(target)}" aria-label="Target: ${escapeHtml(target)}">ⓘ</button>` : "—"}</td><td class="row-actions"><div class="row-action-group"><button class="icon-btn row-action" data-action="move-up" type="button" title="Move up" aria-label="Move ${escapeHtml(action.name || action.type)} up"${index === 0 ? " disabled" : ""}>↑</button><button class="icon-btn row-action" data-action="move-down" type="button" title="Move down" aria-label="Move ${escapeHtml(action.name || action.type)} down"${index === actions.length - 1 ? " disabled" : ""}>↓</button><button class="icon-btn row-action" data-action="duplicate" type="button" title="Duplicate action" aria-label="Duplicate ${escapeHtml(action.name || action.type)}">⧉</button><button class="icon-btn row-action danger-ghost" data-action="delete" type="button" title="Delete action" aria-label="Delete ${escapeHtml(action.name || action.type)}">×</button></div></td></tr>`;
		})
		.join("");
};
