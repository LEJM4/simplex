// src/ui/dialogs/pageSetup.js
// ---------------------------------------------------------------------------
// "Page setup" dialog: paper format + orientation (feature 3), the four page
// margins (mm), header/footer text and the page numbers. Works on the document settings (core/docSettings.js) —
// OK merges the values via updateDocSettings(), which marks the document
// dirty; the on-screen sheet updates live through the CSS variables.
// ---------------------------------------------------------------------------

import { settings } from '../../config/settings.js';
import { appState } from '../../core/appState.js';
import { updateDocSettings } from '../../core/docSettings.js';
import { t, getLanguage } from '../../i18n/index.js';

const parseDecimal = (text) => {
  const value = Number.parseFloat(String(text).trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

export function showPageSetupDialog() {
  return new Promise((resolve) => {
    const current = appState.get('docSettings');
    const [minMm, maxMm] = settings.page.marginRangeMm;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const box = document.createElement('div');
    box.className = 'dialog dialog--form';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('pageSetup.title'));

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.textContent = t('pageSetup.title');

    /* Paper (feature 3): format + orientation, Word order — paper first,
       margins second. Labels from settings.page.formats are proper nouns. */
    const paperLabel = document.createElement('p');
    paperLabel.className = 'dialog-section-label';
    paperLabel.textContent = t('pageSetup.paper');

    const paperGrid = document.createElement('div');
    paperGrid.className = 'dialog-margin-grid';

    const selectField = (labelKey, options, value) => {
      const field = document.createElement('label');
      field.className = 'dialog-field';
      const caption = document.createElement('span');
      caption.textContent = t(labelKey);
      const select = document.createElement('select');
      select.className = 'dialog-input';
      for (const { value: optionValue, text } of options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = text;
        select.append(option);
      }
      select.value = value;
      field.append(caption, select);
      return { field, select };
    };

    const format = selectField(
      'pageSetup.format',
      settings.page.formats.map(({ id, label }) => ({ value: id, text: label })),
      current.pageFormat
    );
    const orientation = selectField(
      'pageSetup.orientation',
      settings.page.orientations.map((id) => ({
        value: id,
        text: t(`pageSetup.${id}`),
      })),
      current.pageOrientation
    );
    paperGrid.append(format.field, orientation.field);

    /* Margins ---------------------------------------------------------------*/
    const marginsLabel = document.createElement('p');
    marginsLabel.className = 'dialog-section-label';
    marginsLabel.textContent = t('pageSetup.margins');

    const marginGrid = document.createElement('div');
    marginGrid.className = 'dialog-margin-grid';
    const marginInputs = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const field = document.createElement('label');
      field.className = 'dialog-field';
      const caption = document.createElement('span');
      caption.textContent = t(`pageSetup.${side}`);
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.className = 'dialog-input';
      input.value = current.pageMarginsMm[side].toLocaleString(getLanguage());
      marginInputs[side] = input;
      field.append(caption, input);
      marginGrid.append(field);
    }

    /* Header / footer -------------------------------------------------------*/
    const textField = (labelKey, value) => {
      const field = document.createElement('label');
      field.className = 'dialog-field dialog-field--wide';
      const caption = document.createElement('span');
      caption.textContent = t(labelKey);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dialog-input';
      input.value = value;
      field.append(caption, input);
      return { field, input };
    };
    const header = textField('pageSetup.headerText', current.headerText);
    const footer = textField('pageSetup.footerText', current.footerText);

    /* First page different (feature 9): the letterhead case — page 1 gets
       its own header/footer and no page number. The two text fields grey
       out while the flag is off (same pattern as the number position while
       numbers are off); their values persist either way, exactly like Word
       keeps first-page header content around. */
    const firstToggle = document.createElement('label');
    firstToggle.className = 'dialog-checkbox';
    const firstCheckbox = document.createElement('input');
    firstCheckbox.type = 'checkbox';
    firstCheckbox.checked = current.firstPageDifferent === true;
    const firstCaption = document.createElement('span');
    firstCaption.textContent = t('pageSetup.firstPage');
    firstToggle.append(firstCheckbox, firstCaption);

    const firstHeader = textField('pageSetup.firstHeaderText', current.firstHeaderText);
    const firstFooter = textField('pageSetup.firstFooterText', current.firstFooterText);
    const firstHint = document.createElement('p');
    firstHint.className = 'dialog-hint';
    firstHint.textContent = t('pageSetup.firstPageHint');

    const syncFirstState = () => {
      firstHeader.input.disabled = !firstCheckbox.checked;
      firstFooter.input.disabled = !firstCheckbox.checked;
    };
    firstCheckbox.addEventListener('change', syncFirstState);
    syncFirstState();

    /* Page numbers (0.23.0): format with self-documenting example labels
       ("1", "– 1 –", "1 von 2", "Seite 1 von 2") plus the footer position.
       The position select is disabled while numbers are off. */
    const numberGrid = document.createElement('div');
    numberGrid.className = 'dialog-margin-grid';

    const formatField = document.createElement('label');
    formatField.className = 'dialog-field';
    const formatCaption = document.createElement('span');
    formatCaption.textContent = t('pageSetup.pageNumbers');
    const formatSelect = document.createElement('select');
    formatSelect.className = 'dialog-input';
    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = t('pageSetup.pageNumbersOff');
    formatSelect.append(offOption);
    for (const id of settings.page.numberFormats) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = t(`pageNumber.${id}`, { page: 1, pages: 2 });
      formatSelect.append(option);
    }
    formatSelect.value = current.pageNumberFormat;
    formatField.append(formatCaption, formatSelect);

    const positionField = document.createElement('label');
    positionField.className = 'dialog-field';
    const positionCaption = document.createElement('span');
    positionCaption.textContent = t('pageSetup.pageNumberPosition');
    const positionSelect = document.createElement('select');
    positionSelect.className = 'dialog-input';
    for (const position of settings.page.numberPositions) {
      const option = document.createElement('option');
      option.value = position;
      option.textContent = t(
        `pageSetup.position${position[0].toUpperCase()}${position.slice(1)}`
      );
      positionSelect.append(option);
    }
    positionSelect.value = current.pageNumberPosition;
    positionField.append(positionCaption, positionSelect);

    const syncPositionState = () => {
      positionSelect.disabled = formatSelect.value === 'off';
    };
    formatSelect.addEventListener('change', syncPositionState);
    syncPositionState();

    numberGrid.append(formatField, positionField);

    /* Buttons ---------------------------------------------------------------*/
    const row = document.createElement('div');
    row.className = 'dialog-buttons';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'dialog-button';
    cancelButton.textContent = t('file.cancel');
    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'dialog-button dialog-button--primary';
    okButton.textContent = t('dialog.ok');
    row.append(cancelButton, okButton);

    /* Document default typeface (feature 8). Marks stay absolute deviations:
       changing the default only re-dresses unmarked text — the hint says so. */
    const fontLabel = document.createElement('p');
    fontLabel.className = 'dialog-section-label';
    fontLabel.textContent = t('pageSetup.font');

    const fontGrid = document.createElement('div');
    fontGrid.className = 'dialog-margin-grid';
    const fontFamily = selectField(
      'pageSetup.fontFamily',
      settings.editor.fonts.map(({ css, label }) => ({ value: css, text: label })),
      current.fontFamily
    );
    const fontSizeField = document.createElement('label');
    fontSizeField.className = 'dialog-field';
    const fontSizeCaption = document.createElement('span');
    fontSizeCaption.textContent = t('pageSetup.fontSize');
    const fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'text';
    fontSizeInput.inputMode = 'decimal';
    fontSizeInput.className = 'dialog-input';
    fontSizeInput.value = current.fontSizePt.toLocaleString(getLanguage());
    fontSizeField.append(fontSizeCaption, fontSizeInput);
    fontGrid.append(fontFamily.field, fontSizeField);
    const fontHint = document.createElement('p');
    fontHint.className = 'dialog-hint';
    fontHint.textContent = t('pageSetup.fontHint');

    const finish = (applied) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(applied);
    };

    const applyAndClose = () => {
      const pageMarginsMm = {};
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const parsed = parseDecimal(marginInputs[side].value);
        const fallback = current.pageMarginsMm[side];
        const value = parsed === null ? fallback : Math.min(maxMm, Math.max(minMm, parsed));
        pageMarginsMm[side] = Math.round(value * 10) / 10;
      }
      // Same rules as the toolbar size field: half-point grid, clamped.
      const parsedSizePt = parseDecimal(fontSizeInput.value);
      const fontSizePt = parsedSizePt === null
        ? current.fontSizePt
        : Math.min(settings.editor.fontSizeMaxPt,
            Math.max(settings.editor.fontSizeMinPt, Math.round(parsedSizePt * 2) / 2));
      updateDocSettings({
        fontFamily: fontFamily.select.value,
        fontSizePt,
        pageFormat: format.select.value,
        pageOrientation: orientation.select.value,
        pageMarginsMm,
        headerText: header.input.value.trim(),
        footerText: footer.input.value.trim(),
        firstPageDifferent: firstCheckbox.checked,
        firstHeaderText: firstHeader.input.value.trim(),
        firstFooterText: firstFooter.input.value.trim(),
        pageNumberFormat: formatSelect.value,
        pageNumberPosition: positionSelect.value,
      });
      finish(true);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type === 'text') {
        event.preventDefault();
        applyAndClose();
      } else if (event.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusable = [...box.querySelectorAll('input, select, button')];
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

    cancelButton.addEventListener('click', () => finish(false));
    okButton.addEventListener('click', applyAndClose);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKeyDown, true);

    box.append(heading, paperLabel, paperGrid, marginsLabel, marginGrid, header.field, footer.field, firstToggle, firstHeader.field, firstFooter.field, firstHint, numberGrid, fontLabel, fontGrid, fontHint, row);
    overlay.append(box);
    document.body.append(overlay);
    format.select.focus(); // paper block sits first since 0.27.0
  });
}
