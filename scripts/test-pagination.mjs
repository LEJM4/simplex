// scripts/test-pagination.mjs
// ---------------------------------------------------------------------------
// Headless verification of the page-view work (phase 9 + 7c):
//
//   PART 1 — computeBreaks() rule core with synthetic metrics (pure math):
//            orphan/widow control, keep-with-next chains, float anchors,
//            oversize stretching, forced breaks, margin trims, progress.
//   PART 2 — pageBreak node inside a real jsdom editor: Ctrl+Enter beats the
//            pinned HardBreak binding, paragraph splitting, undo in one step.
//   PART 3 — DOCX round trip: export writes <w:br w:type="page"/>, the
//            mammoth styleMap brings it back as a pageBreak node, and a
//            plain <hr> still parses as horizontalRule (no rule collision).
//
//   node scripts/test-pagination.mjs
//
//   PART 4 — backup generations (feature 1): rotation spacing, pre-save
//            guard, pruning and listing order on fake-indexeddb.
//
//   PART 6 — page format & orientation (feature 3): pageSizeMm swap,
//            docSettings migration, @page size in the print CSS and the
//            DOCX section (pgSz dimensions + w:orient, docx self-swap).
//
//   PART 5 — clear formatting + indents (feature 2): level grid parsing,
//            per-node stepping with clamps, Tab semantics (paragraph start
//            only; lists sink, tables navigate), clearFormatting resets,
//            DOCX indent out (twips) and back in (mammoth transform).
//
//   PART 7 — document default typeface (feature 8): docSettings migration
//            (degrade/snap/clamp), --content-font-* CSS variables, DOCX
//            default style + scaled headings out, styles.xml defaults back
//            in (docDefaults, Normal override, unknown-font degrade).
//
//   PART 8 — first page different (feature 9): docSettings migration and
//            degrade, the pageChrome() per-page rule, @page :first overrides
//            (incl. the merged-left footer case) and the DOCX titlePg parts
//            resolved via the relationships.
//
//   PART 9 — .sdoc format gate (release point 10): v1 round trip, the
//            unsupported-version error for newer generations (plain JSON and
//            inside the legacy ZIP envelope) and invalid-container for junk.
//
//   PART 10 — pending marks (0.31.1): font formatting on EMPTY blocks —
//            CellSelection seeding, seed → stored marks → real marks on
//            first input, seed cleanup, re-seed on emptying, clear
//            formatting, `.sdoc` round trip + unknown-attr tolerance.
//
//   PART 11 — margin click (0.31.1): pure clamp mapping into the content
//            column plus the mousedown wiring against a stubbed layout
//            (real posAtCoords needs rects jsdom does not have).
//
//   PART 12 — pages base-path tripwires (0.32.0/0.33.0): manifest/index.html/
//            sw.js/registration/vite.config stay base-agnostic, the deploy
//            workflow keeps its test gate, and the LANDING PAGE links the
//            app relative, roots nothing at / and loads nothing from third
//            parties (that guards its own privacy line). String guards —
//            the real proof is the base-path build in CI.
//
//   PART 13 — WebKit foundation (point 14): classifyPlatform() fixtures for
//            every platform family (iPadOS "MacIntel" masquerade, CriOS
//            engine truth, WebView2 stays Blink, garbage input degrades),
//            plus string tripwires: every vh cap has its svh twin, the
//            coarse-pointer 16px block exists, tap-highlight/touch-action
//            are set and the module is wired into the boot. jsdom has no
//            layout — the real proof is the 1.1.0 device protocol.
//
//   PART 14 — DOCX import fidelity (1.2.0): readDocxOutlineStyles maps
//            styleId → heading level via w:outlineLvl from a synthetic
//            GERMAN Word file (styleId "berschrift1", basedOn inheritance,
//            cycle tolerance, val=9 body-text and beyond-h3 excluded, purity,
//            garbage degrade), and the full mammoth round trip: German
//            headings become h1/h2, empty paragraphs survive
//            (ignoreEmptyParagraphs: false), an indented heading stays a
//            heading (transform order), no unrecognised-style warning for
//            mapped ids, and the editor parses the result.
//
// Part 2/3 need jsdom, part 4 needs fake-indexeddb — exact devDependencies
// since 0.29.2: npm ci installs them, the lockfile freezes their transitives
// (the 0.29.0 selector-engine lesson).
// Without them (npm i --omit=dev) those parts are skipped with a warning.
// ---------------------------------------------------------------------------

import { computeBreaks } from '../src/core/paginator.js';

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const OPTS = {
  contentHeight: 1000,
  minOrphanLines: 2,
  minWidowLines: 2,
  keepHeadingWithNext: true,
  epsilonPx: 0.5,
  stretchOversize: true,
};

/** Unit factory with sane defaults. Positions are synthetic but ordered. */
let nextPos = 0;
const unit = (top, bottom, extra = {}) => {
  const pos = nextPos;
  nextPos += 10;
  return {
    pos,
    end: pos + 10,
    top,
    bottom,
    marginTopPx: 0,
    marginBottomPx: 0,
    type: 'text',
    keepWithNext: false,
    splittable: false,
    floatBottom: null,
    ...extra,
  };
};
const resetPos = () => {
  nextPos = 0;
};

/** Even synthetic lines for a splittable unit. */
const evenLines = (u, count) => {
  const height = (u.bottom - u.top) / count;
  return Array.from({ length: count }, (_, k) => ({
    top: u.top + k * height,
    bottom: u.top + (k + 1) * height,
    pos: u.pos + 1 + k, // synthetic inline positions
  }));
};

console.log('PART 1 — computeBreaks rule core');

/* 1. Simple block break */
{
  resetPos();
  const units = [unit(0, 400), unit(400, 800), unit(800, 1200)];
  const r = computeBreaks(units, OPTS, () => []);
  check('block break before the third block',
    r.pages === 2 && r.breaks.length === 1 &&
    r.breaks[0].kind === 'block' && r.breaks[0].pos === units[2].pos,
    JSON.stringify(r.breaks));
  check('filler equals the leftover strip', Math.abs(r.breaks[0].fillPx - 200) < 0.01);
}

/* 2. Plain line split */
{
  resetPos();
  const u = unit(0, 1500, { splittable: true });
  const lines = evenLines(u, 15);
  const r = computeBreaks([u], OPTS, () => lines);
  check('paragraph splits after line 10',
    r.breaks.length === 1 && r.breaks[0].kind === 'split' &&
    r.breaks[0].pos === lines[10].pos && r.pages === 2,
    JSON.stringify(r.breaks));
}

/* 3. Orphan control: fewer than 2 lines would stay → whole block moves */
{
  resetPos();
  const a = unit(0, 850);
  const b = unit(850, 1350, { splittable: true });
  const r = computeBreaks([a, b], OPTS, () => evenLines(b, 5)); // 100px lines
  check('orphan rule moves the whole paragraph',
    r.breaks.length === 1 && r.breaks[0].kind === 'block' && r.breaks[0].pos === b.pos,
    JSON.stringify(r.breaks));
}

/* 4. Widow control: one line would travel → a second one is pulled along */
{
  resetPos();
  const a = unit(0, 450);
  const b = unit(450, 1000, { splittable: true }); // 5 lines of 110px
  const lines = evenLines(b, 5); // bottoms: 560,670,780,890,1000
  // Force a widow: extend the block so exactly 1 line overflows.
  b.bottom = 1050;
  const lines2 = [
    { top: 450, bottom: 560, pos: b.pos + 1 },
    { top: 560, bottom: 670, pos: b.pos + 2 },
    { top: 670, bottom: 780, pos: b.pos + 3 },
    { top: 780, bottom: 890, pos: b.pos + 4 },
    { top: 890, bottom: 1050, pos: b.pos + 5 }, // only this one overflows
  ];
  void lines;
  const r = computeBreaks([a, b], OPTS, () => lines2);
  check('widow rule pulls a second line over',
    r.breaks.length === 1 && r.breaks[0].kind === 'split' &&
    r.breaks[0].pos === lines2[3].pos,
    JSON.stringify(r.breaks));
}

/* 5. Keep-with-next: heading never dangles, chains walk back */
{
  resetPos();
  const a = unit(0, 880);
  const h2 = unit(880, 930, { keepWithNext: true });
  const h3 = unit(930, 980, { keepWithNext: true });
  const t = unit(980, 1400, { splittable: true });
  const r = computeBreaks([a, h2, h3, t], OPTS, () => evenLines(t, 4));
  check('heading chain moves together',
    r.breaks.length === 1 && r.breaks[0].pos === h2.pos,
    JSON.stringify(r.breaks));
}

/* 6. Forced break via pageBreak node */
{
  resetPos();
  const a = unit(0, 300);
  const br = unit(300, 312, { type: 'pageBreak' });
  const b = unit(312, 700);
  const r = computeBreaks([a, br, b], OPTS, () => []);
  check('pageBreak forces a new page',
    r.pages === 2 && r.breaks[0].kind === 'forced' && r.breaks[0].pos === br.end,
    JSON.stringify(r.breaks));
  check('forced filler runs to the page end', Math.abs(r.breaks[0].fillPx - 688) < 0.01);
}

/* 7. Float anchor rule: a break may never sit beside an active float */
{
  resetPos();
  const a = unit(0, 300);
  const b = unit(300, 700, { splittable: true, floatBottom: 1200 });
  const c = unit(700, 950);
  const d = unit(950, 1300); // does not fit → naive break at 950 sits in b's float
  const r = computeBreaks([a, b, c, d], OPTS, () => evenLines(b, 4));
  check('break jumps to the float anchor',
    r.breaks.length === 1 && r.breaks[0].pos === b.pos && r.breaks[0].kind === 'block',
    JSON.stringify(r.breaks));
  check('everything after the anchor fits page 2', r.pages === 2);
}

/* 8. Float over the edge forbids splitting its own unit */
{
  resetPos();
  const b = unit(0, 600, { splittable: true, floatBottom: 1200 });
  const c = unit(600, 900);
  const r = computeBreaks([b, c], OPTS, () => evenLines(b, 6));
  // b starts the page and cannot move → the page stretches to the float.
  check('float taller than its page stretches the page',
    r.pages === 1 && r.breaks.length === 0,
    JSON.stringify(r));
}

/* 9. Oversize table stretches its own page */
{
  resetPos();
  const t = unit(0, 1600, { type: 'table' });
  const p = unit(1600, 1800);
  const r = computeBreaks([t, p], OPTS, () => []);
  check('oversize table gets a stretched page, next block breaks',
    r.pages === 2 && r.breaks.length === 1 &&
    r.breaks[0].pos === p.pos && Math.abs(r.breaks[0].fillPx - 0) < 0.01,
    JSON.stringify(r.breaks));
}

