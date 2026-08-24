const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

export function normalizeHotkeyEvent(event) {
  const modifiers = MODIFIER_ORDER.filter((name) => event[{ Ctrl: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey' }[name]]);
  if (!modifiers.length || event.key === 'Escape' || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  let key = event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  else if (/^\d$/.test(key) || /^F(?:[1-9]|1[0-2])$/.test(key) || key === ' ' || key === 'Enter') key = key === ' ' ? 'Space' : key;
  else return null;
  return [...modifiers, key].join('+');
}
