// src/ui/fileMenu.js
// ---------------------------------------------------------------------------
// The "Datei" menu (leftmost toolbar element): New / Open / Save / Save As
// plus a recent-files section (File System Access API only — the fallback
// path has no persistent handles). Recents load asynchronously into the open
// panel.
// ---------------------------------------------------------------------------

import { t } from '../i18n/index.js';
import { createDropdown } from './dropdown.js';
import { supportsRecents } from '../io/fileSystem.js';

export function createFileMenu(actions) {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dropdown';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'toolbar-button toolbar-menu-trigger';
  trigger.textContent = t('menu.file');
  trigger.setAttribute('aria-label', t('menu.file'));
  trigger.addEventListener('mousedown', (event) => event.preventDefault());
  wrap.append(trigger);

  createDropdown({
    trigger,
    panelClassName: 'toolbar-popover toolbar-popover--menu',
    buildPanel(panel, close) {
      const item = (label, shortcut, onPick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toolbar-popover-option';
        const text = document.createElement('span');
        text.textContent = label;
        button.append(text);
        if (shortcut) {
          const hint = document.createElement('span');
          hint.className = 'menu-shortcut';
          hint.textContent = shortcut;
          button.append(hint);
        }
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          close();
          onPick();
        });
        return button;
      };

      const separator = () => {
        const line = document.createElement('div');
        line.className = 'menu-separator';
        line.setAttribute('aria-hidden', 'true');
        return line;
      };

      panel.append(
        item(t('file.new'), null, actions.newDocument),
        item(t('file.open'), t('shortcut.open'), actions.openDocument),
        item(t('file.save'), t('shortcut.save'), actions.save),
        item(t('file.saveAs'), null, actions.saveAs),
        item(t('file.backups'), null, actions.backups),
        separator(),
        item(t('file.importDocx'), null, actions.importDocx),
        item(t('file.exportDocx'), null, actions.exportDocx),
        separator(),
        item(t('file.pageSetup'), null, actions.pageSetup),
        item(t('file.print'), t('shortcut.print'), actions.print),
        separator(),
        item(t('file.shortcuts'), null, actions.shortcuts),
        item(t('file.settings'), null, actions.settings)
      );

      if (!supportsRecents) return;

      const label = document.createElement('span');
      label.className = 'toolbar-popover-label';
      label.textContent = t('file.recent');
      panel.append(label);

      // Recents come from IndexedDB — fill in once loaded (panel may already
      // be closed again by then, hence the isConnected check).
      actions.loadRecents().then((entries) => {
        if (!panel.isConnected) return;
        if (entries.length === 0) {
          const empty = document.createElement('span');
          empty.className = 'menu-empty';
          empty.textContent = t('file.noRecent');
          panel.append(empty);
          return;
        }
        for (const entry of entries) {
          panel.append(item(entry.name, null, () => actions.openRecent(entry)));
        }
      });
    },
  });

  return wrap;
}
