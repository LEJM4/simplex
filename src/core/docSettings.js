// src/core/docSettings.js
// ---------------------------------------------------------------------------
// Document-level settings (page margins, header/footer text, page numbers,
// default typeface).
// They live in appState under 'docSettings', travel inside every .sdoc file
// and inside the autosave snapshot, and are mirrored into the --page-margin-*
// CSS variables so the on-screen sheet updates live.
//
// Two write paths on purpose:
//   replaceDocSettings(value)  — load path (open/new/restore): no dirty flag
//   updateDocSettings(partial) — user edits: marks the document dirty and
//                                re-arms the autosave snapshot
// ---------------------------------------------------------------------------

import { defaultDocumentSettings, mergeDocumentSettings, settings } from '../config/settings.js';
import { appState } from './appState.js';
import { t } from '../i18n/index.js';

/* Page numbers (0.23.0) --------------------------------------------------------
   One format vocabulary for all three consumers: the sheet strips in the
   editor (core/pageView.js), the print pipeline (@page margin boxes) and the
   DOCX footer. The template string with {page}/{pages} placeholders comes
   from i18n — two of the formats are language-dependent. */

/** Template for a document's page-number format ('' when numbers are off). */
export function pageNumberTemplate(docSettings) {
  const format = docSettings?.pageNumberFormat ?? 'off';
  return format === 'off' ? '' : t(`pageNumber.${format}`);
}

/** Rendered page-number text for the editor sheets ('' when off). */
export function formatPageNumber(docSettings, page, pages) {
  return pageNumberTemplate(docSettings)
    .replace('{page}', String(page))
    .replace('{pages}', String(pages));
}

/* First page different (feature 9) --------------------------------------------
   ONE source for the per-page header/footer chrome, mirroring the
   pageSizeMm() pattern: the sheet strips/overlays (core/pageView.js), the
   generated print CSS (io/pdfPrint.js → @page vs @page :first) and the DOCX
   parts (io/docxExport.js → default vs first header/footer) all derive from
   this helper instead of re-implementing the rule. While the flag is on,
   page 1 shows its own texts and NO page number (Word's titlePg semantics —
   the number belongs to the default footer). */

/** Effective header/footer chrome for a given page (1-based). */
export function pageChrome(docSettings, page) {
  const first = page === 1 && docSettings?.firstPageDifferent === true;
  return {
    headerText: (first ? docSettings?.firstHeaderText : docSettings?.headerText) ?? '',
    footerText: (first ? docSettings?.firstFooterText : docSettings?.footerText) ?? '',
    numberedPage: !first,
  };
}

/* Page geometry (feature 3) --------------------------------------------------
   ONE source of truth for the effective sheet size. Four consumers stay in
   sync through these two helpers: the on-screen sheet (CSS variables below),
   the page-view paginator (core/pageView.js), the print pipeline
   (io/pdfPrint.js) and the DOCX section (io/docxExport.js — which needs the
   PORTRAIT dimensions plus the orientation flag, because the docx library
   swaps width/height itself when it writes a landscape w:pgSz). */

/** The document's paper format entry from settings.page.formats (portrait
    dimensions; falls back to the app default for unknown/missing ids). */
export function pageFormatOf(docSettings) {
  const { formats, formatDefault } = settings.page;
  return (
    formats.find((format) => format.id === docSettings?.pageFormat) ??
    formats.find((format) => format.id === formatDefault)
  );
}

/** Effective page size in mm — width/height swapped in landscape. */
export function pageSizeMm(docSettings) {
  const format = pageFormatOf(docSettings);
  return docSettings?.pageOrientation === 'landscape'
    ? { widthMm: format.heightMm, heightMm: format.widthMm }
    : { widthMm: format.widthMm, heightMm: format.heightMm };
}

function applyToCss(docSettings) {
  const style = document.documentElement.style;
  const margins = docSettings.pageMarginsMm;
  style.setProperty('--page-margin-top', `${margins.top}mm`);
  style.setProperty('--page-margin-right', `${margins.right}mm`);
  style.setProperty('--page-margin-bottom', `${margins.bottom}mm`);
  style.setProperty('--page-margin-left', `${margins.left}mm`);
  // Sheet size follows the document since 0.27.0 (format + orientation).
  const size = pageSizeMm(docSettings);
  style.setProperty('--page-width', `${size.widthMm}mm`);
  style.setProperty('--page-min-height', `${size.heightMm}mm`);
  // Default typeface follows the document since 0.29.0 (feature 8). Both
  // consumers read these variables: the editor sheet (editor.css) and the
  // print mirror (print.css → .pagedjs_page_content). Headings are sized in
  // em, so they scale with the base everywhere; the DOCX default style reads
  // the same two fields in io/docxExport.js.
  style.setProperty('--content-font-family', docSettings.fontFamily);
  style.setProperty('--content-font-size', `${docSettings.fontSizePt}pt`);
}

export function initDocSettings() {
  appState.on('change:docSettings', ({ value }) => applyToCss(value));
  appState.set('docSettings', defaultDocumentSettings());
}

/** Load path — replaces the whole set without touching the dirty flag. */
export function replaceDocSettings(value) {
  appState.set('docSettings', mergeDocumentSettings(value));
}

/** User edit — merges, marks dirty, re-arms autosave. */
export function updateDocSettings(partial) {
  const current = appState.get('docSettings') ?? defaultDocumentSettings();
  const next = mergeDocumentSettings({
    ...current,
    ...partial,
    pageMarginsMm: { ...current.pageMarginsMm, ...(partial.pageMarginsMm ?? {}) },
  });
  appState.set('docSettings', next);
  appState.set('documentDirty', true);
  appState.emit('document:updated');
}