/* 10. Margin trims (Word: space after/before swallowed at the boundary) */
{
  resetPos();
  const a = unit(0, 950, { marginBottomPx: 10 });
  const b = unit(960, 1500, { marginTopPx: 20 });
  const r = computeBreaks([a, b], OPTS, () => []);
  check('foot/head trims carry the neighbour margins',
    r.breaks[0].footTrimPx === 10 && r.breaks[0].headTrimPx === 20,
    JSON.stringify(r.breaks));
}

/* 11. Long paragraph splits across three pages (progress guarantee) */
{
  resetPos();
  const u = unit(0, 3000, { splittable: true });
  const r = computeBreaks([u], OPTS, () => evenLines(u, 30));
  check('three-page paragraph produces two splits',
    r.pages === 3 && r.breaks.length === 2 &&
    r.breaks.every((b) => b.kind === 'split'),
    JSON.stringify(r.breaks));
}

/* 12. Empty document */
{
  const r = computeBreaks([], OPTS, () => []);
  check('empty document is one page', r.pages === 1 && r.breaks.length === 0);
}

/* 13. Convergence: a known break list stops the computation early */
{
  resetPos();
  const units = [unit(0, 900), unit(900, 1800), unit(1800, 2700)];
  const first = computeBreaks(units, OPTS, () => []);
  const again = computeBreaks(
    units,
    { ...OPTS, knownBreaks: first.breaks.map(({ pos, kind }) => ({ pos, kind })) },
    () => []
  );
  check('recompute converges after the first matching break',
    again.converged === 0 && again.breaks.length === 1 &&
    again.breaks[0].pos === first.breaks[0].pos,
    JSON.stringify({ converged: again.converged, breaks: again.breaks.length }));
}

/* 17. Container-start rule (1.2.1): a break before the first child of a list
 * item must use the HOISTED position — otherwise the <li> box opens on the
 * old page and CSS draws its ::marker there while the text travels on.
 * Geometry is the paragraph's; only the reported position moves. */
{
  resetPos();
  const a = unit(0, 400);
  const b = unit(400, 800);
  // Paragraph inside list item 2: pos points INSIDE the <li>, breakPos before it.
  const li = unit(800, 1200, { breakPos: 0 });
  li.breakPos = li.pos - 3; // synthetic: the <li> opens 3 positions earlier
  const r = computeBreaks([a, b, li], OPTS, () => []);
  check('list-item start: break uses the hoisted position, not the inner one',
    r.breaks.length === 1 && r.breaks[0].kind === 'block' &&
    r.breaks[0].pos === li.breakPos && r.breaks[0].pos !== li.pos,
    JSON.stringify(r.breaks));
  check('hoisting leaves the page geometry untouched',
    Math.abs(r.breaks[0].fillPx - 200) < 0.01 && r.breaks[0].startY === li.top);
}

/* 18. A unit without breakPos behaves exactly as before (no silent change to
 * top-level paragraphs — the field is optional by design). */
{
  resetPos();
  const a = unit(0, 400);
  const b = unit(400, 1200);
  const r = computeBreaks([a, b], OPTS, () => []);
  check('a unit without breakPos still breaks at its own position',
    r.breaks.length === 1 && r.breaks[0].pos === b.pos);
}

/* 19. Mid-text split inside a list item stays untouched: the marker already
 * has its lines, so the split position must NOT be hoisted. */
{
  resetPos();
  const li = unit(0, 1500, { splittable: true });
  li.breakPos = -5; // would be wrong to use for a split
  const lines = evenLines(li, 15);
  const r = computeBreaks([li], OPTS, () => lines);
  check('a line split inside a list item ignores breakPos',
    r.breaks.length === 1 && r.breaks[0].kind === 'split' &&
    r.breaks[0].pos === lines[10].pos,
    JSON.stringify(r.breaks));
}

/* 20. Keep-with-next plus hoisting: the resolved target's hoisted position
 * wins — a heading that starts a list item drags the whole item along. */
{
  resetPos();
  const a = unit(0, 400);
  const h = unit(400, 600, { keepWithNext: true });
  h.breakPos = h.pos - 2;
  const p = unit(600, 1400);
  const r = computeBreaks([a, h, p], OPTS, () => []);
  check('keep-with-next resolves to the target, then hoists its position',
    r.breaks.length === 1 && r.breaks[0].pos === h.breakPos,
    JSON.stringify(r.breaks));
}

console.log(`\nPART 1: ${passed} ok, ${failed} failed`);
if (failed > 0) process.exit(1);

/* ========================================================================== */

const part1Passed = passed;

let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.warn('\nPART 2/3/4 skipped — jsdom missing (npm ci installs the pinned devDependencies)');
  process.exit(0);
}

const dom = new JSDOM('<!doctype html><html><body><div id="ed"></div></body></html>', {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
} catch { /* Node's built-in navigator is close enough for ProseMirror */ }
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame?.bind(dom.window)
  ?? ((fn) => setTimeout(fn, 16));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame?.bind(dom.window)
  ?? clearTimeout;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Range = dom.window.Range;
globalThis.DOMParser = dom.window.DOMParser;

// ProseMirror's scroll/coords path expects layout APIs that jsdom does not
// implement on Text and Range. Zero-rects are the standard PM-in-jsdom shim:
// scrolling becomes a no-op instead of a TypeError. Browser behavior is
// covered by the manual test instructions.
const zeroRect = () => new dom.window.DOMRect(0, 0, 0, 0);
for (const proto of [dom.window.Text.prototype, dom.window.Range.prototype]) {
  if (!proto.getClientRects) proto.getClientRects = () => [];
  if (!proto.getBoundingClientRect) proto.getBoundingClientRect = zeroRect;
}

const { createEditor } = await import('../src/core/editor.js');

console.log('\nPART 2 — pageBreak node in a real editor (jsdom)');

const editor = createEditor(document.getElementById('ed'), { content: null });

const nodeTypes = (doc) => {
  const types = [];
  doc.descendants((node) => {
    types.push(node.type.name);
  });
  return types;
};

/** Fire a keydown through ProseMirror's keymap chain (like real typing). */
const keydown = (options) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
};

/* 2.1 Ctrl+Enter splits the paragraph and inserts a pageBreak — no hardBreak */
{
  editor.commands.setContent('<p>HalloWelt</p>');
  editor.commands.setTextSelection(6); // between "Hallo" and "Welt"
  const handled = keydown({ key: 'Enter', ctrlKey: true });
  const types = nodeTypes(editor.state.doc);
  check('Ctrl+Enter is handled by pageBreak, not hardBreak',
    handled === true && types.includes('pageBreak') && !types.includes('hardBreak'),
    JSON.stringify(types));
  check('paragraph is split around the break',
    editor.state.doc.firstChild.textContent === 'Hallo' &&
    editor.state.doc.textContent.includes('Welt'),
    JSON.stringify(editor.getJSON()));
  check('caret continues after the break',
    editor.state.selection.$from.parent.type.name === 'paragraph' &&
    editor.state.selection.from > editor.state.doc.firstChild.nodeSize);
}

/* 2.2 One undo step restores the pre-break document. A fresh editor with
   constructor content mirrors the app (file open = clean history start) —
   setContent inside the SAME history group would blur the check. */
{
  const holder = document.createElement('div');
  document.body.append(holder);
  const ed2 = createEditor(holder, { content: '<p>HalloWelt</p>' });
  ed2.commands.setTextSelection(6);
  ed2.commands.insertPageBreak();
  const withBreak = nodeTypes(ed2.state.doc).includes('pageBreak');
  ed2.commands.undo();
  check('insertPageBreak is a single undo step',
    withBreak && ed2.getHTML() === '<p>HalloWelt</p>' &&
    !nodeTypes(ed2.state.doc).includes('pageBreak'),
    ed2.getHTML());
  ed2.destroy();
  holder.remove();
}

/* 2.3 Shift+Enter still belongs to HardBreak */
{
  editor.commands.setContent('<p>AB</p>');
  editor.commands.setTextSelection(2);
  keydown({ key: 'Enter', shiftKey: true });
  const types = nodeTypes(editor.state.doc);
  check('Shift+Enter still inserts a hardBreak',
    types.includes('hardBreak') && !types.includes('pageBreak'),
    JSON.stringify(types));
}

/* 2.4 Refused inside tables (command guard + can()) */
{
  editor.commands.setContent('<table><tr><td><p>Zelle</p></td></tr></table>');
  editor.commands.setTextSelection(5); // inside the cell
  const could = editor.can().insertPageBreak();
  const did = editor.commands.insertPageBreak();
  check('page break is refused inside a table',
    could === false && did === false &&
    !nodeTypes(editor.state.doc).includes('pageBreak'));
}

/* 2.5 Serialized HTML carries the attribute but never the UI label */
{
  editor.commands.setContent('<p>A</p>');
  editor.commands.setTextSelection(2);
  editor.commands.insertPageBreak();
  const html = editor.getHTML();
  check('getHTML serializes data-sw-page-break without label text',
    html.includes('data-sw-page-break') && !html.includes('Seitenumbruch'),
    html);
}

/* 2.6 Page view activation survives a layout-less environment: jsdom has
   no real layout (all rects are 0), so everything "fits" — the scheduler
   must run its full measure→apply→verify cycle without throwing and settle
   on a single page. This is the headless smoke test for the whole plugin
   plumbing; real geometry is browser territory (test instructions). */
{
  const { appState } = await import('../src/core/appState.js');
  const { defaultDocumentSettings } = await import('../src/config/settings.js');
  appState.set('docSettings', defaultDocumentSettings()); // app boot does this
  const holder = document.createElement('div');
  const page = document.createElement('div');
  page.className = 'page';
  page.append(holder);
  document.body.append(page);
  const ed3 = createEditor(holder, { content: '<p>Eins</p><p>Zwei</p>' });
  let threw = null;
  try {
    ed3.commands.setPageView(true);
    // Bare transaction: no scrollIntoView — jsdom has no layout for PM's
    // scroll geometry, and the scheduler only needs a pending doc change.
    ed3.view.dispatch(ed3.state.tr.insertText('X', 2));
    await new Promise((resolve) => setTimeout(resolve, 120)); // let rAF passes run
  } catch (error) {
    threw = error;
  }
  const { pageViewKey } = await import('../src/core/pageView.js');
  const state = pageViewKey.getState(ed3.state);
  check('page view scheduler survives without layout',
    threw === null && state.active === true && state.pages === 1 &&
    state.breaks.length === 0,
    threw ? String(threw) : JSON.stringify({ pages: state.pages }));
  ed3.commands.setPageView(false);
  const off = pageViewKey.getState(ed3.state);
  check('deactivation clears every decoration',
    off.active === false && off.decorations === undefined
      ? false
      : off.decorations.find().length === 0);
  ed3.destroy();
  page.remove();
}

