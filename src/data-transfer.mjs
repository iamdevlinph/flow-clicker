const VERSION = 3;

const isId = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const i32 = (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function validateAction(action, ids, nested = false) {
  if (!isObject(action) || !isId(action.id) || ids.has(action.id) || !isId(action.name)) throw new Error('Invalid or duplicate action ID');
  ids.add(action.id);
  if (action.type === 'click') {
    if (!own(action, ['type', 'id', 'name', 'screenX', 'screenY', 'relativeX', 'relativeY', 'windowTitle', 'button', 'delayMs'])
      || !i32(action.screenX) || !i32(action.screenY) || !integer(action.delayMs)
      || (action.button !== undefined && action.button !== 'left' && action.button !== 'right')
      || (action.relativeX != null && !i32(action.relativeX)) || (action.relativeY != null && !i32(action.relativeY))
      || (action.windowTitle != null && typeof action.windowTitle !== 'string')) throw new Error('Invalid click action');
    if (action.button === undefined) action.button = 'left';
    return;
  }
  if (action.type === 'delay') {
    if (!own(action, ['type', 'id', 'name', 'delayMs']) || !integer(action.delayMs)) throw new Error('Invalid delay action');
    return;
  }
  if (action.type === 'group' && !nested) {
    if (!own(action, ['type', 'id', 'name', 'repeatCount', 'actions']) || !integer(action.repeatCount, 1) || !Array.isArray(action.actions) || !action.actions.length) throw new Error('Invalid action group');
    action.actions.forEach((child) => validateAction(child, ids, true));
    return;
  }
  throw new Error('Invalid action type');
}

function validatePortable(value) {
  if (!isObject(value) || value.version !== VERSION || !Array.isArray(value.flows) || !Array.isArray(value.groups)
    || !own(value, ['version', 'flows', 'groups'])) throw new Error('Unsupported portable data version or shape');
  const ids = new Set();
  value.groups.forEach((group) => {
    if (!isObject(group) || !own(group, ['id', 'name', 'collapsed']) || !isId(group.id) || ids.has(group.id)
      || !isId(group.name) || typeof group.collapsed !== 'boolean') throw new Error('Invalid group');
    ids.add(group.id);
  });
  const groupIds = new Set(value.groups.map((group) => group.id));
  value.flows.forEach((flow) => {
    if (!isObject(flow) || !own(flow, ['id', 'name', 'actions', 'groupId', 'createdAt', 'updatedAt', 'combinedFrom']) || !isId(flow.id)
      || ids.has(flow.id) || !isId(flow.name) || !Array.isArray(flow.actions)
      || (flow.groupId !== null && (!isId(flow.groupId) || !groupIds.has(flow.groupId)))
      || typeof flow.createdAt !== 'string' || typeof flow.updatedAt !== 'string'
      || (flow.combinedFrom !== undefined && (!Array.isArray(flow.combinedFrom) || flow.combinedFrom.some((source) => !isObject(source) || !own(source, ['id', 'name']) || !isId(source.id) || !isId(source.name))))) throw new Error('Invalid flow');
    ids.add(flow.id);
    flow.actions.forEach((action) => validateAction(action, ids));
  });
  return structuredClone(value);
}

export function exportPortableData(state) {
  return JSON.stringify({ version: VERSION, flows: (state?.flows || []).map((flow) => {
    const { playback: _playback, ...portable } = structuredClone(flow);
    return portable;
  }), groups: structuredClone(state?.groups || []) }, null, 2);
}

export function parsePortableData(json) {
  let value;
  try { value = JSON.parse(json); } catch (_) { throw new Error('Invalid JSON'); }
  return validatePortable(value);
}

export function replaceWithPortableData(current, jsonOrData) {
  const imported = typeof jsonOrData === 'string' ? parsePortableData(jsonOrData) : validatePortable(jsonOrData);
  return {
    version: VERSION,
    editorSize: structuredClone(current?.editorSize ?? null),
    selectedFlowId: imported.flows[0]?.id ?? null,
    flows: structuredClone(imported.flows),
    groups: structuredClone(imported.groups),
    settings: structuredClone(current?.settings),
  };
}

export { VERSION, validatePortable };
