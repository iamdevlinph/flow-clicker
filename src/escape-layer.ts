export type EscapeAction =
	| "cancel-recording"
	| "hide-overlay"
	| "dismiss-layer"
	| "close-editor"
	| "dismiss-outside";

export function escapeAction(
	recording: boolean,
	overlay: boolean,
	layerOpen: boolean,
	editorOpen: boolean,
): EscapeAction {
	if (recording) return "cancel-recording";
	if (overlay) return "hide-overlay";
	if (layerOpen) return "dismiss-layer";
	return editorOpen ? "close-editor" : "dismiss-outside";
}
