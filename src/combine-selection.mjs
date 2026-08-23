export const selectedFlows = (ids, flows) => ids.map((id) => flows.find((flow) => flow.id === id)).filter(Boolean);

export const selectionName = (flows) => flows.length ? `Combined — ${flows.map((flow) => flow.name).join(' + ')}`.slice(0, 120) : 'Combined flow';
