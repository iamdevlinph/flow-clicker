import { reorder } from "./state-model.js";
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

export function moveLibraryGroup(
	groups: LibraryGroup[],
	groupId: string,
	targetId: string,
): LibraryGroup[] {
	if (!groupId || !targetId || groupId === targetId) return groups;
	const from = groups.findIndex((group) => group.id === groupId);
	const to = groups.findIndex((group) => group.id === targetId);
	return from < 0 || to < 0 ? groups : reorder(groups, from, to);
}

export function moveLibraryGroupByKey(
	groups: LibraryGroup[],
	groupId: string,
	delta: number,
): LibraryGroup[] {
	const index = groups.findIndex((group) => group.id === groupId);
	const target = groups[index + delta];
	return target ? moveLibraryGroup(groups, groupId, target.id) : groups;
}