console.log('\nPART 3 — DOCX round trip + print CSS');

const docx = await import('docx');
const mammothModule = await import('mammoth');
const mammoth = mammothModule.default ?? mammothModule;
const { unzipSync, strFromU8 } = await import('fflate');
const { buildDocxDocument } = await import('../src/io/docxExport.js');
const { docxImportOptions } = await import('../src/io/docxImport.js');
const { buildPrintCss } = await import('../src/io/pdfPrint.js');
const { collectFlowUnits } = await import('../src/core/pageView.js');
const { defaultDocumentSettings, mergeDocumentSettings } = await import('../src/config/settings.js');

/* 3.1 Export writes a real Word page break */
{
  const contentJson = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Seite eins' }] },
      { type: 'pageBreak' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Seite zwei' }] },
    ],
  };
  const wordDocument = buildDocxDocument(docx, contentJson, defaultDocumentSettings(), {});
  const buffer = await docx.Packer.toBuffer(wordDocument);
  const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml']);
  check('OOXML contains <w:br w:type="page"/>',
    /<w:br [^>]*w:type="page"/.test(xml));

  /* 3.2 …and the import maps it back onto a pageBreak node */
  const html = (await mammoth.convertToHtml(
    { buffer: Buffer.from(buffer) },
    docxImportOptions(mammoth)
  )).value;
  editor.commands.setContent(html);
  const types = nodeTypes(editor.state.doc);
  const text = editor.state.doc.textContent;
  check('mammoth + parse rules yield exactly one pageBreak node',
    types.filter((t) => t === 'pageBreak').length === 1 &&
    !types.includes('horizontalRule') &&
    text.includes('Seite eins') && text.includes('Seite zwei'),
    JSON.stringify({ types, html }));
}

/* 3.3 A plain <hr> still parses as horizontalRule (no rule collision) */
{
  editor.commands.setContent('<p>A</p><hr><p>B</p>');
  const types = nodeTypes(editor.state.doc);
  check('plain hr stays a horizontalRule',
    types.includes('horizontalRule') && !types.includes('pageBreak'),
    JSON.stringify(types));
}

/* 3.4 Generated print CSS carries the chunk-steering rules */
{
  const css = buildPrintCss(defaultDocumentSettings());
  check('generated print CSS forces the manual break',
    css.includes('[data-sw-page-break] { break-after: page; }'));
  check('generated print CSS keeps headings with their content',
    css.includes('break-after: avoid'));
}

/* 3.5 Page-number formats/positions in the generated print CSS (0.23.0) */
{
  const base = defaultDocumentSettings();
  check('print CSS default: plain number, bottom center',
    buildPrintCss(base).includes('@bottom-center { content: counter(page);'));

  const off = buildPrintCss({ ...base, pageNumberFormat: 'off' });
  check('print CSS: numbers off → no counter boxes', !off.includes('counter(page)'));

  // buildPrintCss speaks the ACTIVE UI language — pin it instead of
  // inheriting the boot default (en since 1.0.0).
  const { setLanguage } = await import('../src/i18n/index.js');
  setLanguage('en');
  const right = buildPrintCss({
    ...base, pageNumberFormat: 'pageOfPages', pageNumberPosition: 'right',
  });
  check('print CSS: "Page N of M" at bottom right',
    /@bottom-right \{ content: "Page " counter\(page\) " of " counter\(pages\);/.test(right));

  const merged = buildPrintCss({
    ...base, footerText: 'Fuß', pageNumberFormat: 'number', pageNumberPosition: 'left',
  });
  check('print CSS: footer text + left number share @bottom-left',
    /@bottom-left \{ content: "Fuß" "\\2002" counter\(page\);/.test(merged) &&
    !merged.includes('@bottom-center'));
}

/* 3.6 Migration of the pre-0.23.0 pageNumbers boolean */
{
  const legacyOn = mergeDocumentSettings({ pageNumbers: true });
  const legacyOff = mergeDocumentSettings({ pageNumbers: false });
  const explicit = mergeDocumentSettings({
    pageNumbers: true, pageNumberFormat: 'dash', pageNumberPosition: 'right',
  });
  const bogus = mergeDocumentSettings({ pageNumberFormat: 'weird', pageNumberPosition: 'top' });
  check('migration: pageNumbers true → app default format, bool dropped',
    legacyOn.pageNumberFormat === 'number' && !('pageNumbers' in legacyOn));
  check('migration: pageNumbers false → off', legacyOff.pageNumberFormat === 'off');
  check('migration: explicit format wins over the bool',
    explicit.pageNumberFormat === 'dash' && explicit.pageNumberPosition === 'right');
  check('migration: unknown ids degrade to the defaults',
    bogus.pageNumberFormat === 'number' && bogus.pageNumberPosition === 'center');
}

/* 3.7 DOCX footer mirrors format + position */
{
  const contentJson = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }],
  };
  const footerXmlOf = async (docSettings) => {
    const wordDocument = buildDocxDocument(docx, contentJson, docSettings, {});
    const buffer = await docx.Packer.toBuffer(wordDocument);
    const files = unzipSync(new Uint8Array(buffer));
    const name = Object.keys(files).find((entry) => /^word\/footer\d*\.xml$/.test(entry));
    return name ? strFromU8(files[name]) : '';
  };

  const both = await footerXmlOf({
    ...defaultDocumentSettings(),
    footerText: 'Vertraulich',
    pageNumberFormat: 'pageOfPages',
    pageNumberPosition: 'right',
  });
  check('DOCX footer: text + PAGE/NUMPAGES fields behind a tab',
    both.includes('Vertraulich') && /PAGE/.test(both) && /NUMPAGES/.test(both) &&
    /w:tab/.test(both),
    both.slice(0, 400));

  const centered = await footerXmlOf(defaultDocumentSettings());
  check('DOCX footer default: centred plain page number',
    /PAGE/.test(centered) && !/NUMPAGES/.test(centered) &&
    /w:jc w:val="center"/.test(centered),
    centered.slice(0, 400));

  const none = await footerXmlOf({ ...defaultDocumentSettings(), pageNumberFormat: 'off' });
  check('DOCX footer: numbers off and no footer text → no footer part', none === '');
}

/* ==========================================================================
   PART 5 — clear formatting + indents (feature 2, 0.26.0)
   ========================================================================== */

console.log('\nPART 5 — clear formatting + indents');

const { settings: editorSettings } = await import('../src/config/settings.js');
const INDENT_STEP_TWIPS = Math.round((editorSettings.editor.indentStepMm * 1440) / 25.4);

/** Position INSIDE the n-th node of the given type (1-based, parentOffset 0). */
const posInside = (doc, typeName, nth = 1) => {
  let seen = 0;
  let found = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === typeName) {
      seen += 1;
      if (seen === nth) found = pos + 1;
    }
    return true;
  });
  return found;
};

/* 5.1 Level grid: inline margin-left parses onto the grid, renders back */
{
  editor.commands.setContent('<p style="margin-left: 25mm">Eins</p>');
  check('margin-left 25mm parses to indent level 2',
    editor.state.doc.firstChild.attrs.indent === 2,
    JSON.stringify(editor.state.doc.firstChild.attrs));
  check('level renders back as inline mm',
    /margin-left:\s*25mm/.test(editor.getHTML()), editor.getHTML());
  editor.commands.setContent('<p style="margin-left: 36pt">Word-Zwischenablage</p>');
  check('foreign pt indent snaps to the grid (36pt ≈ level 1)',
    editor.state.doc.firstChild.attrs.indent === 1,
    JSON.stringify(editor.state.doc.firstChild.attrs));
}

/* 5.2 Stepping: per node from ITS level, clamped at both bounds */
{
  editor.commands.setContent('<p>A</p><p style="margin-left: 12.5mm">B</p>');
  editor.commands.selectAll();
  editor.commands.increaseIndent();
  const [a, b] = [editor.state.doc.child(0), editor.state.doc.child(1)];
  check('multi-selection steps every paragraph from its own level',
    a.attrs.indent === 1 && b.attrs.indent === 2,
    JSON.stringify([a.attrs.indent, b.attrs.indent]));

  const max = editorSettings.editor.indentMaxLevels;
  editor.commands.setContent(
    `<p style="margin-left: ${max * editorSettings.editor.indentStepMm}mm">Max</p>`
  );
  check('parse clamps at indentMaxLevels', editor.state.doc.firstChild.attrs.indent === max);
  check('increase refuses at the cap (can() greys the button)',
    editor.commands.increaseIndent() === false &&
    editor.state.doc.firstChild.attrs.indent === max);
  editor.commands.setContent('<p>Null</p>');
  check('decrease refuses at level 0',
    editor.commands.decreaseIndent() === false &&
    editor.state.doc.firstChild.attrs.indent === 0);
}

/* 5.3 Tab semantics: paragraph start only; lists sink; tables navigate */
{
  editor.commands.setContent('<p>HalloWelt</p>');
  editor.commands.setTextSelection(1);
  check('Tab at paragraph start indents',
    keydown({ key: 'Tab' }) === true && editor.state.doc.firstChild.attrs.indent === 1);
  check('Shift+Tab at paragraph start outdents',
    keydown({ key: 'Tab', shiftKey: true }) === true &&
    editor.state.doc.firstChild.attrs.indent === 0);
  editor.commands.setTextSelection(6); // mid-paragraph
  const midHandled = keydown({ key: 'Tab' });
  check('Tab mid-paragraph falls through untouched',
    midHandled !== true && editor.state.doc.firstChild.attrs.indent === 0,
    String(midHandled));

  editor.commands.setContent('<ul><li><p>Eins</p></li><li><p>Zwei</p></li></ul>');
  editor.commands.setTextSelection(posInside(editor.state.doc, 'paragraph', 2));
  const listHandled = keydown({ key: 'Tab' });
  const outerList = editor.state.doc.firstChild;
  check('Tab inside a list still sinks the item (list keymap wins)',
    listHandled === true && outerList.childCount === 1 &&
    outerList.firstChild.content.content.some((n) => n.type.name === 'bulletList'),
    JSON.stringify(editor.getJSON()));

  editor.commands.setContent(
    '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>'
  );
  editor.commands.setTextSelection(posInside(editor.state.doc, 'paragraph', 1) + 1);
  const before = editor.state.selection.from;
  const tableHandled = keydown({ key: 'Tab' });
  check('Tab inside a table still navigates cells, no indent set',
    tableHandled === true && editor.state.selection.from > before &&
    editor.state.doc.textContent === 'AB' &&
    posInside(editor.state.doc, 'paragraph', 1) !== null &&
    editor.state.doc.nodeAt(posInside(editor.state.doc, 'paragraph', 1) - 1).attrs.indent === 0);
}

