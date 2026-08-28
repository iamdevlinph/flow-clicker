const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];
type ModifierName = (typeof MODIFIER_ORDER)[number];
type ModifierKey = "ctrlKey" | "altKey" | "shiftKey" | "metaKey";
const MODIFIER_KEYS: Record<ModifierName, ModifierKey> = {
	Ctrl: "ctrlKey",
	Alt: "altKey",
	Shift: "shiftKey",
	Meta: "metaKey",
};

export function normalizeHotkeyEvent(event: KeyboardEvent): string | null {
	const modifiers = MODIFIER_ORDER.filter((name) => event[MODIFIER_KEYS[name]]);
	if (
		event.key === "Escape" ||
		["Control", "Alt", "Shift", "Meta"].includes(event.key)
	)
		return null;
	let key = event.key;
	if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
	else if (
		/^\d$/.test(key) ||
		/^F(?:[1-9]|1[0-2])$/.test(key) ||
		key === " " ||
		key === "Enter"
	)
		key = key === " " ? "Space" : key;
	else return null;
	if (!modifiers.length && !/^F(?:[1-9]|1[0-2])$/.test(key)) return null;
	return [...modifiers, key].join("+");
}

export const hotkeysOverlap = (a: string, b: string): boolean =>
	a.split("+").at(-1) === b.split("+").at(-1) &&
	(!a.includes("+") || !b.includes("+"));
