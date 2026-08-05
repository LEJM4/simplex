// src/ui/dialogs/backups.js
// ---------------------------------------------------------------------------
// "Sicherungen" (feature 1, 0.25.0): list of every stored stand — the crash
// snapshot plus the time-spaced generations — newest first, radio selection.
// Two entry points:
//   - mode 'boot':   the last session ended unsaved. Runs BEFORE the editor
//                    mounts; the caller feeds the chosen content into the
//                    editor constructor (restore is not an undoable step).
//   - mode 'browse': Datei → Sicherungen …. The caller replaces the content
//                    as ONE transaction — Ctrl+Z brings the old state back
//                    (the dialog says so in its hint line).
// Resolves with the chosen snapshot record or null (dismissed / none).
// ---------------------------------------------------------------------------

import { settings } from '../../config/settings.js';
import { t, getLanguage } from '../../i18n/index.js';
import { listSnapshots } from '../../io/autosave.js';

export async function showBackupsDialog({ mode }) {
  const snapshots = await listSnapshots();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog dialog--form';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const title = mode === 'boot' ? t('restore.title') : t('backups.title');
    box.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.textContent = title;

    const hint = document.createElement('p');
    hint.className = 'dialog-hint dialog-hint--lead';
    hint.textContent =
      snapshots.length === 0
        ? t('backups.empty', { minutes: settings.autosave.generationMinutes })
        : mode === 'boot'
          ? t('backups.bootMessage')
          : t('backups.hint');

    /* Selection list ---------------------------------------------------------*/
    const list = document.createElement('div');
    list.className = 'dialog-backup-list';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', title);
    let selected = snapshots.length > 0 ? snapshots[0] : null;
    const items = [];

    const timeOf = (snapshot) =>
      new Date(snapshot.savedAt).toLocaleString(getLanguage(), {
        dateStyle: 'short',
        timeStyle: 'short',
      });

    for (const snapshot of snapshots) {
      const item = document.createElement('label');
      item.className = 'dialog-backup-item';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'sw-backup';
      radio.checked = snapshot === selected;
      radio.addEventListener('change', () => {
        selected = snapshot;
        for (const entry of items) {
          entry.el.classList.toggle('is-selected', entry.snapshot === snapshot);
        }
      });
      const text = document.createElement('span');
      const time = document.createElement('span');
      time.className = 'dialog-backup-time';
      time.textContent = timeOf(snapshot);
      const meta = document.createElement('span');
      meta.className = 'dialog-backup-meta';
      meta.textContent = `${snapshot.fileName ?? t('file.untitled')} · ${t(
        `backups.kind.${snapshot.kind}`
      )}`;
      text.append(time, meta);
      item.append(radio, text);
      item.classList.toggle('is-selected', snapshot === selected);
      items.push({ el: item, snapshot });
      list.append(item);
    }

    /* Buttons ----------------------------------------------------------------*/
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const finish = (value) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    };

    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.className = 'dialog-button';
    secondary.textContent = mode === 'boot' ? t('restore.discard') : t('backups.close');
    secondary.addEventListener('click', () => finish(null));

    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'dialog-button dialog-button--primary';
    primary.textContent = t('restore.restore');
    primary.disabled = snapshots.length === 0;
    primary.addEventListener('click', () => finish(selected));

    row.append(secondary, primary);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      } else if (event.key === 'Enter' && !primary.disabled) {
        event.preventDefault();
        finish(selected);
      } else if (event.key === 'Tab') {
        const focusable = [...box.querySelectorAll('input, button')];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    box.append(heading, hint, list, row);
    overlay.append(box);
    document.body.append(overlay);
    (snapshots.length > 0 ? items[0].el.querySelector('input') : secondary).focus();
  });
}
