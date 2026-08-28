import type { LibraryGroup } from "./types.js";

export function updateLibraryGroups(
	groups: LibraryGroup[],
	groupId: string | null,
	rawName: unknown,
	newId: string,
): LibraryGroup[] | null {
	const name = String(rawName ?? "").trim();
	if (!name) return null;
	return groupId
		? groups.map((group) => (group.id === groupId ? { ...group, name } : group))
		: [...groups, { id: newId, name, collapsed: false }];
}

export function toggleLibraryGroup(
	groups: LibraryGroup[],
	groupId: string,
): LibraryGroup[] {
	return groups.map((group) =>
		group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
	);
}