/* 5.4 clearFormatting: marks off, heading → paragraph, block attrs reset */
{
  editor.commands.setContent(
    '<h2 style="margin-left: 25mm; text-align: right; line-height: 2"><strong><em>Titel</em></strong></h2>'
  );
  editor.commands.selectAll();
  const handled = keydown({ key: ' ', ctrlKey: true }); // Strg+Leertaste
  const first = editor.state.doc.firstChild;
  const marks = [];
  first.descendants((n) => { n.marks.forEach((m) => marks.push(m.type.name)); });
  check('Ctrl+Space is handled by clearFormatting',
    handled === true, String(handled));
  check('clear turns the heading into a default paragraph',
    first.type.name === 'paragraph', first.type.name);
  check('clear removes every mark',
    marks.length === 0, JSON.stringify(marks));
  check('clear resets textAlign, lineHeight and indent',
    (first.attrs.textAlign ?? null) === null &&
    (first.attrs.lineHeight ?? null) === null &&
    first.attrs.indent === 0,
    JSON.stringify(first.attrs));

  // Fresh editor with constructor content (same reasoning as 2.2): inside
  // the shared editor, setContent and the clear would land in ONE history
  // group and a single undo would wipe both.
  const holder5 = document.createElement('div');
  document.body.append(holder5);
  const ed5 = createEditor(holder5, {
    content: '<h2 style="margin-left: 25mm"><strong>Titel</strong></h2>',
  });
  ed5.commands.selectAll();
  ed5.commands.clearFormatting();
  const cleared = ed5.state.doc.firstChild.type.name === 'paragraph';
  ed5.commands.undo();
  check('clearFormatting is a single undo step',
    cleared &&
    ed5.state.doc.firstChild.type.name === 'heading' &&
    ed5.state.doc.firstChild.attrs.indent === 2,
    JSON.stringify(ed5.getJSON()));
  ed5.destroy();
  holder5.remove();
}

/* 5.5 DOCX export: level → twips; quote and list stay additive */
{
  const contentJson = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { indent: 2 }, content: [{ type: 'text', text: 'Eingerückt' }] },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: 'Zitat' }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: 'Punkt' }] },
            ],
          },
        ],
      },
    ],
  };
  const wordDocument = buildDocxDocument(docx, contentJson, defaultDocumentSettings(), {});
  const buffer = await docx.Packer.toBuffer(wordDocument);
  const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml']);
  const indTags = xml.match(/<w:ind [^>]*\/>/g) ?? [];
  const hasInd = (twips, hanging = false) =>
    indTags.some(
      (tag) =>
        new RegExp(`w:(left|start)="${twips}"`).test(tag) &&
        (!hanging || /w:hanging="360"/.test(tag))
    );
  check('paragraph indent exports as level × step twips',
    hasInd(2 * INDENT_STEP_TWIPS), JSON.stringify(indTags));
  check('quote and list indent stay additive (720 + step)',
    hasInd(720 + INDENT_STEP_TWIPS));
  check('list indent keeps the hanging marker geometry',
    hasInd(720 + INDENT_STEP_TWIPS, true), JSON.stringify(indTags));

  /* 5.6 …and the import brings the body indent back onto the grid */
  const html = (await mammoth.convertToHtml(
    { buffer: Buffer.from(buffer) },
    docxImportOptions(mammoth)
  )).value;
  check('mammoth transform emits the indent class', /sw-indent-2/.test(html), html);
  editor.commands.setContent(html);
  check('round trip lands on indent level 2',
    editor.state.doc.firstChild.attrs.indent === 2,
    JSON.stringify(editor.state.doc.firstChild.attrs));
  const listTypes = nodeTypes(editor.state.doc);
  check('list paragraphs stay list items (numbering guard)',
    listTypes.includes('bulletList'), JSON.stringify(listTypes));
}

/* 5.7 Import guard: an indented HEADING keeps its structure */
{
  const contentJson = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, indent: 1 },
        content: [{ type: 'text', text: 'Kapitel' }],
      },
    ],
  };
  const wordDocument = buildDocxDocument(docx, contentJson, defaultDocumentSettings(), {});
  const buffer = await docx.Packer.toBuffer(wordDocument);
  const html = (await mammoth.convertToHtml(
    { buffer: Buffer.from(buffer) },
    docxImportOptions(mammoth)
  )).value;
  editor.commands.setContent(html);
  check('indented heading survives the import as a heading',
    editor.state.doc.firstChild.type.name === 'heading', html);
}

/* ==========================================================================
   PART 6 — page format & orientation (feature 3, 0.27.0)
   ========================================================================== */

console.log('\nPART 6 — page format & orientation');

{
  const { pageSizeMm, pageFormatOf } = await import('../src/core/docSettings.js');

  /* 6.1 Effective size: orientation swaps, unknown ids fall back */
  const a4 = pageSizeMm({ pageFormat: 'a4', pageOrientation: 'portrait' });
  const a5q = pageSizeMm({ pageFormat: 'a5', pageOrientation: 'landscape' });
  check('A4 portrait is 210 × 297', a4.widthMm === 210 && a4.heightMm === 297);
  check('A5 landscape swaps to 210 × 148', a5q.widthMm === 210 && a5q.heightMm === 148);
  check('unknown format falls back to the app default',
    pageFormatOf({ pageFormat: 'a0' }).id === editorSettings.page.formatDefault);

  /* 6.2 Migration: old files get defaults, foreign ids degrade */
  const migratedOld = mergeDocumentSettings({ pageMarginsMm: { top: 30 } });
  check('pre-0.27 files default to A4 portrait',
    migratedOld.pageFormat === 'a4' && migratedOld.pageOrientation === 'portrait' &&
    migratedOld.pageMarginsMm.top === 30);
  const migratedForeign = mergeDocumentSettings({ pageFormat: 'tabloid', pageOrientation: 'diagonal' });
  check('foreign ids degrade to the defaults',
    migratedForeign.pageFormat === 'a4' && migratedForeign.pageOrientation === 'portrait');

  /* 6.3 Print CSS carries the effective size */
  const printCss = buildPrintCss({
    ...defaultDocumentSettings(),
    pageFormat: 'a5',
    pageOrientation: 'landscape',
  });
  check('@page size follows format + orientation',
    /size:\s*210mm 148mm;/.test(printCss), printCss.slice(0, 120));

  /* 6.4 DOCX section: portrait dims in, docx swaps for landscape */
  const sectionXmlOf = async (docSettings) => {
    const wordDocument = buildDocxDocument(
      docx,
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] },
      docSettings,
      {}
    );
    const buffer = await docx.Packer.toBuffer(wordDocument);
    const xml = strFromU8(unzipSync(new Uint8Array(buffer))['word/document.xml']);
    return xml.match(/<w:pgSz [^>]*\/>/)?.[0] ?? '';
  };

  const defaultTag = await sectionXmlOf(defaultDocumentSettings());
  check('default DOCX section is A4 portrait (11906 × 16838)',
    /w:w="11906"/.test(defaultTag) && /w:h="16838"/.test(defaultTag) &&
    /w:orient="portrait"/.test(defaultTag), defaultTag);

  const letterLandscape = await sectionXmlOf({
    ...defaultDocumentSettings(),
    pageFormat: 'letter',
    pageOrientation: 'landscape',
  });
  check('Letter landscape swaps pgSz and writes w:orient (15840 × 12240)',
    /w:w="15840"/.test(letterLandscape) && /w:h="12240"/.test(letterLandscape) &&
    /w:orient="landscape"/.test(letterLandscape), letterLandscape);
}

/* ==========================================================================
   PART 7 — document default typeface (feature 8, 0.29.0)
   ========================================================================== */

console.log('\nPART 7 — document default typeface (feature 8)');
{
  const { settings: cfg, mergeDocumentSettings } = await import('../src/config/settings.js');
  const arial = cfg.editor.fonts.find((font) => font.label === 'Arial').css;

  /* Migration */
  const legacy = mergeDocumentSettings({ headerText: 'x' }); // pre-0.29 file
  check('migration fills the app defaults for old files',
    legacy.fontFamily === cfg.editor.fontFamily && legacy.fontSizePt === cfg.editor.fontSizePt);
  const foreign = mergeDocumentSettings({ fontFamily: 'Comic Sans MS', fontSizePt: 'zwölf' });
  check('foreign stacks and junk sizes degrade to the defaults',
    foreign.fontFamily === cfg.editor.fontFamily && foreign.fontSizePt === cfg.editor.fontSizePt);
  const snapped = mergeDocumentSettings({ fontFamily: arial, fontSizePt: 13.26 });
  check('valid values survive, sizes snap to the half-point grid',
    snapped.fontFamily === arial && snapped.fontSizePt === 13.5);
  check('sizes clamp to the toolbar bounds',
    mergeDocumentSettings({ fontSizePt: 999 }).fontSizePt === cfg.editor.fontSizeMaxPt);

  /* CSS variables — screen sheet and print mirror read the same two */
  const { initDocSettings, replaceDocSettings } = await import('../src/core/docSettings.js');
  initDocSettings();
  replaceDocSettings({ fontFamily: arial, fontSizePt: 14 });
  const rootStyle = document.documentElement.style;
  check('applyToCss mirrors the document typeface into the CSS variables',
    rootStyle.getPropertyValue('--content-font-family') === arial &&
    rootStyle.getPropertyValue('--content-font-size') === '14pt');
  replaceDocSettings(null); // defaults again for anything after us

  /* DOCX out: default style + heading base scale with the document */
  const docxLib = await import('docx');
  const { unzipSync, strFromU8, zipSync, strToU8 } = await import('fflate');
  const oneParagraph = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Grundschrift' }] }],
  };
  const arial14 = mergeDocumentSettings({ fontFamily: arial, fontSizePt: 14 });
  const exportBuffer = await docxLib.Packer.toBuffer(
    buildDocxDocument(docxLib, oneParagraph, arial14, {})
  );
  const stylesXml = strFromU8(unzipSync(new Uint8Array(exportBuffer))['word/styles.xml']);
  check('DOCX default style carries the document font (w:rFonts Arial)',
    /w:rFonts[^>]*w:ascii="Arial"/.test(stylesXml), stylesXml.slice(0, 200));
  check('DOCX default style carries the document size (w:sz 28 half-points)',
    /<w:sz w:val="28"/.test(stylesXml));
  check('DOCX heading sizes scale from the document base',
    new RegExp(`w:val="${Math.round(14 * cfg.docx.headingFactors[1] * 2)}"`).test(stylesXml));

  /* DOCX in: our own export reads back, Normal overrides docDefaults,
     unknown fonts degrade to null (caller keeps the default) */
  const { readDocxDefaultFont } = await import('../src/io/docxImport.js');
  const roundtrip = readDocxDefaultFont(exportBuffer);
  check('import reads the exported default back (Arial, 14 pt)',
    roundtrip.fontFamily === arial && roundtrip.fontSizePt === 14);

  const handXml = `<?xml version="1.0"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`;
  const overridden = readDocxDefaultFont(zipSync({ 'word/styles.xml': strToU8(handXml) }));
  check('the default paragraph style overrides docDefaults',
    overridden.fontFamily === arial && overridden.fontSizePt === 14);
  const unknown = readDocxDefaultFont(
    zipSync({ 'word/styles.xml': strToU8(handXml.replaceAll('Arial', 'Comic Sans MS')) })
  );
  check('unknown fonts come back as null, sizes still parse',
    unknown.fontFamily === null && unknown.fontSizePt === 14);

  /* Inspect: deviation is measured against the DOCUMENT base */
  const { collectInspect } = await import('../src/core/inspect.js');
  editor.commands.setContent('<p>x</p>');
  editor.chain().setTextSelection({ from: 1, to: 2 }).setFontSize('14pt').run();
  const [asDocDefault] = collectInspect(editor.state.doc, 14);
  const [asDeviation] = collectInspect(editor.state.doc, 12);
  check('inspect: a mark equal to the document base is no deviation',
    asDocDefault.deviates === false);
  check('inspect: the same mark deviates against a different base',
    asDeviation.deviates === true);
}

