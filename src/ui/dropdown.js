// src/ui/dropdown.js
// ---------------------------------------------------------------------------
// Minimal popover helper for toolbar dropdowns (color palettes, …).
// The trigger button must live inside a `.toolbar-dropdown` container; the
// panel is created lazily on open and removed on close. Closes on outside
// pointerdown, on Escape (focus returns to the trigger) and on demand via
// the `close` callback handed to `buildPanel`.
// ---------------------------------------------------------------------------

export function createDropdown({ trigger, buildPanel, panelClassName = 'toolbar-popover' }) {
  const container = trigger.closest('.toolbar-dropdown');
  let panel = null;

  const onOutsidePointerDown = (event) => {
    if (!container.contains(event.target)) close();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    }
  };

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  /* Popovers open left-aligned to their trigger; near the right window edge
     long labels (e.g. the table menu) would run off-screen and get clipped.
     Measure once after mounting and shift the panel back inside. */
  function clampToViewport() {
    const margin = 8;
    panel.style.left = '';
    const rect = panel.getBoundingClientRect();
    let shift = Math.min(0, window.innerWidth - margin - rect.right);
    if (rect.left + shift < margin) shift = margin - rect.left;
    if (shift !== 0) panel.style.left = `${shift}px`;
  }

  function open() {
    panel = document.createElement('div');
    panel.className = panelClassName;
    buildPanel(panel, close);
    container.append(panel);
    clampToViewport();
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => (panel ? close() : open()));

  return { close, isOpen: () => panel !== null };
}
