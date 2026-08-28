import type { EditorSize } from "./types.js";

type AsyncAction = () => Promise<void>;
type PersistSize = (size: EditorSize) => Promise<void>;

export async function closeEditorWindow(
	hideOverlay: AsyncAction,
	hideEditor: () => Promise<EditorSize>,
	persistSize: PersistSize,
): Promise<void> {
	await hideOverlay();
	await persistSize(await hideEditor());
}

export async function handleEditorWindowClosed(
	size: EditorSize,
	hideOverlay: AsyncAction,
	persistSize: PersistSize,
): Promise<void> {
	await hideOverlay();
	await persistSize(size);
}
