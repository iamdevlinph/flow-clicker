const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

export function normalizeHotkeyEvent(event) {
  const modifiers = MODIFIER_ORDER.filter((name) => event[{ Ctrl: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey' }[name]]);
  if (event.key === 'Escape' || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  let key = event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (/^\d$/.test(key) || /^F(?:[1-9]|1[0-2])$/.test(key) || key === ' ' || key === 'Enter') key = key === ' ' ? 'Space' : key;
  else return null;
  if (!modifiers.length && !/^F(?:[1-9]|1[0-2])$/.test(key)) return null;
  return [...modifiers, key].join('+');
}

export const hotkeysOverlap = (a, b) => a.split('+').at(-1) === b.split('+').at(-1) && (!a.includes('+') || !b.includes('+'));
