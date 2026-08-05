// src/ui/dialogs/dialog.js
// ---------------------------------------------------------------------------
// Minimal modal dialog: title, message, buttons → Promise<value>.
// Escape and clicking the backdrop resolve with `defaultValue` (callers pick
// the non-destructive option there). Focus starts on the primary button and
// Tab cycles inside the dialog.
// ---------------------------------------------------------------------------

export function showDialog({ title, message, buttons, defaultValue = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.textContent = title;

    const text = document.createElement('p');
    text.className = 'dialog-message';
    text.textContent = message;

    const row = document.createElement('div');
    row.className = 'dialog-buttons';

    const finish = (value) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    };

    const buttonElements = buttons.map(({ label, value, primary }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dialog-button' + (primary ? ' dialog-button--primary' : '');
      button.textContent = label;
      button.addEventListener('click', () => finish(value));
      row.append(button);
      return button;
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(defaultValue);
      } else if (event.key === 'Tab') {
        // Tiny focus trap: cycle through the dialog buttons.
        const index = buttonElements.indexOf(document.activeElement);
        const next = event.shiftKey
          ? (index <= 0 ? buttonElements.length - 1 : index - 1)
          : (index === buttonElements.length - 1 ? 0 : index + 1);
        event.preventDefault();
        buttonElements[next].focus();
      }
    };

    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish(defaultValue);
    });
    document.addEventListener('keydown', onKeyDown, true);

    box.append(heading, text, row);
    overlay.append(box);
    document.body.append(overlay);

    (buttonElements.find((_, i) => buttons[i].primary) ?? buttonElements[0])?.focus();
  });
}
