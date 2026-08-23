(() => {
  const root = document.getElementById('overlayRoot');
  const badge = document.getElementById('overlayBadge');
  let payload = { points: [], interactive: false, originX: 0, originY: 0 };
  const tauri = window.__TAURI__;
  if (!tauri) return;

  function render() {
    root.innerHTML = '';
    badge.textContent = payload.interactive ? 'FlowClicker · drag click points' : 'FlowClicker · click map';
    for (const point of payload.points || []) {
      const el = document.createElement('div');
      el.className = `marker${payload.interactive ? ' interactive' : ''}`;
      el.textContent = point.label;
      el.style.left = `${point.x - payload.originX}px`;
      el.style.top = `${point.y - payload.originY}px`;
      el.dataset.actionId = point.actionId;
      if (payload.interactive) installDrag(el);
      root.appendChild(el);
    }
  }

  function installDrag(el) {
    let dragging = false;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
    });
    el.addEventListener('pointerup', async (e) => {
      if (!dragging) return;
      dragging = false;
      try {
        await tauri.core.invoke('overlay_marker_moved', {
          actionId: el.dataset.actionId,
          screenX: Math.round(e.clientX + payload.originX),
          screenY: Math.round(e.clientY + payload.originY),
        });
      } catch (err) { console.error(err); }
    });
  }

  tauri.event.listen('overlay-points', (event) => {
    payload = event.payload;
    render();
  });
})();
