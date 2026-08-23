import { moveItem } from './state-model.mjs';

export function moveFlow(flows, id, beforeId, groupId) {
  if (!flows.some((flow) => flow.id === id) || id === beforeId) return flows;
  return moveItem(flows, id, beforeId).map((flow) => flow.id === id ? { ...flow, groupId: groupId ?? null } : flow);
}

export function moveFlowByKey(flows, id, delta) {
  const flow = flows.find((candidate) => candidate.id === id);
  if (!flow) return flows;
  const peers = flows.filter((candidate) => (candidate.groupId ?? null) === (flow.groupId ?? null));
  const index = peers.indexOf(flow);
  const target = peers[index + delta];
  if (!target) return flows;
  return delta < 0 ? moveFlow(flows, id, target.id, flow.groupId) : moveFlow(flows, target.id, flow.id, flow.groupId);
}