/* ==========================================================================
   PART 8 — first page different (feature 9, 0.30.0)
   ========================================================================== */

console.log('\nPART 8 — first page different (feature 9)');
{
  const { pageChrome } = await import('../src/core/docSettings.js');

  /* 8.1 Migration: old files get the defaults, foreign junk degrades */
  const legacy = mergeDocumentSettings({ headerText: 'x' }); // pre-0.30 file
  check('migration: old files default to a normal first page',
    legacy.firstPageDifferent === false &&
    legacy.firstHeaderText === '' && legacy.firstFooterText === '');
  const junk = mergeDocumentSettings({
    firstPageDifferent: 'yes', firstHeaderText: 7, firstFooterText: null,
  });
  check('migration: junk degrades to flag off + empty texts',
    junk.firstPageDifferent === false &&
    junk.firstHeaderText === '' && junk.firstFooterText === '');
  const letter = mergeDocumentSettings({
    headerText: 'Lauf', footerText: 'Fu\u00df',
    pageNumberFormat: 'pageOfPages',
    firstPageDifferent: true, firstHeaderText: 'Briefkopf', firstFooterText: 'Absender',
  });
  check('migration: valid first-page values survive',
    letter.firstPageDifferent === true &&
    letter.firstHeaderText === 'Briefkopf' && letter.firstFooterText === 'Absender');

  /* 8.2 pageChrome: the ONE per-page rule all three consumers share */
  check('pageChrome: page 1 swaps to the first texts and drops the number',
    pageChrome(letter, 1).headerText === 'Briefkopf' &&
    pageChrome(letter, 1).footerText === 'Absender' &&
    pageChrome(letter, 1).numberedPage === false);
  check('pageChrome: page 2 keeps the running chrome',
    pageChrome(letter, 2).headerText === 'Lauf' &&
    pageChrome(letter, 2).footerText === 'Fu\u00df' &&
    pageChrome(letter, 2).numberedPage === true);
  check('pageChrome: flag off leaves page 1 alone',
    pageChrome({ ...letter, firstPageDifferent: false }, 1).headerText === 'Lauf' &&
    pageChrome({ ...letter, firstPageDifferent: false }, 1).numberedPage === true);

  /* 8.3 Print CSS: @page :first only with the flag; overrides + clears */
  const base = {
    ...defaultDocumentSettings(),
    headerText: 'Lauf', footerText: 'Fu\u00df',
    pageNumberFormat: 'pageOfPages', pageNumberPosition: 'center',
  };
  check('print CSS: flag off -> no :first rule',
    !buildPrintCss(base).includes(':first'));

  const firstBlockOf = (css) => css.match(/@page :first \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const suppressed = firstBlockOf(buildPrintCss({ ...base, firstPageDifferent: true }));
  check('print CSS: empty first texts clear header, footer and number on page 1',
    /@top-center \{ content: none; \}/.test(suppressed) &&
    /@bottom-left \{ content: none; \}/.test(suppressed) &&
    /@bottom-center \{ content: none; \}/.test(suppressed),
    JSON.stringify(suppressed));

  const ownCss = buildPrintCss({
    ...base, firstPageDifferent: true,
    firstHeaderText: 'Briefkopf', firstFooterText: 'Absender',
  });
  const own = firstBlockOf(ownCss);
  check('print CSS: own first texts land in :first, running chrome stays',
    own.includes('content: "Briefkopf"') &&
    own.includes('content: "Absender"') &&
    !own.includes('counter(page)') &&
    ownCss.includes('content: "Lauf"'),
    JSON.stringify(own));

  const mergedFirst = firstBlockOf(buildPrintCss({
    ...base, pageNumberPosition: 'left', firstPageDifferent: true,
  }));
  check('print CSS: merged left box is cleared once, nothing else touched',
    /@bottom-left \{ content: none; \}/.test(mergedFirst) &&
    !mergedFirst.includes('@bottom-center') && !mergedFirst.includes('@bottom-right'),
    JSON.stringify(mergedFirst));

  /* 8.4 DOCX: titlePg + explicit first parts, resolved via the relationships */
  const docxPartsOf = async (docSettings) => {
    const wordDocument = buildDocxDocument(
      docx,
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] },
      docSettings,
      {}
    );
    const buffer = await docx.Packer.toBuffer(wordDocument);
    const files = unzipSync(new Uint8Array(buffer));
    const docXml = strFromU8(files['word/document.xml']);
    const rels = strFromU8(files['word/_rels/document.xml.rels']);
    const partOf = (refTag, refType) => {
      const refMatch = docXml.match(
        new RegExp(`<w:${refTag}[^>]*w:type="${refType}"[^>]*/>`)
      )?.[0];
      const rid = refMatch?.match(/r:id="(rId\d+)"/)?.[1];
      if (!rid) return null;
      const relTag = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*/>`))?.[0] ?? '';
      const target = relTag.match(/Target="([^"]+)"/)?.[1];
      return target ? strFromU8(files[`word/${target}`]) : null;
    };
    return { docXml, partOf };
  };

  const letterDoc = await docxPartsOf(letter);
  check('DOCX: section carries <w:titlePg/>',
    /<w:titlePg\s*\/>/.test(letterDoc.docXml));
  const firstHeaderXml = letterDoc.partOf('headerReference', 'first');
  const firstFooterXml = letterDoc.partOf('footerReference', 'first');
  const defaultFooterXml = letterDoc.partOf('footerReference', 'default');
  check('DOCX: first header part carries its own text',
    firstHeaderXml !== null && firstHeaderXml.includes('Briefkopf'));
  check('DOCX: first footer has the text but NO page-number field',
    firstFooterXml !== null && firstFooterXml.includes('Absender') &&
    !/PAGE/.test(firstFooterXml),
    (firstFooterXml ?? '').slice(0, 300));
  check('DOCX: default footer keeps text + number for page 2 on',
    defaultFooterXml !== null && defaultFooterXml.includes('Fu\u00df') &&
    /PAGE/.test(defaultFooterXml) && /NUMPAGES/.test(defaultFooterXml));

  const emptyFirst = await docxPartsOf(mergeDocumentSettings({
    headerText: 'Lauf', firstPageDifferent: true,
  }));
  check('DOCX: empty first texts still write explicit blank parts',
    /<w:titlePg\s*\/>/.test(emptyFirst.docXml) &&
    emptyFirst.partOf('headerReference', 'first') !== null &&
    emptyFirst.partOf('footerReference', 'first') !== null);

  const flagOff = await docxPartsOf(mergeDocumentSettings({ headerText: 'Lauf' }));
  check('DOCX: flag off -> no titlePg, no first references',
    !flagOff.docXml.includes('titlePg') &&
    flagOff.partOf('headerReference', 'first') === null &&
    flagOff.partOf('footerReference', 'first') === null);
}

editor.destroy();

/* ==========================================================================
   PART 4 — backup generations (feature 1, 0.25.0) on fake-indexeddb
   ========================================================================== */

let hasFakeIdb = true;
try {
  await import('fake-indexeddb/auto');
  // With jsdom active, fake-indexeddb attaches everything to `window` —
  // bridge the realms so bare references (indexedDB, IDBKeyRange,
  // IDBRequest, …) resolve for db.js and the idb library.
  const realm = globalThis.window ?? {};
  globalThis.indexedDB = globalThis.indexedDB ?? realm.indexedDB;
  for (const key of Object.getOwnPropertyNames(realm)) {
    if (key.startsWith('IDB') && !(key in globalThis)) globalThis[key] = realm[key];
  }
} catch {
  hasFakeIdb = false;
  console.warn('\nPART 4 skipped — fake-indexeddb missing (npm ci installs the pinned devDependencies)');
}
if (hasFakeIdb) {
  const { settings: appSettings } = await import('../src/config/settings.js');
  const { rotateGenerations, recordSaveGeneration, listSnapshots } =
    await import('../src/io/autosave.js');
  const { getDb } = await import('../src/io/db.js');

  const minuteMs = 60000;
  const spacingMs = appSettings.autosave.generationMinutes * minuteMs;
  const record = {
    content: { type: 'doc', content: [] },
    fileName: 'test.sdoc',
    docSettings: null,
  };
  const t0 = Date.UTC(2026, 0, 1);

  check('rotation writes the first generation', (await rotateGenerations(record, t0)) === true);
  check('rotation respects the spacing',
    (await rotateGenerations(record, t0 + minuteMs)) === false);
  check('rotation fires once the spacing passed',
    (await rotateGenerations(record, t0 + spacingMs)) === true);
  check('pre-save backup guarded against save-spamming',
    (await recordSaveGeneration(record, t0 + spacingMs + appSettings.autosave.savedMinGapMs - 1)) === false);
  check('pre-save backup lands after the gap',
    (await recordSaveGeneration(record, t0 + spacingMs + appSettings.autosave.savedMinGapMs)) === true);

  // Fill well beyond the cap — the pool must stay pruned, oldest out first.
  let tick = t0 + spacingMs + appSettings.autosave.savedMinGapMs;
  for (let index = 0; index < appSettings.autosave.maxGenerations + 2; index += 1) {
    tick += spacingMs;
    await rotateGenerations(record, tick);
  }
  const db = await getDb();
  await db.put(
    appSettings.autosave.storeName,
    { ...record, savedAt: tick + 1 },
    appSettings.autosave.snapshotKey
  );
  const list = await listSnapshots();
  const generations = list.filter((entry) => entry.kind !== 'current');
  check('crash snapshot listed first as kind current', list[0]?.kind === 'current');
  check('pool pruned to maxGenerations',
    generations.length === appSettings.autosave.maxGenerations, String(generations.length));
  check('generations sorted newest first',
    generations.every((entry, index, all) => index === 0 || all[index - 1].savedAt >= entry.savedAt));
  check('the oldest generation was evicted',
    generations.every((entry) => entry.savedAt > t0));
  check('kinds carried on every generation',
    generations.every((entry) => entry.kind === 'auto' || entry.kind === 'saved'));
}

// ---------------------------------------------------------------------------
// PART 9 — .sdoc format gate (release point 10). The v1 freeze promise:
// every future Simplex reads formatVersion 1 forever, and a file from a
// NEWER generation fails with the distinct 'unsupported-version' error
// (mapped to file.formatTooNew in the UI) instead of the generic "invalid"
// message — including when the newer JSON travels inside the legacy ZIP
// envelope. Pure Node, no jsdom needed.
console.log('\nPART 9 — .sdoc format gate (v1 freeze)');
{
  const { createContainer, parseContainer, FORMAT_VERSION } =
    await import('../src/io/container.js');
  const { zipSync, strToU8 } = await import('fflate');

  const content = { type: 'doc', content: [{ type: 'paragraph' }] };
  const encode = (json) => new TextEncoder().encode(JSON.stringify(json));
  const thrownMessage = (bytes) => {
    try {
      parseContainer(bytes);
      return null;
    } catch (error) {
      return error.message;
    }
  };

  const parsed = parseContainer(createContainer({ content, title: 'Gate' }));
  check('v1 JSON round trip keeps version and content',
    parsed.formatVersion === FORMAT_VERSION && parsed.content?.type === 'doc');

  check('newer formatVersion throws unsupported-version',
    thrownMessage(encode({ formatVersion: FORMAT_VERSION + 1, content })) === 'unsupported-version');

  check('junk bytes throw invalid-container',
    thrownMessage(new TextEncoder().encode('not a document')) === 'invalid-container');

  const legacyZip = (json) => zipSync({ 'document.json': strToU8(JSON.stringify(json)) });
  check('legacy ZIP envelope (0.3.0) still parses',
    parseContainer(legacyZip({ formatVersion: FORMAT_VERSION, content })).content?.type === 'doc');

  check('gate also fires inside the legacy ZIP envelope',
    thrownMessage(legacyZip({ formatVersion: FORMAT_VERSION + 1, content })) === 'unsupported-version');
}

// ---------------------------------------------------------------------------
// PART 10 — pending marks (0.31.1). Word keeps character formatting on the
// paragraph mark; our bridge is the pendingMarks attribute. Real editor,
// real CellSelection, real typing — no spy commands.
// ---------------------------------------------------------------------------
console.log('\nPART 10 — pending marks on empty blocks');
{
  const { CellSelection } = await import('@tiptap/pm/tables');
  const { TextSelection } = await import('@tiptap/pm/state');
  const { mergeTextStyleSeed, pendingTextStyleAt } =
    await import('../src/core/pendingMarks.js');

  check('mergeTextStyleSeed merges, removes on null and empties to null',
    JSON.stringify(mergeTextStyleSeed(null, { fontFamily: 'Arial' })) ===
      JSON.stringify([{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }]) &&
    JSON.stringify(mergeTextStyleSeed(
      [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }], { fontSize: '16pt' }
    )) === JSON.stringify([{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '16pt' } }]) &&
    mergeTextStyleSeed([{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }],
      { fontFamily: null }) === null);

  const cellMount = document.body.appendChild(document.createElement('div'));
  const cellEditor = createEditor(cellMount, {
    content: {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
                { type: 'tableCell', content: [{ type: 'paragraph' }] },
              ],
            },
          ],
        },
        { type: 'paragraph' },
      ],
    },
  });

  const cellPositions = () => {
    const found = [];
    cellEditor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') found.push(pos);
    });
    return found;
  };
  const cellParagraphs = () => {
    const found = [];
    cellEditor.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') found.push(node.firstChild);
    });
    return found;
  };

  // Seed over a CellSelection spanning both EMPTY cells (the reported case).
  {
    const [first, second] = cellPositions();
    const selection = CellSelection.create(cellEditor.state.doc, first, second);
    cellEditor.view.dispatch(cellEditor.state.tr.setSelection(selection));
    cellEditor.commands.seedPendingTextStyle({ fontFamily: 'Arial', fontSize: '16pt' });
  }
  check('CellSelection over empty cells seeds every cell paragraph',
    cellParagraphs().every((paragraph) => {
      const seed = paragraph.attrs.pendingMarks;
      return seed?.length === 1 && seed[0].type === 'textStyle' &&
        seed[0].attrs.fontFamily === 'Arial' && seed[0].attrs.fontSize === '16pt';
    }));

  check('toolbar display fallback reads the seed while the cells stay selected',
    pendingTextStyleAt(cellEditor.state)?.fontFamily === 'Arial');

  // Entering a seeded cell arms the seed as stored marks…
  {
    const [first] = cellPositions();
    const inside = cellEditor.state.doc.resolve(first + 2); // cell +1 → paragraph +1 → inside
    cellEditor.view.dispatch(cellEditor.state.tr.setSelection(new TextSelection(inside)));
  }
  check('entering a seeded empty cell turns the seed into stored marks',
    (cellEditor.state.storedMarks ?? []).some((mark) =>
      mark.type.name === 'textStyle' && mark.attrs.fontFamily === 'Arial'));

  // …and the first typed character materializes REAL marks + drops the seed.
  cellEditor.commands.insertContent('X');
  {
    const [firstParagraph] = cellParagraphs();
    check('first input materializes the seed as a real textStyle mark',
      firstParagraph.textContent === 'X' &&
      firstParagraph.firstChild.marks.some((mark) =>
        mark.type.name === 'textStyle' && mark.attrs.fontFamily === 'Arial' &&
        mark.attrs.fontSize === '16pt'));
    check('a block that gained content drops its seed',
      firstParagraph.attrs.pendingMarks === null);
  }

  // Emptying a styled block re-seeds from the removed text (Word's pilcrow).
  {
    const [firstCell] = cellPositions();
    const from = firstCell + 2;
    const to = from + 1; // the single 'X'
    cellEditor.view.dispatch(cellEditor.state.tr.setSelection(
      TextSelection.create(cellEditor.state.doc, from, to)
    ));
    cellEditor.commands.deleteSelection();
    const [firstParagraph] = cellParagraphs();
    const seed = firstParagraph.attrs.pendingMarks;
    check('emptying a styled block re-seeds from the removed marks',
      firstParagraph.childCount === 0 &&
      seed?.some((mark) => mark.type === 'textStyle' && mark.attrs.fontFamily === 'Arial') &&
      (cellEditor.state.storedMarks ?? []).some((mark) => mark.type.name === 'textStyle'));
  }

  // Choosing the document default removes that seed component again.
  {
    const [first, second] = cellPositions();
    const selection = CellSelection.create(cellEditor.state.doc, first, second);
    cellEditor.view.dispatch(cellEditor.state.tr.setSelection(selection));
    cellEditor.commands.seedPendingTextStyle({ fontFamily: null, fontSize: null });
  }
  check('a null patch (document default picked) clears the seed',
    cellParagraphs().every((paragraph) => paragraph.attrs.pendingMarks === null));

  // Enter on an empty unstyled paragraph must not conjure formatting.
  {
    const endParagraphPos = cellEditor.state.doc.content.size - 1;
    cellEditor.view.dispatch(cellEditor.state.tr.setSelection(
      TextSelection.near(cellEditor.state.doc.resolve(endParagraphPos))
    ));
    cellEditor.commands.splitBlock();
    const last = cellEditor.state.doc.lastChild;
    check('splitting an empty plain paragraph seeds nothing',
      last.type.name === 'paragraph' && last.attrs.pendingMarks === null);
  }

  // clearFormatting treats the seed as formatting.
  {
    cellEditor.commands.seedPendingTextStyle({ fontFamily: 'Georgia, serif' });
    const before = cellEditor.state.selection.$from.parent.attrs.pendingMarks;
    cellEditor.commands.clearFormatting();
    check('clear formatting drops a pending seed',
      before !== null &&
      cellEditor.state.selection.$from.parent.attrs.pendingMarks === null);
  }

  // Rendering: the empty block previews the pending font and round-trips it.
  {
    cellEditor.commands.seedPendingTextStyle({ fontFamily: 'Arial', fontSize: '16pt' });
    const html = cellEditor.getHTML();
    check('empty seeded block renders a data attribute plus a style preview',
      html.includes('data-pending-marks=') &&
      html.includes('font-family: Arial') && html.includes('font-size: 16pt'));
  }

  // `.sdoc` carries the attribute; unknown FUTURE attrs still parse (the
  // frozen-v1 read promise — computeAttrs drops undeclared keys silently).
  {
    const { createContainer, parseContainer } = await import('../src/io/container.js');
    const json = cellEditor.getJSON();
    const roundTrip = parseContainer(createContainer({ content: json })).content;
    const paragraphJson = {
      type: 'paragraph',
      attrs: {
        pendingMarks: [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }],
        someFutureAttribute: 42,
      },
    };
    let tolerant = true;
    let futureNode = null;
    try {
      futureNode = cellEditor.schema.nodeFromJSON(paragraphJson);
    } catch {
      tolerant = false;
    }
    check('.sdoc round trip keeps the seed and unknown attrs stay tolerated',
      JSON.stringify(roundTrip) === JSON.stringify(json) &&
      tolerant &&
      futureNode?.attrs.pendingMarks?.[0]?.attrs?.fontFamily === 'Arial' &&
      !('someFutureAttribute' in (futureNode?.attrs ?? {})));
  }

  cellEditor.destroy();
}

// ---------------------------------------------------------------------------
// PART 11 — margin click (0.31.1). The pure clamp is fully testable; the
// wiring runs against a stubbed layout because jsdom has no real rects —
// browser behavior is covered by the manual test instructions.
// ---------------------------------------------------------------------------
console.log('\nPART 11 — margin click mapping');
{
  const { clampToRect, attachMarginClick } = await import('../src/core/marginClick.js');
  const rect = { left: 100, right: 500, top: 50, bottom: 800 };

  check('left-margin points clamp to the content edge, Y untouched',
    JSON.stringify(clampToRect({ left: 20, top: 300 }, rect)) ===
      JSON.stringify({ left: 101, top: 300 }));
  check('right/bottom overshoot clamps to the far edges',
    JSON.stringify(clampToRect({ left: 900, top: 900 }, rect)) ===
      JSON.stringify({ left: 499, top: 799 }));
  check('points inside the content column pass through unchanged',
    JSON.stringify(clampToRect({ left: 250, top: 60 }, rect)) ===
      JSON.stringify({ left: 250, top: 60 }));

  // Wiring: a real editor, a stubbed layout. posAtCoords receives the
  // CLAMPED point and the selection lands on the resolved position.
  const marginMount = document.body.appendChild(document.createElement('div'));
  const marginEditor = createEditor(marginMount, {
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Erste Zeile' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Zweite Zeile' }] },
    ] },
  });
  const page = document.createElement('div');
  page.appendChild(document.createElement('div')); // stand-in for #editor
  const targetPos = 15; // inside 'Zweite Zeile'
  let receivedPoint = null;
  marginEditor.view.dom.getBoundingClientRect = () => ({ ...rect });
  marginEditor.view.posAtCoords = (point) => {
    receivedPoint = point;
    return { pos: targetPos, inside: -1 };
  };
  marginEditor.view.focus = () => {};
  attachMarginClick(page, () => marginEditor);

  const mousedown = (target, clientX, clientY) => {
    const event = new dom.window.MouseEvent('mousedown', {
      bubbles: true, cancelable: true, clientX, clientY,
    });
    Object.defineProperty(event, 'target', { value: target });
    page.dispatchEvent(event);
    return event;
  };

  const marginEvent = mousedown(page, 20, 300);
  check('margin mousedown is consumed and maps through the clamp',
    marginEvent.defaultPrevented &&
    JSON.stringify(receivedPoint) === JSON.stringify({ left: 101, top: 300 }) &&
    marginEditor.state.selection.from === targetPos);

  receivedPoint = null;
  const before = marginEditor.state.selection.from;
  const childEvent = mousedown(page.firstChild, 20, 300);
  check('clicks inside the content column stay ProseMirror business',
    !childEvent.defaultPrevented && receivedPoint === null &&
    marginEditor.state.selection.from === before);

  marginEditor.destroy();
}

// ---------------------------------------------------------------------------
// PART 12 — pages base-path tripwires (0.32.0). String-level guards, honest
// about what they are: the REAL proof is the base-path build (done in the
// session and on every CI run) — these lines only make sure nobody quietly
// hardcodes '/' back into the four path-critical files or drops the test
// gate from the deploy workflow.
// ---------------------------------------------------------------------------
console.log('\nPART 12 — pages base-path tripwires (static)');
{
  const { readFileSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  const manifest = JSON.parse(read('../public/manifest.webmanifest'));
  const relative = (value) => typeof value === 'string' && !value.startsWith('/');
  check('manifest travels relative (id, start_url, scope, icons, file handlers)',
    relative(manifest.id) && relative(manifest.start_url) && relative(manifest.scope) &&
    manifest.icons.every((icon) => relative(icon.src)) &&
    manifest.file_handlers.every((handler) => relative(handler.action)));

  const html = read('../index.html');
  const absoluteRefs = [...html.matchAll(/(?:href|src)="\/[^"]*"/g)].map((hit) => hit[0]);
  check('index.html keeps only the Vite entry absolute (rewritten at build)',
    absoluteRefs.length === 1 && absoluteRefs[0] === 'src="/src/main.js"');

  const sw = read('../public/sw.js');
  check('sw.js derives BASE from its own location and roots every path there',
    sw.includes("new URL('./', self.location).pathname") &&
    !/'\/(index\.html|assets\/|manifest|icon)/.test(sw));

  const mainSource = read('../src/main.js');
  check('the worker registration follows import.meta.env.BASE_URL',
    mainSource.includes("serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')"));

  const viteConfig = read('../vite.config.js');
  check('vite.config reads SIMPLEX_BASE and defaults to / everywhere else',
    viteConfig.includes("process.env.SIMPLEX_BASE || '/'"));

  const workflow = read('../.github/workflows/deploy.yml');
  check('the deploy workflow gates on both suites and passes the computed base',
    workflow.includes('npm run test:pages') && workflow.includes('npm run test:ui') &&
    workflow.includes('SIMPLEX_BASE') && workflow.includes('github.event.repository.name'));

  const landing = read('../landing/index.html');
  check('landing links the app relative and roots no path at /',
    landing.includes('href="./app/"') && !/(?:href|src)="\/[^"]/.test(landing));
  check('landing stays self-contained (no external scripts, styles or fonts)',
    !/<script[^>]*\ssrc=/i.test(landing) &&
    !/<link[^>]*rel="stylesheet"/i.test(landing) &&
    !/url\(https?:/i.test(landing));
}

// ---------------------------------------------------------------------------
// PART 13 — WebKit foundation (point 14). classifyPlatform is the one PURE,
// headless-provable piece of the WebKit work: user-agent fixtures for every
// platform family we care about, including the iPadOS "MacIntel" masquerade
// and the engine truth that every iOS browser is WebKit. The CSS side gets
// string tripwires in the part-12 spirit — jsdom has no layout engine, the
// REAL proof is the device protocol shipped with 1.1.0.
// ---------------------------------------------------------------------------
console.log('\nPART 13 — WebKit foundation (platform + touch tripwires)');
{
  const { classifyPlatform } = await import('../src/core/platform.js');

  const iphone = classifyPlatform({
    platform: 'iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
  });
  check('iPhone Safari: Apple modifier + iOS + touch + WebKit',
    iphone.isMac && iphone.isIOS && iphone.isTouch && iphone.isWebKit);

  const ipad = classifyPlatform({
    platform: 'MacIntel', // iPadOS 13+ masquerade — the tell is the touch points
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    maxTouchPoints: 5,
  });
  check('iPad masquerade (MacIntel + touch points) is recognised as iOS',
    ipad.isIOS && ipad.isMac && ipad.isTouch && ipad.isWebKit);

  const macSafari = classifyPlatform({
    platform: 'MacIntel',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    maxTouchPoints: 0,
  });
  check('macOS Safari: Mac + WebKit, not iOS, no touch',
    macSafari.isMac && macSafari.isWebKit && !macSafari.isIOS && !macSafari.isTouch);

  const winChrome = classifyPlatform({
    platform: 'Win32',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    maxTouchPoints: 0,
  });
  check('Windows Chrome: Blink is not WebKit despite the AppleWebKit token',
    !winChrome.isWebKit && !winChrome.isMac && !winChrome.isIOS && !winChrome.isTouch);

  const webview2 = classifyPlatform({
    platform: 'Win32',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    maxTouchPoints: 0,
  });
  check('Tauri WebView2 (Edg token) stays outside isWebKit', !webview2.isWebKit && !webview2.isMac);

  const androidChrome = classifyPlatform({
    platform: 'Linux armv81',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
  });
  check('Android Chrome: touch yes — WebKit, Mac, iOS no',
    androidChrome.isTouch && !androidChrome.isWebKit && !androidChrome.isMac && !androidChrome.isIOS);

  const iosChrome = classifyPlatform({
    platform: 'iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
  });
  check('iOS Chrome (CriOS): engine truth — WebKit', iosChrome.isWebKit && iosChrome.isIOS);

  const macEdge = classifyPlatform({
    platform: 'MacIntel',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    maxTouchPoints: 0,
  });
  check('macOS Edge: Cmd platform yes, WebKit engine no', macEdge.isMac && !macEdge.isWebKit);

  const firefox = classifyPlatform({
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    maxTouchPoints: 0,
  });
  check('Firefox (Gecko, no AppleWebKit token) is not WebKit', !firefox.isWebKit);

  const empty = classifyPlatform();
  check('pure and safe on empty input: everything false',
    !empty.isMac && !empty.isIOS && !empty.isTouch && !empty.isWebKit);

  const garbage = classifyPlatform({ platform: 42, userAgent: null, maxTouchPoints: 'five' });
  check('garbage input degrades to false instead of throwing',
    !garbage.isMac && !garbage.isIOS && !garbage.isTouch && !garbage.isWebKit);

  const runA = classifyPlatform({ platform: 'iPhone', userAgent: 'x AppleWebKit/605 x', maxTouchPoints: 1 });
  const runB = classifyPlatform({ platform: 'iPhone', userAgent: 'x AppleWebKit/605 x', maxTouchPoints: 1 });
  check('same input, same output (no hidden global read)',
    JSON.stringify(runA) === JSON.stringify(runB));

  // --- string tripwires (part-12 honesty: guards, not proof) ---
  const { readFileSync } = await import('node:fs');
  const readRel = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const css = readRel('../src/styles/app.css');

  const plainVh = (css.match(/\d+(?:\.\d+)?vh\b/g) ?? []).sort();
  const smallVh = (css.match(/\d+(?:\.\d+)?svh\b/g) ?? []).map((v) => v.replace('svh', 'vh')).sort();
  check('every vh cap in app.css has its svh twin (iOS URL-bar truth)',
    plainVh.length >= 2 && JSON.stringify(plainVh) === JSON.stringify(smallVh),
    `vh: ${plainVh.join(',')} — svh: ${smallVh.join(',')}`);

  const coarseAt = css.indexOf('@media (hover: none) and (pointer: coarse)');
  const coarseBlock = (() => {
    if (coarseAt < 0) return '';
    const open = css.indexOf('{', coarseAt);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open, i + 1);
      }
    }
    return '';
  })();
  check('coarse-pointer block lifts the focusable controls to 16px (iOS auto-zoom)',
    coarseBlock.includes('font-size: 16px') &&
    coarseBlock.includes('.toolbar-input--size') &&
    coarseBlock.includes('.dialog-input') &&
    coarseBlock.includes('.search-panel-input') &&
    coarseBlock.includes('.toolbar-select') &&
    coarseBlock.includes('.toolbar-popover-input'));

  check('tap highlight is disabled (chrome has its own active/focus styles)',
    css.includes('-webkit-tap-highlight-color: transparent'));

  check('touch-action: manipulation covers buttons and form controls',
    /button,\s*\ninput,\s*\nselect,\s*\ntextarea\s*\{\s*\n\s*touch-action: manipulation;/.test(css));

  const mainSrc = readRel('../src/main.js');
  check('platform module is wired into the boot (no dead code)',
    mainSrc.includes("from './core/platform.js'") && mainSrc.includes('applyPlatformClasses()'));
}

/* ==========================================================================
 * PART 14 — DOCX import fidelity (1.2.0)
 * A synthetic GERMAN Word file (built with fflate the way the format-gate
 * part builds its legacy ZIP): mammoth's default map only knows the English
 * "Heading1"/"Heading 1", so these paragraphs used to arrive as plain <p>s
 * and every deliberate blank line was swallowed. mammoth needs only
 * word/document.xml + word/styles.xml (findPartPaths fallback, verified
 * against the pinned 1.12.0).
 * ========================================================================== */
console.log('\nPART 14 — DOCX import fidelity (German headings, blank lines)');

{
  const { zipSync, strToU8 } = await import('fflate');
  const { readDocxOutlineStyles } = await import('../src/io/docxImport.js');

  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // Real German Word writes styleId "berschrift1" (the Ü is dropped from the
  // ASCII-cleaned id) and a localised w:name — exactly what never matched.
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
  <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Standard"/></w:style>
  <w:style w:type="paragraph" w:styleId="berschrift1">
    <w:name w:val="Überschrift 1"/><w:basedOn w:val="Standard"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="berschrift2">
    <w:name w:val="Überschrift 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="MeinTitel">
    <w:name w:val="Mein Titel"/><w:basedOn w:val="berschrift1"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="berschrift4">
    <w:name w:val="Überschrift 4"/>
    <w:pPr><w:outlineLvl w:val="3"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Textkoerper">
    <w:name w:val="Textkörper"/>
    <w:pPr><w:outlineLvl w:val="9"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ZyklusA"><w:name w:val="Zyklus A"/><w:basedOn w:val="ZyklusB"/></w:style>
  <w:style w:type="paragraph" w:styleId="ZyklusB"><w:name w:val="Zyklus B"/><w:basedOn w:val="ZyklusA"/></w:style>
</w:styles>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
  <w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr><w:r><w:t>Kapitel</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="berschrift2"/></w:pPr><w:r><w:t>Abschnitt</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="MeinTitel"/></w:pPr><w:r><w:t>Erbe</w:t></w:r></w:p>
  <w:p/>
  <w:p/>
  <w:p><w:r><w:t>Fliesstext</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="berschrift1"/><w:ind w:left="709"/></w:pPr><w:r><w:t>Eingerueckt</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="berschrift4"/></w:pPr><w:r><w:t>Tief</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="ZyklusA"/></w:pPr><w:r><w:t>Kreisel</w:t></w:r></w:p>
</w:body></w:document>`;
  const germanDocx = zipSync({
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
  });

  /* 14.1 The styleId → level map itself */
  const outlineMap = readDocxOutlineStyles(germanDocx);
  check('outline map carries the German built-in headings (berschrift1→1, berschrift2→2)',
    outlineMap.berschrift1 === 1 && outlineMap.berschrift2 === 2,
    JSON.stringify(outlineMap));
  check('a derived style inherits its level through the basedOn chain',
    outlineMap.MeinTitel === 1);
  check('outlineLvl beyond h3 and the body-text value 9 are never mapped',
    !('berschrift4' in outlineMap) && !('Textkoerper' in outlineMap) &&
    !('Standard' in outlineMap));
  check('a basedOn cycle degrades to "no heading" instead of throwing',
    !('ZyklusA' in outlineMap) && !('ZyklusB' in outlineMap));
  check('readDocxOutlineStyles is pure (same input → same map)',
    JSON.stringify(readDocxOutlineStyles(germanDocx)) === JSON.stringify(outlineMap));
  check('garbage input degrades to an empty map',
    JSON.stringify(readDocxOutlineStyles(new Uint8Array([1, 2, 3]))) === '{}');

  /* 14.2 The full mammoth round trip with the map applied */
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(germanDocx) },
    docxImportOptions(mammoth, outlineMap)
  );
  const html = result.value;
  check('German headings arrive as h1/h2 (language-independent via outlineLvl)',
    html.includes('<h1>Kapitel</h1>') && html.includes('<h2>Abschnitt</h2>'), html);
  check('the basedOn-derived heading arrives as h1 too',
    html.includes('<h1>Erbe</h1>'), html);
  check('deliberate blank lines survive (ignoreEmptyParagraphs: false)',
    (html.match(/<p><\/p>/g) || []).length >= 2, html);
  check('an INDENTED heading stays a heading — never rewritten to sw-indent',
    html.includes('<h1>Eingerueckt</h1>') && !html.includes('sw-indent'), html);
  check('outline level 3 (h4 territory) deliberately stays a paragraph',
    /<p[^>]*>Tief<\/p>/.test(html), html);
  check('mapped German style ids raise no unrecognised-style warning',
    !(result.messages ?? []).some((m) =>
      /berschrift1|berschrift2|MeinTitel/.test(String(m.message))),
    JSON.stringify(result.messages));

  /* 14.3 …and the editor parses the result into real heading nodes (fresh
     instance — the shared one is destroyed after part 5, ed2 pattern). */
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  const ed14 = createEditor(holder, { content: html });
  let h1Count = 0;
  let h2Count = 0;
  ed14.state.doc.descendants((node) => {
    if (node.type.name === 'heading' && node.attrs.level === 1) h1Count += 1;
    if (node.type.name === 'heading' && node.attrs.level === 2) h2Count += 1;
  });
  check('the editor parses the imported HTML into heading nodes (3× h1, 1× h2)',
    h1Count === 3 && h2Count === 1, `h1=${h1Count} h2=${h2Count}`);
  ed14.destroy();
}

