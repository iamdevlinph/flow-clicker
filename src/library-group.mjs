export function updateLibraryGroups(groups, groupId, rawName, newId) {
  const name = String(rawName ?? '').trim();
  if (!name) return null;
  return groupId
    ? groups.map((group) => group.id === groupId ? { ...group, name } : group)
    : [...groups, { id: newId, name, collapsed: false }];
}

export function toggleLibraryGroup(groups, groupId) {
  return groups.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group);
}
