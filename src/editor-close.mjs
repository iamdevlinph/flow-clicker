export async function closeEditorWindow(hideOverlay, hideEditor, persistSize) {
  await hideOverlay();
  await persistSize(await hideEditor());
}

export async function handleEditorWindowClosed(size, hideOverlay, persistSize) {
  await hideOverlay();
  await persistSize(size);
}
