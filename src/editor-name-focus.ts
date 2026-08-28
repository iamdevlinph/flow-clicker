type SelectableInput = { focus(): void; select(): void };
type InputRoot = { querySelector(selector: string): SelectableInput | null };

export function beginNameFocus(
	selected: ReadonlySet<string>,
	actionId: string,
	input: SelectableInput,
): boolean {
	if (selected.size === 1 && selected.has(actionId)) {
		input.select();
		return false;
	}
	return true;
}

export function restoreNameFocus(root: InputRoot, actionId: string): void {
	const input = root.querySelector(
		`tr[data-id="${CSS.escape(actionId)}"] .action-name`,
	);
	if (input) {
		input.focus();
		input.select();
	}
}