/* ==========================================================================
 * PART 15 — list/quote page breaks and blank lines in print (1.2.1)
 * Two separate real-world bugs from one document:
 *   (a) the bullet stayed on one page while its text moved to the next — the
 *       break position pointed INSIDE the list item;
 *   (b) the PDF collapsed every blank line — getHTML() serialises an empty
 *       paragraph as bare <p></p>, which has no line box at all.
 * (a) is provable on the real document tree (jsdom has no layout, but it has
 * a real tree); (b) is a generated-stylesheet tripwire — the visual proof is
 * the device protocol.
 * ========================================================================== */
console.log('\nPART 15 — list breaks and blank lines in print');

{
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  const ed15 = createEditor(holder, {
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'two-cont' }] },
              ],
            },
          ],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quote' }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    },
  });
  const doc15 = ed15.state.doc;
  const specs = collectFlowUnits(doc15);
  const byText = (needle) => specs.find((s) => s.node.textContent === needle);
  const parentAt = (pos) => doc15.resolve(pos).parent.type.name;

  check('the list is flattened into its item paragraphs (v1 behaviour kept)',
    specs.length === 6 &&
    specs.map((s) => s.node.textContent).join('|') === 'before|one|two|two-cont|quote|after',
    `${specs.length}: ${specs.map((s) => s.node.textContent).join('|')}`);

  const one = byText('one');
  check('FIRST item: inner pos sits inside the listItem, breakPos before the LIST',
    parentAt(one.pos) === 'listItem' && parentAt(one.breakPos) === 'doc' &&
    one.breakPos < one.pos,
    `pos=${one.pos} (${parentAt(one.pos)}) breakPos=${one.breakPos} (${parentAt(one.breakPos)})`);

  const two = byText('two');
  check('LATER item: breakPos is hoisted to the item, not to the whole list',
    parentAt(two.breakPos) === 'bulletList' && two.breakPos < two.pos,
    `pos=${two.pos} (${parentAt(two.pos)}) breakPos=${two.breakPos} (${parentAt(two.breakPos)})`);

  const cont = byText('two-cont');
  check('a FOLLOW-UP paragraph in the same item is never hoisted (it has no marker)',
    cont.breakPos === cont.pos && parentAt(cont.pos) === 'listItem');

  const quote = byText('quote');
  check('a blockquote start hoists out of the quote (its left bar tears alike)',
    parentAt(quote.pos) === 'blockquote' && parentAt(quote.breakPos) === 'doc' &&
    quote.breakPos < quote.pos);

  check('plain top-level paragraphs are unchanged (breakPos === pos)',
    byText('before').breakPos === byText('before').pos &&
    byText('after').breakPos === byText('after').pos);

  check('collectFlowUnits is pure (same tree → same specs)',
    JSON.stringify(collectFlowUnits(doc15).map((s) => [s.pos, s.breakPos, s.type])) ===
    JSON.stringify(specs.map((s) => [s.pos, s.breakPos, s.type])));

  /* …and the rule core turns a hoisted spec into a hoisted break. Real
     positions plus synthetic geometry, every item ONE line tall — the
     reported case: the orphan rule refuses a one-line split, so the item
     travels as a block break, which is exactly where hoisting must apply. */
  const geo = specs.map((s, k) => ({
    ...s, top: k * 300, bottom: k * 300 + 300,
    marginTopPx: 0, marginBottomPx: 0, floatBottom: null,
  }));
  const r15 = computeBreaks(
    geo,
    { ...OPTS, contentHeight: 800 },
    (index) => [{ top: geo[index].top, bottom: geo[index].bottom, pos: geo[index].pos + 1 }]
  );
  const firstBreak = r15.breaks[0];
  check('a one-line list item travels whole and reports the HOISTED position',
    firstBreak !== undefined && firstBreak.kind === 'block' &&
    firstBreak.pos === two.breakPos && firstBreak.pos !== two.pos,
    JSON.stringify(r15.breaks.map((b) => ({ pos: b.pos, kind: b.kind }))));
  check('the reported break position opens the list item on the new page',
    firstBreak !== undefined && parentAt(firstBreak.pos) === 'bulletList');

  ed15.destroy();
}

/* Blank lines in print: the generated sheet must restore a line box for
   empty textblocks — the one sheet that reaches the chunker (0.22.0). */
{
  const css = buildPrintCss({
    pageFormat: 'a4', pageOrientation: 'portrait',
    pageMarginsMm: { top: 25, right: 20, bottom: 20, left: 25 },
    headerText: '', footerText: '', firstPageDifferent: false,
    firstHeaderText: '', firstFooterText: '',
    pageNumberFormat: 'number', pageNumberPosition: 'center',
  });
  check('print CSS gives empty paragraphs a line box (zero-width space)',
    /p:empty::before/.test(css) && css.includes('\\200B'), css.slice(-400));
  check('empty headings and quotes get the same treatment',
    /h1:empty::before/.test(css) && /h2:empty::before/.test(css) &&
    /h3:empty::before/.test(css) && /blockquote:empty::before/.test(css));
  check('the rule lives in the GENERATED sheet, not only in print.css',
    css.indexOf(':empty::before') > css.indexOf('@page'));
}

console.log(`\nTOTAL: ${passed} ok (${part1Passed} rules + ${passed - part1Passed} integration), ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
