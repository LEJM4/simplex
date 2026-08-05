// src/ui/dialogs/shortcutsDialog.js
// ---------------------------------------------------------------------------
// "Keyboard shortcuts" overview (phase 6): grouped, read-only list of every
// binding in the app, rendered as key caps. The list below mirrors the ACTUAL
// bindings: app-level ones live in main.js / searchPanel.js, editor-level
// ones were verified against the pinned Tiptap 3.29.1 package sources
// (StarterKit, Highlight, TextAlign) plus our own extensions (image nudge
// 0.6.1, table Tab navigation 0.7.0). Update this list when bindings change.
//
// Labels and key combos are both i18n keys — combos differ per language
// ("Strg" vs "Ctrl"). Like the settings dialog, an open instance re-labels
// itself on a live language switch via 'language:changed'.
// ---------------------------------------------------------------------------

import { appState } from '../../core/appState.js';
import { t } from '../../i18n/index.js';

/** { title, items: [{ label, keys: [comboKey, …] }] } — all values i18n keys. */
const SECTIONS = [
  {
    title: 'menu.file',
    items: [
      { label: 'file.save', keys: ['shortcut.save'] },
      { label: 'file.open', keys: ['shortcut.open'] },
      { label: 'file.print', keys: ['shortcut.print'] },
    ],
  },
  {
    title: 'shortcuts.editing',
    items: [
      { label: 'toolbar.undo', keys: ['shortcut.undo'] },
      { label: 'toolbar.redo', keys: ['shortcut.redo', 'shortcut.redoAlt'] },
      { label: 'toolbar.pageBreak', keys: ['shortcut.pageBreak'] },
    ],
  },
  {
    title: 'toolbar.search',
    items: [
      { label: 'search.find', keys: ['shortcut.find'] },
      { label: 'search.replaceOne', keys: ['shortcut.replace'] },
      { label: 'shortcuts.findNext', keys: ['shortcut.enter'] },
      { label: 'shortcuts.findPrevious', keys: ['shortcut.shiftEnter'] },
      { label: 'search.close', keys: ['shortcut.escape'] },
    ],
  },
  {
    title: 'shortcuts.textFormat',
    items: [
      { label: 'toolbar.bold', keys: ['shortcut.bold'] },
      { label: 'toolbar.italic', keys: ['shortcut.italic'] },
      { label: 'toolbar.underline', keys: ['shortcut.underline'] },
      { label: 'toolbar.strike', keys: ['shortcut.strike'] },
      { label: 'toolbar.highlight', keys: ['shortcut.highlight'] },
      { label: 'toolbar.subscript', keys: ['shortcut.subscript'] },
      { label: 'toolbar.superscript', keys: ['shortcut.superscript'] },
      { label: 'toolbar.link', keys: ['shortcut.link'] },
      { label: 'toolbar.fontSizeDecrease', keys: ['shortcut.fontSizeDecrease'] },
      { label: 'toolbar.fontSizeIncrease', keys: ['shortcut.fontSizeIncrease'] },
      { label: 'toolbar.clearFormat', keys: ['shortcut.clearFormat'] },
    ],
  },
  {
    title: 'toolbar.paragraphFormat',
    items: [
      { label: 'paragraph.text', keys: ['shortcut.paragraphDefault'] },
      { label: 'paragraph.h1', keys: ['shortcut.h1'] },
      { label: 'paragraph.h2', keys: ['shortcut.h2'] },
      { label: 'paragraph.h3', keys: ['shortcut.h3'] },
      { label: 'paragraph.quote', keys: ['shortcut.quote'] },
      { label: 'shortcuts.hardBreak', keys: ['shortcut.shiftEnter'] },
    ],
  },
  {
    title: 'shortcuts.listsAlignment',
    items: [
      { label: 'toolbar.bulletList', keys: ['shortcut.bulletList'] },
      { label: 'toolbar.orderedList', keys: ['shortcut.orderedList'] },
      { label: 'toolbar.indentIncrease', keys: ['shortcut.indentIncrease'] },
      { label: 'toolbar.indentDecrease', keys: ['shortcut.indentDecrease'] },
      { label: 'shortcuts.indentTab', keys: ['shortcut.tab', 'shortcut.shiftTab'] },
      { label: 'toolbar.alignLeft', keys: ['shortcut.alignLeft'] },
      { label: 'toolbar.alignCenter', keys: ['shortcut.alignCenter'] },
      { label: 'toolbar.alignRight', keys: ['shortcut.alignRight'] },
      { label: 'toolbar.alignJustify', keys: ['shortcut.alignJustify'] },
    ],
  },
  {
    title: 'toolbar.table',
    items: [
      { label: 'shortcuts.nextCell', keys: ['shortcut.tab'] },
      { label: 'shortcuts.previousCell', keys: ['shortcut.shiftTab'] },
    ],
  },
  {
    title: 'shortcuts.image',
    items: [
      { label: 'shortcuts.imageNudge', keys: ['shortcut.altArrows'] },
      { label: 'shortcuts.imageDragCancel', keys: ['shortcut.escape'] },
    ],
  },
];

/** One combo ("Strg+Umschalt+S") → key caps joined by plus signs. */
function buildCombo(comboKey) {
  const wrap = document.createElement('span');
  wrap.className = 'shortcuts-combo';
  t(comboKey).split('+').forEach((part, index) => {
    if (index > 0) wrap.append('+');
    const cap = document.createElement('kbd');
    cap.className = 'shortcuts-kbd';
    cap.textContent = part;
    wrap.append(cap);
  });
  return wrap;
}

function buildSections() {
  return SECTIONS.map(({ title, items }) => {
    const section = document.createElement('section');
    section.className = 'shortcuts-section';

    const label = document.createElement('p');
    label.className = 'dialog-section-label';
    label.textContent = t(title);
    section.append(label);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'shortcuts-row';
      const name = document.createElement('span');
      name.textContent = t(item.label);
      const keys = document.createElement('span');
      keys.className = 'shortcuts-keys';
      item.keys.forEach((comboKey, index) => {
        if (index > 0) {
          const or = document.createElement('span');
          or.className = 'shortcuts-or';
          or.textContent = '/';
          keys.append(or);
        }
        keys.append(buildCombo(comboKey));
      });
      row.append(name, keys);
      section.append(row);
    }
    return section;
  });
}

export function showShortcutsDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog dialog--form dialog--shortcuts';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';

    // Focusable so arrow keys scroll the (potentially long) list.
    const body = document.createElement('div');
    body.className = 'shortcuts-body';
    body.tabIndex = 0;

    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'dialog-button dialog-button--primary';
    row.append(closeButton);

    /* Texts — rerunnable so a live language switch re-labels the open dialog. */
    const renderTexts = () => {
      box.setAttribute('aria-label', t('shortcuts.title'));
      heading.textContent = t('shortcuts.title');
      body.replaceChildren(...buildSections());
      closeButton.textContent = t('dialog.close');
    };
    renderTexts();
    const offLanguage = appState.on('language:changed', renderTexts);

    const finish = () => {
      offLanguage();
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(true);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog (scroll area + close button).
        const focusable = [body, closeButton];
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          closeButton.focus();
        } else if (!event.shiftKey && index === focusable.length - 1) {
          event.preventDefault();
          body.focus();
        }
      }
    };

    closeButton.addEventListener('click', finish);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener('keydown', onKeyDown, true);

    box.append(heading, body, row);
    overlay.append(box);
    document.body.append(overlay);
    closeButton.focus();
  });
}
