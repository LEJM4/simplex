// src/ui/dialogs/settingsDialog.js
// ---------------------------------------------------------------------------
// App settings dialog (phase 6): UI language and theme. Both selects apply
// INSTANTLY (live preview — no OK/Cancel pair), the single button just
// closes. Because a language switch rebuilds the chrome while this dialog
// stays open, the dialog re-labels itself via the 'language:changed' event.
//
// Both values are app-level preferences (not document settings): language is
// persisted in IndexedDB by main.js, theme in localStorage by core/theme.js.
// ---------------------------------------------------------------------------

import { settings } from '../../config/settings.js';
import { appState } from '../../core/appState.js';
import { THEMES } from '../../core/theme.js';
import { t, getLanguage, setLanguage, getAvailableLanguages } from '../../i18n/index.js';

export function showSettingsDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog dialog--form dialog--settings';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';

    /* Language ---------------------------------------------------------------
       Option labels are the languages' native names (settings.js) — they do
       not change with the active language. */
    const languageField = document.createElement('label');
    languageField.className = 'dialog-field dialog-field--wide';
    const languageCaption = document.createElement('span');
    const languageSelect = document.createElement('select');
    languageSelect.className = 'dialog-input';
    for (const code of getAvailableLanguages()) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = settings.i18n.nativeNames[code] ?? code;
      languageSelect.append(option);
    }
    languageSelect.value = getLanguage();
    languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
    languageField.append(languageCaption, languageSelect);

    /* Theme ------------------------------------------------------------------*/
    const themeField = document.createElement('label');
    themeField.className = 'dialog-field dialog-field--wide';
    const themeCaption = document.createElement('span');
    const themeSelect = document.createElement('select');
    themeSelect.className = 'dialog-input';
    for (const value of THEMES) {
      const option = document.createElement('option');
      option.value = value;
      themeSelect.append(option);
    }
    themeSelect.value = appState.get('theme') ?? settings.view.themeDefault;
    themeSelect.addEventListener('change', () => appState.set('theme', themeSelect.value));
    themeField.append(themeCaption, themeSelect);

    /* Document view (0.23.0): pages ↔ continuous. Applies instantly like the
       other selects and stays in sync with the status-bar switch — both
       write appState 'viewMode' (persisted by main.js → initViewMode). */
    const viewField = document.createElement('label');
    viewField.className = 'dialog-field dialog-field--wide';
    const viewCaption = document.createElement('span');
    const viewSelect = document.createElement('select');
    viewSelect.className = 'dialog-input';
    for (const value of ['pages', 'pageless']) {
      const option = document.createElement('option');
      option.value = value;
      viewSelect.append(option);
    }
    const currentViewMode = () => appState.get('viewMode') ?? settings.pageView.defaultMode;
    viewSelect.value = currentViewMode();
    viewSelect.addEventListener('change', () => appState.set('viewMode', viewSelect.value));
    const offViewMode = appState.on('change:viewMode', () => {
      viewSelect.value = currentViewMode();
    });
    viewField.append(viewCaption, viewSelect);
    const viewHint = document.createElement('p');
    viewHint.className = 'dialog-hint';

    /* Typographic replacements (phase 7b) ------------------------------------*/
    const typographyField = document.createElement('label');
    typographyField.className = 'dialog-checkbox';
    const typographyInput = document.createElement('input');
    typographyInput.type = 'checkbox';
    typographyInput.checked = appState.get('typography') ?? settings.typography.enabled;
    const typographyCaption = document.createElement('span');
    typographyField.append(typographyInput, typographyCaption);
    typographyInput.addEventListener('change', () =>
      appState.set('typography', typographyInput.checked)
    );
    const typographyHint = document.createElement('p');
    typographyHint.className = 'dialog-hint';

    /* Inspection mode --------------------------------------------------------*/
    const inspectField = document.createElement('label');
    inspectField.className = 'dialog-checkbox';
    const inspectInput = document.createElement('input');
    inspectInput.type = 'checkbox';
    inspectInput.checked = appState.get('inspect') ?? settings.view.inspectDefault;
    const inspectCaption = document.createElement('span');
    inspectField.append(inspectInput, inspectCaption);
    inspectInput.addEventListener('change', () => appState.set('inspect', inspectInput.checked));
    const inspectHint = document.createElement('p');
    inspectHint.className = 'dialog-hint';

    /* Close ------------------------------------------------------------------*/
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'dialog-button dialog-button--primary';
    row.append(closeButton);

    /* Texts — rerunnable so a live language switch re-labels the open dialog. */
    const renderTexts = () => {
      box.setAttribute('aria-label', t('settings.title'));
      heading.textContent = t('settings.title');
      languageCaption.textContent = t('settings.language');
      themeCaption.textContent = t('settings.theme');
      for (const option of themeSelect.options) {
        option.textContent = t(`theme.${option.value}`);
      }
      viewCaption.textContent = t('settings.view');
      for (const option of viewSelect.options) {
        option.textContent = t(`view.${option.value}`);
      }
      viewHint.textContent = t('settings.viewHint');
      typographyCaption.textContent = t('settings.typography');
      typographyHint.textContent = t('settings.typographyHint');
      inspectCaption.textContent = t('settings.inspect');
      inspectHint.textContent = t('settings.inspectHint');
      closeButton.textContent = t('dialog.close');
    };
    renderTexts();
    const offLanguage = appState.on('language:changed', renderTexts);

    const finish = () => {
      offLanguage();
      offViewMode();
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(true);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusable = [...box.querySelectorAll('select, input, button')];
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && index === focusable.length - 1) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    };

    closeButton.addEventListener('click', finish);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener('keydown', onKeyDown, true);

    box.append(heading, languageField, themeField, viewField, viewHint, typographyField, typographyHint, inspectField, inspectHint, row);
    overlay.append(box);
    document.body.append(overlay);
    languageSelect.focus();
  });
}
