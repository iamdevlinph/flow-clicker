export const markerClass = (interactive, selected) => `marker${interactive ? ' interactive' : ''}${selected ? ' selected' : ''}`;

export function dismissOverlayOnEscape(event, dismiss) {
  if (event.key !== 'Escape') return false;
  event.preventDefault();
  event.stopPropagation();
  dismiss();
  return true;
}
