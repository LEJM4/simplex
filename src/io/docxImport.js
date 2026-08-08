// src/io/docxImport.js
// ---------------------------------------------------------------------------
// DOCX import via mammoth (loaded on demand). mammoth converts Word files to
// SEMANTIC HTML on purpose: headings, lists, bold/italic/strike, tables-as-
// text — but no colors, fonts, sizes or alignment. That is the honest deal
// documented in the project plan: structure and text survive, visual layout
// partially does not. Underline is opt-in via styleMap (off by default in
// mammoth because underline often marks links).
//
// Import fidelity (1.2.0): mammoth's default style map only knows the ENGLISH
// built-in style ids/names ("Heading1" / "Heading 1") — a German Word file
// carries styleId "berschrift1" / name "Überschrift 1" and its headings
// arrived as plain paragraphs. mammoth never parses w:outlineLvl, so we read
// styles.xml ourselves (same fflate pattern as readDocxDefaultFont below),
// map styleId → heading level via w:outlineLvl (incl. w:basedOn inheritance)
// and rewrite matching paragraphs onto synthetic SwHeadingN style ids that
// the styleMap turns into h1–h3. Language-independent by design: outlineLvl
// is the semantic marker Word itself hangs its outline view on.
// Empty paragraphs are preserved (ignoreEmptyParagraphs: false — mammoth
// silently swallows them by default, deliberate blank lines vanished).
// Honest limits: w:spacing never reaches mammoth's paragraph model (verified
// against the pinned 1.12.0 body-reader) — paragraph spacing does not
// survive; and bold-large text WITHOUT a heading style stays a paragraph
// (no semantic marker to read).
//
// The imported document behaves like a NEW document: fresh editor mount
// (clean undo history), default document settings, untitled, marked dirty so
// the autosave safety net arms itself immediately.
// ---------------------------------------------------------------------------

