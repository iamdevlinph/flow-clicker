export const markerClass = (interactive: boolean, selected: boolean): string =>
	`marker${interactive ? " interactive" : ""}${selected ? " selected" : ""}`;

export function dismissOverlayOnEscape(
	event: KeyboardEvent,
	dismiss: () => void,
): boolean {
	if (event.key !== "Escape") return false;
	event.preventDefault();
	event.stopPropagation();
	dismiss();
	return true;
}
