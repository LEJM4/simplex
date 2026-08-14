// src/io/pdfPrint.js
// ---------------------------------------------------------------------------
// Print/PDF pipeline via paged.js. Flow:
//   1. Take the document as static HTML (inline styles for marks/spacing
//      carry over) plus a generated stylesheet with the @page rules built
//      from the document settings (size, margins, header/footer, numbers).
//   2. Let paged.js lay it out into real pages inside a full-screen preview
//      overlay (content typography comes from print.css, scoped .print-root).
//   3. Open the browser print dialog — "Save as PDF" lives there.
// paged.js is loaded on demand (dynamic import) so the main bundle stays lean.
//
// Cleanup matters: paged.js injects <style> elements into <head>; the
// polisher removes them again on destroy(). 'afterprint' and Escape/close
// both funnel into the same cleanup.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { pageChrome, pageNumberTemplate, pageSizeMm } from '../core/docSettings.js';
import { t } from '../i18n/index.js';
import { showDialog } from '../ui/dialogs/dialog.js';

/** CSS string escape for generated content: "…". Preserves plain spaces —
 *  they carry meaning in page-number templates ("Seite " counter(page) …). */
const escapeCss = (text) =>
  String(text ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ');

/**
 * Turn a template like "Seite {page} von {pages}" into a CSS content value:
 *   "Seite " counter(page) " von " counter(pages)
 */
function templateToCssContent(template) {
  return template
    .split(/(\{page\}|\{pages\})/)
    .map((part) => {
      if (part === '{page}') return 'counter(page)';
      if (part === '{pages}') return 'counter(pages)';
      return part ? `"${escapeCss(part)}"` : null;
    })
    .filter(Boolean)
    .join(' ');
}

/** @page rules from the document settings (exported for tests). */
export function buildPrintCss(docSettings) {
  const { print } = settings;
  const size = pageSizeMm(docSettings); // format + orientation (0.27.0)
  const margins = docSettings.pageMarginsMm;
  const boxFont = `font-size: ${print.headerFooterFontSizePt}pt; color: ${print.headerFooterColor}; font-family: var(--font-ui);`;

  // Feature 9: running pages (2+) vs page 1 — pageChrome() is the shared
  // per-page rule (the sheet strips and the DOCX parts use the same one).
  const running = pageChrome(docSettings, 2);
  const first = pageChrome(docSettings, 1);

  const boxes = [];
  if (running.headerText) {
    boxes.push(`  @top-center { content: "${escapeCss(running.headerText)}"; ${boxFont} }`);
  }
  // Page numbers (0.23.0): format template + margin-box position from the
  // document settings. When the number sits left AND a footer text exists,
  // both share the @bottom-left box (concatenated content strings).
  const numberTemplate = pageNumberTemplate(docSettings);
  const numberContent = numberTemplate ? templateToCssContent(numberTemplate) : null;
  const numberPosition = docSettings.pageNumberPosition ?? 'center';
  if (numberContent && numberPosition === 'left' && running.footerText) {
    boxes.push(
      `  @bottom-left { content: "${escapeCss(running.footerText)}" "\\2002" ${numberContent}; ${boxFont} }`
    );
  } else {
    if (running.footerText) {
      boxes.push(`  @bottom-left { content: "${escapeCss(running.footerText)}"; ${boxFont} }`);
    }
    if (numberContent) {
      boxes.push(`  @bottom-${numberPosition} { content: ${numberContent}; ${boxFont} }`);
    }
  }

  /* @page :first (feature 9): overrides the boxes above for page 1 — own
     texts where set, `content: none` to CLEAR a box the general rule
     occupies. paged.js 0.4.3 rewrites :first margin boxes into
     higher-specificity .pagedjs_first_page selectors and additionally
     generates a display:none for none-boxes (verified in
     addMarginaliaContent) — boxes the general rule never set need no
     clearing. The page number is ALWAYS cleared on page 1 (Word's titlePg
     semantics: the number belongs to the default footer). */
  let firstRule = '';
  if (docSettings.firstPageDifferent === true) {
    const baseBottom = new Set();
    if (running.footerText || (numberContent && numberPosition === 'left')) baseBottom.add('left');
    if (numberContent && numberPosition !== 'left') baseBottom.add(numberPosition);

    const firstBoxes = [];
    if (first.headerText) {
      firstBoxes.push(`  @top-center { content: "${escapeCss(first.headerText)}"; ${boxFont} }`);
    } else if (running.headerText) {
      firstBoxes.push('  @top-center { content: none; }');
    }
    if (first.footerText) {
      firstBoxes.push(`  @bottom-left { content: "${escapeCss(first.footerText)}"; ${boxFont} }`);
    } else if (baseBottom.has('left')) {
      firstBoxes.push('  @bottom-left { content: none; }');
    }
    baseBottom.delete('left'); // handled either way above
    for (const box of baseBottom) {
      firstBoxes.push(`  @bottom-${box} { content: none; }`);
    }
    if (firstBoxes.length > 0) {
      firstRule = `@page :first {\n${firstBoxes.join('\n')}\n}\n`;
    }
  }

  return `@page {
  size: ${size.widthMm}mm ${size.heightMm}mm;
  margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
${boxes.join('\n')}
}
${firstRule}
/* Chunk-steering rules. They MUST live in THIS generated sheet: paged.js
   only runs the stylesheets passed to preview() through its breaks module
   (verified in pagedjs 0.4.3 previewer sources) — the static print.css
   styles the finished pages but never reaches the chunker. */
[data-sw-page-break] { break-after: page; }
h1, h2, h3 { break-after: avoid; }
tr { break-inside: avoid; }
img { break-inside: avoid; }

/* Empty paragraphs ARE content (Word semantics — a blank line is a blank
   line). But getHTML() serialises them as bare <p></p>: no inline content,
   no line box, height 0. ProseMirror's VIEW fills empty textblocks with a
   trailing <br> that never enters the document model, so the editor showed
   blank lines the print path silently collapsed — 38 blank lines on screen,
   zero in the PDF, and with them the whole page count. A zero-width space
   restores the line box; it inherits the block's own line-height, so
   per-paragraph line spacing stays exact. Must live in THIS sheet: the
   heights decide where the chunker breaks. Editor-safe — an empty paragraph
   there holds the <br> and is never :empty. */
p:empty::before,
h1:empty::before,
h2:empty::before,
h3:empty::before,
blockquote:empty::before { content: "\\200B"; }
`;
}

export function initPdfPrint(getEditor) {
  let printing = false;

  async function print() {
    if (printing) return;
    printing = true;

    const overlay = document.createElement('div');
    overlay.className = 'print-root';
    const status = document.createElement('div');
    status.className = 'print-status';
    status.textContent = t('print.preparing');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'print-close';
    closeButton.textContent = t('print.close');
    const pagesTarget = document.createElement('div');
    pagesTarget.className = 'print-pages';
    overlay.append(status, closeButton, pagesTarget);
    document.body.append(overlay);

    const cssUrl = URL.createObjectURL(
      new Blob([buildPrintCss(appState.get('docSettings'))], { type: 'text/css' })
    );

    let previewer = null;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', cleanup);
      document.removeEventListener('keydown', onKeyDown, true);
      URL.revokeObjectURL(cssUrl);
      try {
        previewer?.polisher?.destroy?.();
      } catch { /* best effort */ }
      overlay.remove();
      printing = false;
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
      }
    };
    closeButton.addEventListener('click', cleanup);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('afterprint', cleanup);

    try {
      const { Previewer } = await import('pagedjs');
      previewer = new Previewer();
      await previewer.preview(getEditor().getHTML(), [cssUrl], pagesTarget);
      if (finished) return; // closed while rendering
      status.remove();
      // Let the pages paint before the (blocking) print dialog opens.
      setTimeout(() => {
        if (!finished) window.print();
      }, 50);
    } catch (error) {
      console.error('[print] preview failed', error);
      cleanup();
      await showDialog({
        title: t('file.errorTitle'),
        message: t('print.error'),
        defaultValue: 'ok',
        buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
      });
    }
  }

  return { print };
}
