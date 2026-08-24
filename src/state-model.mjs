import { normalizePlayback } from './playback-form.mjs';

export const playbackDefaults = Object.freeze({
  playbackSpeed: 1, repeatMode: 'cycles', repeatValue: 1, repeatUnit: 'seconds',
  settleMs: 12, holdMs: 30, restoreCursor: false, focusTargetWindow: true, untilTime: null,
});

export function normalizeEditorSize(size) {
  if (typeof size?.width !== 'number' || typeof size?.height !== 'number'
    || !Number.isFinite(size.width) || !Number.isFinite(size.height)
    || size.width <= 0 || size.height <= 0) return null;
  return { width: size.width, height: size.height };
}

export const actionClickCount = (action) => action.type === 'click' ? 1
  : action.type === 'group' ? (action.actions ?? []).reduce((n, child) => n + actionClickCount(child), 0) * Math.max(1, Number(action.repeatCount) || 1) : 0;

export const flattenActions = (actions = []) => actions.flatMap((action) => action.type === 'group' ? flattenActions(action.actions) : [action]);
export const actionById = (actions = [], id) => {
  for (const action of actions) { if (action.id === id) return action; if (action.type === 'group') { const found = actionById(action.actions, id); if (found) return found; } }
  return null;
};
export const actionDelay = (action) => action.type === 'group'
  ? (action.actions ?? []).reduce((n, child) => n + actionDelay(child), 0) * Math.max(1, Number(action.repeatCount) || 1)
  : Math.max(0, Number(action.delayMs) || 0);
export const effectiveClickCount = (flow) => (flow?.actions ?? []).reduce((n, action) => n + actionClickCount(action), 0);

export function copyAction(action, id = () => crypto.randomUUID()) {
  const copy = structuredClone(action);
  copy.id = typeof id === 'function' ? id() : id;
  if (copy.type === 'group') copy.actions = (copy.actions ?? []).map((child) => copyAction(child, id));
  return copy;
}

export function copyActions(actions, id = () => crypto.randomUUID()) { return (actions ?? []).map((action) => copyAction(action, id)); }

export function groupContiguous(actions, ids, id = () => crypto.randomUUID()) {
  const selected = new Set(ids);
  const indexes = actions.map((action, index) => selected.has(action.id) ? index : -1).filter((index) => index >= 0);
  if (!indexes.length || indexes.some((index, i) => i && index !== indexes[i - 1] + 1)) return null;
  const children = actions.slice(indexes[0], indexes.at(-1) + 1);
  if (children.some((action) => action.type === 'group')) return null;
  return { index: indexes[0], group: { id: id(), type: 'group', name: 'Group', repeatCount: 1, actions: copyActions(children, id) } };
}

export function ungroupAction(actions, groupId) {
  const index = actions.findIndex((action) => action.id === groupId && action.type === 'group');
  if (index < 0) return null;
  const group = actions[index];
  return { index, actions: copyActions(group.actions) };
}

export function reorder(items, from, to) {
  const result = items.slice();
  if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
  const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}

export function combineFlows(flows, id = () => crypto.randomUUID()) {
  const sources = (flows ?? []).filter(Boolean);
  if (!sources.length) return null;
  return {
    id: id(), name: `Combined — ${sources.map((flow) => flow.name).join(' + ')}`,
    actions: copyActions(sources.flatMap((flow) => flow.actions ?? []), id),
    playback: { ...playbackDefaults, ...(sources[0].playback ?? {}) }, groupId: sources[0].groupId ?? null,
  };
}

export function migrateState(input) {
  const state = structuredClone(input ?? {});
  state.version = 3;
  state.editorSize = normalizeEditorSize(state.editorSize);
  state.groups = (Array.isArray(state.groups) ? state.groups : []).map((group) => ({ ...group, collapsed: group.collapsed === true }));
  state.settings = {
    recordHotkey: state.settings?.recordHotkey ?? 'Alt+Shift+R',
    playbackHotkey: state.settings?.playbackHotkey ?? 'Alt+Shift+P',
  };
  state.flows = (Array.isArray(state.flows) ? state.flows : []).map((flow) => ({
    ...flow, groupId: flow.groupId ?? null, actions: Array.isArray(flow.actions) ? flow.actions : [],
    playback: normalizePlayback({ ...playbackDefaults, ...(input?.version >= 3 ? flow.playback : input?.settings ?? {}) }),
  }));
  state.selectedFlowId = state.flows.some((flow) => flow.id === state.selectedFlowId) ? state.selectedFlowId : (state.flows[0]?.id ?? null);
  return state;
}

export function moveItem(items, id, beforeId) {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0 || id === beforeId) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  const to = beforeId == null ? copy.length : copy.findIndex((candidate) => candidate.id === beforeId);
  copy.splice(to < 0 ? copy.length : to, 0, item);
  return copy;
}

export function nextDeadline(time, now = new Date()) {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const deadline = new Date(now);
  deadline.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (deadline <= now) deadline.setDate(deadline.getDate() + 1);
  return deadline.getTime();
}
