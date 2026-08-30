import type { Action } from "./types.js";

const escapeHtml = (value: unknown): string =>
	String(value ?? "").replace(
		/[&<>'"]/g,
		(ch) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
				ch
			] || ch,
	);

export const editorRowsHtml = (
	actions: readonly Action[] = [],
	highlightedIds: readonly string[] = [],
): string => {
	const highlighted = new Set(highlightedIds);
	return actions
		.map((action, index) => {
			const click = action.type === "click";
			const target = click ? action.windowTitle || "screen coordinates" : "";
			const button = click && action.button === "right" ? "right" : "left";
			const actionLabel = escapeHtml(action.name || action.type);
			const details = `${click ? `<label>X<input class="compact-input coord-x" type="number" value="${Number(action.screenX) || 0}"></label><label>Y<input class="compact-input coord-y" type="number" value="${Number(action.screenY) || 0}"></label><label>Button<select class="compact-input action-button" aria-label="Button for ${escapeHtml(action.name || "click")}"><option value="left"${button === "left" ? " selected" : ""}>Left</option><option value="right"${button === "right" ? " selected" : ""}>Right</option></select></label>` : ""}<label>Delay${action.type === "group" ? "<span>Group</span>" : `<span class="inline-unit"><input class="compact-input action-delay" type="number" value="${Number(action.delayMs) || 0}"><span class="unit">ms</span></span>`}</label>`;
			const targetMarkup = click
				? `<div class="target-cell" title="${escapeHtml(target)}">Target: ${escapeHtml(target)}</div>`
				: "";
			return `<article class="action-card action-${escapeHtml(action.type)}${click && highlighted.has(action.id) ? " action-selected" : ""}" data-id="${escapeHtml(action.id)}"><details class="action-card-accordion"><summary class="action-card-summary" aria-label="Details for ${actionLabel}"><span class="action-card-summary-content"><span class="action-number">${index + 1}</span><span class="action-type ${escapeHtml(action.type)}">${escapeHtml(action.type)}</span><label class="action-name-field"><input class="compact-input action-name" aria-label="Action name" value="${escapeHtml(action.name)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label></span></summary><div class="action-card-body"><div class="action-card-details">${details}</div>${targetMarkup}<div class="action-card-foot"><div class="row-action-group"><button class="icon-btn row-action" data-action="move-up" type="button" title="Move up" aria-label="Move ${actionLabel} up"${index === 0 ? " disabled" : ""}>↑</button><button class="icon-btn row-action" data-action="move-down" type="button" title="Move down" aria-label="Move ${actionLabel} down"${index === actions.length - 1 ? " disabled" : ""}>↓</button><button class="icon-btn row-action" data-action="duplicate" type="button" title="Duplicate action" aria-label="Duplicate ${actionLabel}">⧉</button><button class="icon-btn row-action danger-ghost" data-action="delete" type="button" title="Delete action" aria-label="Delete ${actionLabel}">×</button></div></div></div></details></article>`;
		})
		.join("");
};