import { unzipSync, strFromU8 } from 'fflate';

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { replaceDocSettings } from '../core/docSettings.js';
import { t } from '../i18n/index.js';
import { showDialog } from '../ui/dialogs/dialog.js';
import { supportsFileSystemAccess } from './fileSystem.js';
import { isTauri, pickOpenPath, readFileBytes } from './tauriFs.js';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** First concrete family of a CSS stack, quotes stripped ("'X', serif" → X). */
const firstStackName = (stack) =>
  String(stack).split(',')[0].trim().replace(/^['"]|['"]$/g, '');

/**
 * Word's document default typeface from styles.xml (feature 8): the
 * w:docDefaults run properties, overridden by the default paragraph style
 * (usually "Normal") — mammoth drops both, so we read the zip ourselves.
 * Namespace handling is deliberately tolerant (localName matching): prefixes
 * vary across producers. Returns { fontFamily, fontSizePt } with null where
 * nothing matched our font list; mergeDocumentSettings turns null/undefined
 * into the app defaults. Exported for the headless round-trip test.
 */
export function readDocxDefaultFont(arrayBuffer) {
  try {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const stylesXml = unzipSync(bytes)['word/styles.xml'];
    if (!stylesXml) return { fontFamily: null, fontSizePt: null };
    const xml = new DOMParser().parseFromString(strFromU8(stylesXml), 'application/xml');
    const all = [...xml.getElementsByTagName('*')];
    const firstLocal = (scope, name) =>
      scope ? [...scope.getElementsByTagName('*')].find((el) => el.localName === name) ?? null : null;
    const pick = (scope) => ({
      ascii: firstLocal(scope, 'rFonts')?.getAttribute('w:ascii') ?? null,
      halfPoints: firstLocal(scope, 'sz')?.getAttribute('w:val') ?? null,
    });
    let { ascii, halfPoints } = pick(all.find((el) => el.localName === 'rPrDefault'));
    const normal = all.find((el) =>
      el.localName === 'style' &&
      el.getAttribute('w:type') === 'paragraph' &&
      el.getAttribute('w:default') === '1');
    const override = pick(firstLocal(normal, 'rPr'));
    ascii = override.ascii ?? ascii;
    halfPoints = override.halfPoints ?? halfPoints;
    const fontFamily = settings.editor.fonts.find(
      (font) => firstStackName(font.css).toLowerCase() === String(ascii ?? '').toLowerCase()
    )?.css ?? null;
    const parsed = Number.parseFloat(halfPoints);
    return { fontFamily, fontSizePt: Number.isFinite(parsed) ? parsed / 2 : null };
  } catch {
    return { fontFamily: null, fontSizePt: null }; // unreadable → app defaults
  }
}

/**
 * styleId → heading level map from styles.xml (1.2.0): every paragraph style
 * whose effective w:outlineLvl (own value, or inherited through the
 * w:basedOn chain — cycle-safe) lands inside our heading range becomes a
 * candidate. outlineLvl is 0-based (0 → h1); w:val="9" means "body text" in
 * OOXML and is never a heading. Levels beyond settings.editor.headingLevels
 * are deliberately NOT mapped — an h4 import would silently degrade to a
 * paragraph in Tiptap (levels [1,2,3]), same as today via mammoth's default
 * map, so we keep that behaviour explicit instead of clamping and lying.
 * Namespace handling mirrors readDocxDefaultFont (localName matching).
 * Returns a plain object; unreadable input degrades to {}. Exported for the
 * headless round-trip test.
 */
export function readDocxOutlineStyles(arrayBuffer) {
  try {
    const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const stylesXml = unzipSync(bytes)['word/styles.xml'];
    if (!stylesXml) return {};
    const xml = new DOMParser().parseFromString(strFromU8(stylesXml), 'application/xml');
    const styles = new Map(); // styleId → { outlineLvl: number|null, basedOn: string|null }
    for (const el of xml.getElementsByTagName('*')) {
      if (el.localName !== 'style' || el.getAttribute('w:type') !== 'paragraph') continue;
      const styleId = el.getAttribute('w:styleId');
      if (!styleId) continue;
      let outlineLvl = null;
      let basedOn = null;
      for (const child of el.getElementsByTagName('*')) {
        if (child.localName === 'outlineLvl') {
          const parsed = Number.parseInt(child.getAttribute('w:val'), 10);
          if (Number.isFinite(parsed)) outlineLvl = parsed;
        } else if (child.localName === 'basedOn') {
          basedOn = child.getAttribute('w:val');
        }
      }
      if (!styles.has(styleId)) styles.set(styleId, { outlineLvl, basedOn });
    }
    const maxLevel = Math.max(...settings.editor.headingLevels);
    const resolve = (styleId) => {
      const seen = new Set();
      let current = styleId;
      while (current && !seen.has(current)) {
        seen.add(current);
        const entry = styles.get(current);
        if (!entry) return null;
        if (entry.outlineLvl !== null) return entry.outlineLvl;
        current = entry.basedOn;
      }
      return null; // no outlineLvl anywhere in the chain (or a cycle)
    };
    const map = {};
    for (const styleId of styles.keys()) {
      const outlineLvl = resolve(styleId);
      // 0-based outlineLvl 0..(maxLevel-1) → heading level 1..maxLevel.
      if (outlineLvl !== null && outlineLvl >= 0 && outlineLvl < maxLevel) {
        map[styleId] = outlineLvl + 1;
      }
    }
    return map;
  } catch {
    return {}; // unreadable → English default map still applies
  }
}

/** Synthetic style-id prefix for outline-detected headings (see styleMap). */
const HEADING_STYLE_PREFIX = 'SwHeading';

/** mammoth style mappings (exported for the headless round-trip test). */
export const DOCX_IMPORT_STYLE_MAP = [
  'u => u',
  // Word's <w:br type="page"/> → our pageBreak node. The class-targeted
  // <hr> parses with priority over horizontalRule's plain hr rule
  // (core/pageBreakNode.js), so dividers stay dividers.
  "br[type='page'] => hr.sw-page-break",
  // Headings (1.2.0): headingToStyleId below rewrites outline-level styles
  // onto synthetic ids — language-independent, unlike mammoth's default map
  // which only knows the English "Heading1"/"Heading 1". Custom rules are
  // checked before the default map (options-reader concat order, verified
  // against 1.12.0), so these win even when the English names WOULD match.
  ...settings.editor.headingLevels.map(
    (level) => `p.${HEADING_STYLE_PREFIX}${level} => h${level}:fresh`
  ),
  // Indents (feature 2): the paragraph transform rewrites indented body
  // paragraphs onto synthetic style ids; these entries turn them into
  // classed <p>s that core/indent.js parses back into the level attribute.
  // mammoth grammar: `p.X` matches the style ID (the bracket syntax only
  // exists for style-name) — verified against the pinned 1.12.0 parser.
  ...Array.from(
    { length: settings.editor.indentMaxLevels },
    (_, index) => `p.SwIndent${index + 1} => p.sw-indent-${index + 1}:fresh`
  ),
];

const TWIPS_PER_MM = 1440 / 25.4;

/**
 * mammoth document transform: mammoth parses Word's <w:ind> onto
 * paragraph.indent but its semantic HTML never emits it — so indented BODY
 * paragraphs get a synthetic style id here that the styleMap above turns
 * into a classed <p>. Twips snap to our level grid (indentStepMm), capped at
 * indentMaxLevels. Deliberately untouched: list paragraphs (their indent IS
 * the list level, which the list import already carries) and headings (a
 * rewritten style id would shadow mammoth's h1–h3 mapping — structure wins
 * over a rare indented heading). Exported for the headless round-trip test.
 */
export function indentToStyleId(paragraph) {
  if (paragraph.numbering) return paragraph;
  if (/heading|title/i.test(paragraph.styleName ?? '')) return paragraph;
  const startTwips = Number.parseFloat(paragraph.indent?.start);
  if (!Number.isFinite(startTwips) || startTwips <= 0) return paragraph;
  const level = Math.min(
    settings.editor.indentMaxLevels,
    Math.round(startTwips / TWIPS_PER_MM / settings.editor.indentStepMm)
  );
  if (level < 1) return paragraph;
  return { ...paragraph, styleId: `SwIndent${level}` };
}

/**
 * mammoth document transform: rewrite paragraphs whose style carries an
 * outline level onto the synthetic SwHeadingN ids from the styleMap above.
 * The styleName is rewritten too, so mammoth's own name-based default rules
 * can never race ours, and indentToStyleId's /heading|title/i guard keeps
 * matching. Numbered headings deliberately become plain headings (number
 * lost) rather than list items — identical to how mammoth's default map
 * treats English numbered headings (heading rules precede list rules).
 * Exported for the headless round-trip test.
 */
export function headingToStyleId(paragraph, outlineMap) {
  const level = outlineMap?.[paragraph.styleId];
  if (!level) return paragraph;
  return {
    ...paragraph,
    styleId: `${HEADING_STYLE_PREFIX}${level}`,
    styleName: `${HEADING_STYLE_PREFIX} ${level}`,
  };
}

/** The one true option set for mammoth.convertToHtml (app + tests).
 *  outlineMap comes from readDocxOutlineStyles; {} keeps legacy behaviour
 *  (English default map only), which is also what the older suite calls get.
 *  ignoreEmptyParagraphs: false — deliberate blank lines are content; the
 *  1.12.0 default silently drops every empty paragraph (forceWrite path in
 *  document-to-html.js verified). */
export function docxImportOptions(mammoth, outlineMap = {}) {
  return {
    styleMap: DOCX_IMPORT_STYLE_MAP,
    transformDocument: mammoth.transforms.paragraph((paragraph) => {
      const withHeading = headingToStyleId(paragraph, outlineMap);
      if (withHeading !== paragraph) return withHeading; // heading wins, never indented
      return indentToStyleId(paragraph);
    }),
    ignoreEmptyParagraphs: false,
  };
}

export function initDocxImport({ mountEditor, confirmDiscardIfDirty }) {
  const showError = (message) =>
    showDialog({
      title: t('file.errorTitle'),
      message,
      defaultValue: 'ok',
      buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
    });

  async function convertAndMount(arrayBuffer) {
    const mammothModule = await import('mammoth');
    const mammoth = mammothModule.default ?? mammothModule;
    // Heading detection is language-independent: styleId → level via
    // w:outlineLvl from styles.xml (mammoth itself never parses it).
    const outlineMap = readDocxOutlineStyles(arrayBuffer);
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      docxImportOptions(mammoth, outlineMap)
    );

    mountEditor(result.value || null);
    // Feature 8: the default typeface survives the trip via styles.xml.
    // Page geometry still resets (mammoth drops w:pgSz — known limit).
    const defaultFont = readDocxDefaultFont(arrayBuffer);
    replaceDocSettings({
      fontFamily: defaultFont.fontFamily ?? undefined,
      fontSizePt: defaultFont.fontSizePt ?? undefined,
    });
    appState.set('file', null);
    appState.set('autosave', null);
    // Imported content is not persisted anywhere yet → arm the safety net.
    appState.set('documentDirty', true);
    appState.emit('document:updated');

    if (result.messages?.length) {
      console.warn('[docx-import] mammoth messages:', result.messages);
      await showDialog({
        title: t('file.importWarningsTitle'),
        message: t('file.importWarnings'),
        defaultValue: 'ok',
        buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
      });
    }
  }

  async function importDocx() {
    if (!(await confirmDiscardIfDirty())) return;
    try {
      if (isTauri) {
        // Desktop (phase 6e part 3): native dialog + direct read instead of
        // the browser file input.
        const path = await pickOpenPath(
          t('file.docxPickerType'),
          settings.file.docxExtension
        );
        if (!path) return; // cancelled
        const bytes = await readFileBytes(path);
        // mammoth wants an ArrayBuffer of exactly the file's size — copy
        // defensively instead of trusting the Uint8Array's backing buffer.
        await convertAndMount(bytes.slice().buffer);
      } else if (supportsFileSystemAccess) {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: t('file.docxPickerType'),
              accept: { [DOCX_MIME]: [settings.file.docxExtension] },
            },
          ],
          multiple: false,
        });
        const file = await handle.getFile();
        await convertAndMount(await file.arrayBuffer());
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = settings.file.docxExtension;
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            await convertAndMount(await file.arrayBuffer());
          } catch (error) {
            console.error('[docx] import failed', error);
            await showError(t('file.importError'));
          }
        });
        input.click();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[docx] import failed', error);
        await showError(t('file.importError'));
      }
    }
  }

  return { importDocx };
}
