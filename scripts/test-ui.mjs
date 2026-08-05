// scripts/test-ui.mjs
// ---------------------------------------------------------------------------
// Headless STRUCTURE smokes for the chrome (feature 4):
//
//   PART 1 — the chrome (toolbar + status bar) builds in de AND en without
//            any console output. The i18n t() helper warns on missing keys,
//            so a silent build doubles as a key-coverage check for every
//            string the chrome bakes into the DOM.
//   PART 2 — every toolbar control is wired: clicking runs its command
//            (incl. 0.31.1: font family/size SEED empty selected table cells)
//            against the REAL editor and the effect is asserted on the
//            document/state (no spy editor — a recorded call to a mistyped
//            command would be a green lie). Includes the disabled states:
//            undo/redo on an empty history, the indent bounds at level 0
//            and indentMaxLevels, page break inside a table. A tripwire
//            asserts that every `.toolbar-button` in the bar was touched —
//            a new button fails the suite until the harness covers it.
//   PART 3 — dialogs open and close: base dialog, page setup (OK applies to
//            the docSettings, Cancel does not), settings (live re-label on a
//            language switch), shortcuts, backups (empty state, needs
//            fake-indexeddb like part 4 of test-pagination.mjs).
//
//   node scripts/test-ui.mjs      (npm run test:ui)
//
// Deliberately NOT tested here: overflow/compact fitting math, widths, the
// sizebox layout — jsdom has no layout engine, every rect is 0×0, and any
// assertion on them would pass for the wrong reason. The fit logic only has
// to RUN without throwing (covered by the silent build); its behavior stays
// browser territory (manual test instructions per feature).
//
// Needs jsdom (and fake-indexeddb for the backups dialog) — exact
// devDependencies since 0.29.2: npm ci installs them, the lockfile freezes
// their transitives (the 0.29.0 selector-engine lesson).
// Without jsdom (npm i --omit=dev) the suite is skipped with a warning.
// ---------------------------------------------------------------------------

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

/* ========================================================================== */
/* jsdom gate + environment (same shim philosophy as test-pagination.mjs)    */
/* ========================================================================== */

let JSDOM = null;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.warn('test:ui skipped — jsdom missing (npm ci installs the pinned devDependencies)');
  process.exit(0);
}

const dom = new JSDOM(
  '<!doctype html><html><body>' +
    '<div id="toolbar"></div><div id="editor"></div><div id="statusbar"></div>' +
    '</body></html>',
  { pretendToBeVisual: true, url: 'http://localhost/' } // real origin → localStorage works
);
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
globalThis.localStorage = dom.window.localStorage;

// ProseMirror's scroll/coords path expects layout APIs that jsdom does not
// implement on Text and Range. Zero-rects are the standard PM-in-jsdom shim.
const zeroRect = () => new dom.window.DOMRect(0, 0, 0, 0);
for (const proto of [dom.window.Text.prototype, dom.window.Range.prototype]) {
  if (!proto.getClientRects) proto.getClientRects = () => [];
  if (!proto.getBoundingClientRect) proto.getBoundingClientRect = zeroRect;
}

// jsdom implements neither ResizeObserver (toolbar fit pass) nor matchMedia
// (module-level in core/theme.js, pulled in by the settings dialog). Both
// shims are inert on purpose: the fit MATH is exactly what this suite does
// not test, and the theme side only needs the query object to exist.
if (!dom.window.ResizeObserver) {
  dom.window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
globalThis.ResizeObserver = dom.window.ResizeObserver;
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

/* Trap Node's console around a build step: the chrome must come up silent.
   (Our modules call the bare `console`, which resolves to Node's global —
   t() warns there about missing i18n keys, appState.emit logs listener
   errors there. jsdom's own window console is a separate, unused object.) */
const buildSilently = (label, build) => {
  const captured = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (...args) => captured.push(args.join(' '));
  console.warn = (...args) => captured.push(args.join(' '));
  let result;
  try {
    result = build();
  } finally {
    console.error = original.error;
    console.warn = original.warn;
  }
  check(`${label} builds without console errors/warnings`,
    captured.length === 0, captured.join(' | '));
  return result;
};

/* All src imports happen AFTER the environment is in place — theme.js runs
   window.matchMedia at import time, the editor touches document. */
const { settings } = await import('../src/config/settings.js');
const { appState } = await import('../src/core/appState.js');
const { initI18n, setLanguage, t } = await import('../src/i18n/index.js');
const { initDocSettings, updateDocSettings } = await import('../src/core/docSettings.js');
const { createEditor } = await import('../src/core/editor.js');
const { initToolbar } = await import('../src/ui/toolbar.js');
const { createFileMenu } = await import('../src/ui/fileMenu.js');
const { initStatusbar } = await import('../src/ui/statusbar.js');
const { showDialog } = await import('../src/ui/dialogs/dialog.js');
const { showPageSetupDialog } = await import('../src/ui/dialogs/pageSetup.js');
const { showSettingsDialog } = await import('../src/ui/dialogs/settingsDialog.js');
const { showShortcutsDialog } = await import('../src/ui/dialogs/shortcutsDialog.js');

initI18n(); // de — the stored-language read is main.js territory
initDocSettings();

const editorElement = document.getElementById('editor');
const toolbarElement = document.getElementById('toolbar');
const statusbarElement = document.getElementById('statusbar');

const editor = createEditor(editorElement, { content: null });
const getEditor = () => editor;

/* Menu/toolbar actions as counting spies — the io layer behind them has its
   own coverage in test:pages; here only the WIRING trigger → action counts. */
const spy = () => {
  const fn = (...args) => {
    fn.calls += 1;
    fn.lastArgs = args;
  };
  fn.calls = 0;
  return fn;
};
const menuActions = {
  newDocument: spy(),
  openDocument: spy(),
  save: spy(),
  saveAs: spy(),
  backups: spy(),
  importDocx: spy(),
  exportDocx: spy(),
  pageSetup: spy(),
  print: spy(),
  shortcuts: spy(),
  settings: spy(),
  openRecent: spy(),
  loadRecents: () => Promise.resolve([]),
};
const toolbarActions = { openSearch: spy(), openLink: spy() };

const buildChrome = () =>
  buildSilently(`chrome (${document.documentElement.lang})`, () => ({
    toolbar: initToolbar(
      toolbarElement,
      getEditor,
      [createFileMenu(menuActions)],
      toolbarActions
    ),
    statusbar: initStatusbar(statusbarElement, getEditor),
  }));

/* Version forensics for drift debugging — the realm's moving parts. */
try {
  const { createRequire } = await import('node:module');
  const localRequire = createRequire(import.meta.url);
  console.log(
    `-- realm: Node ${process.version}`,
    `· jsdom ${localRequire('jsdom/package.json').version}`,
    `· dom-selector ${localRequire('@asamuzakjp/dom-selector/package.json').version}`
  );
} catch { /* forensics only — never fail the suite over it */ }

/* Look controls up by their accessible name — the same t() key the toolbar
   used to build them. A miss means the control or its label is gone.
   Deliberately a DOM scan instead of an attribute selector: labels carry
   free text ("Suchen & Ersetzen"), and jsdom's selector engine is a FLOATING
   transitive dependency (@asamuzakjp/dom-selector) — 0.29.0 died on a fresh
   install whose same-day engine release choked on the "&", while older
   installs passed. Scanning compares strings, not selector grammars. */
const byAria = (root, label) =>
  [...root.querySelectorAll('[aria-label]')]
    .find((element) => element.getAttribute('aria-label') === label) ?? null;
const byLabel = (key) => {
  const label = t(key);
  const element = byAria(toolbarElement, label);
  if (!element) {
    check(`control "${key}" present`, false, `no [aria-label="${label}"]`);
  }
  return element;
};

const touched = new Set();
const click = (element) => {
  // Guard: a missed lookup already logged its FAIL — keep the suite counting
  // instead of dying on null.click() with a TypeError (0.29.0 lesson).
  if (!element) {
    check('click target present (guard — see previous FAIL)', false);
    return;
  }
  touched.add(element);
  element.click();
};

const openPanel = (trigger) => {
  click(trigger);
  return trigger.closest('.toolbar-dropdown')?.querySelector('.toolbar-popover');
};

const panelOption = (panel, text) =>
  [...panel.querySelectorAll('.toolbar-popover-option')].find(
    (option) => (option.querySelector('span') ?? option).textContent === text
  );

const docJson = () => JSON.stringify(editor.getJSON());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Bounded polling for async UI (fake-indexeddb resolves over several tasks). */
const waitFor = async (condition, tries = 100) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (condition()) return true;
    await tick();
  }
  return condition();
};

/* ========================================================================== */
console.log('PART 1 — chrome builds in de and en, silent and translated');
/* ========================================================================== */

let chrome = buildChrome();

const deUndoLabel = t('toolbar.undo');
const deMenuLabel = t('menu.file');
check('de: undo button carries the de label', byLabel('toolbar.undo') !== null);
check('de: file menu trigger carries the de label',
  toolbarElement.querySelector('.toolbar-menu-trigger')?.textContent === deMenuLabel);
check('de: toolbar sections and the ⋯ control are in the DOM',
  toolbarElement.querySelectorAll('.toolbar-section').length >= 9 &&
  toolbarElement.querySelector('.toolbar-overflow') !== null);
check('de: status bar shows app name and version',
  statusbarElement.querySelector('.statusbar-info')?.textContent ===
    `${settings.app.name} ${settings.app.version}`);

chrome.toolbar.destroy();
chrome.statusbar.destroy();
setLanguage('en');
chrome = buildChrome();

check('en: undo button carries the en label', byLabel('toolbar.undo') !== null);
check('en: labels actually changed with the language',
  t('toolbar.undo') !== deUndoLabel &&
  toolbarElement.querySelector('.toolbar-menu-trigger')?.textContent !== deMenuLabel);

/* Interactions below run against the primary language. */
chrome.toolbar.destroy();
chrome.statusbar.destroy();
setLanguage('de');
chrome = buildChrome();

/* ========================================================================== */
console.log('\nPART 2 — every toolbar control wired (click → command → effect)');
/* ========================================================================== */

/* Disabled states on the fresh, empty history (plan: "Undo leer"). */
const undoButton = byLabel('toolbar.undo');
const redoButton = byLabel('toolbar.redo');
check('undo disabled on an empty history', undoButton.disabled === true);
check('redo disabled on an empty history', redoButton.disabled === true);

/* NOTE selection shape: a real user always carries a TextSelection — that is
   what refresh()/isActive are built for. selectAll() would create an
   AllSelection, for which Tiptap's node-isActive() reports false even when
   the command applied. The helper therefore selects the text range. */
const selectAllText = () =>
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

editor.commands.setContent('<p>Alpha beta gamma</p>');
selectAllText();
check('undo enabled after the first change', undoButton.disabled === false);

/* Marks ------------------------------------------------------------------ */
for (const [key, mark] of [
  ['toolbar.bold', 'bold'],
  ['toolbar.italic', 'italic'],
  ['toolbar.underline', 'underline'],
  ['toolbar.strike', 'strike'],
]) {
  click(byLabel(key));
  check(`${mark} toggles on via its button`, editor.isActive(mark) === true);
}
click(byLabel('toolbar.subscript'));
check('subscript toggles on via its button', editor.isActive('subscript'));
click(byLabel('toolbar.superscript'));
check('superscript replaces subscript (schema exclusion, via buttons)',
  editor.isActive('superscript') && !editor.isActive('subscript'));

click(byLabel('toolbar.clearFormat'));
check('clear formatting resets every mark via its button',
  ['bold', 'italic', 'underline', 'strike', 'superscript'].every(
    (mark) => !editor.isActive(mark)
  ));

/* Paragraph format select -------------------------------------------------- */
const paragraphSelect = byLabel('toolbar.paragraphFormat');
const changeSelect = (select, value) => {
  select.value = value;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
changeSelect(paragraphSelect, 'h1');
check('paragraph select applies heading 1', editor.isActive('heading', { level: 1 }));
changeSelect(paragraphSelect, 'quote');
check('paragraph select applies the quote style', editor.isActive('blockquote'));
changeSelect(paragraphSelect, 'p');
check('paragraph select returns to plain text',
  editor.isActive('paragraph') && !editor.isActive('blockquote'));

/* Font family select ------------------------------------------------------- */
const fontSelect = byLabel('toolbar.fontFamily');
const nonDefaultFont = settings.editor.fonts.find(
  (font) => font.css !== settings.editor.fontFamily
);
selectAllText();
changeSelect(fontSelect, nonDefaultFont.css);
check('font select stores the picked family as a mark',
  editor.getAttributes('textStyle').fontFamily === nonDefaultFont.css);
changeSelect(fontSelect, settings.editor.fontFamily);
check('font select on the document default removes the mark',
  editor.getAttributes('textStyle').fontFamily == null);

/* Font size: field, presets, A− / A+ -------------------------------------- */
const sizeInput = byLabel('toolbar.fontSize');
sizeInput.value = '15';
sizeInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
check('size field applies a free value', editor.getAttributes('textStyle').fontSize === '15pt');
click(byLabel('toolbar.fontSizeIncrease'));
check('A+ steps one point up', editor.getAttributes('textStyle').fontSize === '16pt');
click(byLabel('toolbar.fontSizeDecrease'));
check('A− steps one point down', editor.getAttributes('textStyle').fontSize === '15pt');

const presetsPanel = openPanel(byLabel('toolbar.fontSizePresets'));
check('size presets panel lists every preset',
  presetsPanel !== null &&
  presetsPanel.querySelectorAll('.toolbar-popover-option').length ===
    settings.editor.fontSizesPt.length);
const defaultSizeOption = [...presetsPanel.querySelectorAll('.toolbar-popover-option')].find(
  (option) => option.textContent === settings.editor.fontSizePt.toLocaleString('de')
);
defaultSizeOption.click();
check('picking the default preset removes the size mark (field/preset share rules)',
  editor.getAttributes('textStyle').fontSize == null &&
  toolbarElement.querySelector('.toolbar-popover--sizes') === null);

/* Pending seed via the toolbar (0.31.1): empty table cells ------------------ */
{
  const { CellSelection } = await import('@tiptap/pm/tables');
  editor.commands.focus('end');
  editor.commands.insertTable({ rows: 1, cols: 2, withHeaderRow: false });
  const cellPositions = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') cellPositions.push(pos);
  });
  editor.view.dispatch(editor.state.tr.setSelection(
    CellSelection.create(editor.state.doc, cellPositions[0], cellPositions[1])
  ));
  const cellSeeds = () => {
    const seeds = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableCell') seeds.push(node.firstChild.attrs.pendingMarks);
    });
    return seeds;
  };

  changeSelect(fontSelect, nonDefaultFont.css);
  check('font select seeds EMPTY selected cells and the display shows the seed',
    cellSeeds().every((seed) =>
      seed?.some((mark) => mark.type === 'textStyle' &&
        mark.attrs.fontFamily === nonDefaultFont.css)) &&
    fontSelect.value === nonDefaultFont.css);

  sizeInput.value = '17';
  sizeInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('size field seeds EMPTY selected cells alongside the family',
    cellSeeds().every((seed) =>
      seed?.some((mark) => mark.type === 'textStyle' &&
        mark.attrs.fontFamily === nonDefaultFont.css &&
        mark.attrs.fontSize === '17pt')));

  editor.commands.deleteTable();
  let tableLeft = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') tableLeft = true;
  });
  check('cleanup: the seeded probe table is gone again', !tableLeft);
}

/* Link + search hand over to their UI modules ------------------------------ */
click(byLabel('toolbar.link'));
check('link button calls the link UI', toolbarActions.openLink.calls === 1);
click(byLabel('toolbar.search'));
check('search button opens the search panel', toolbarActions.openSearch.calls === 1);

/* Color + highlight -------------------------------------------------------- */
selectAllText();
const colorPanel = openPanel(byLabel('toolbar.textColor'));
check('text color panel shows the full palette',
  colorPanel !== null &&
  colorPanel.querySelectorAll('.toolbar-swatch').length === settings.colors.text.length);
colorPanel.querySelector('.toolbar-swatch').click();
check('picking a swatch sets the color mark',
  editor.getAttributes('textStyle').color === settings.colors.text[0].value);
openPanel(byLabel('toolbar.textColor')).querySelector('.toolbar-popover-reset').click();
check('the reset entry removes the color mark',
  editor.getAttributes('textStyle').color == null);

const highlightPanel = openPanel(byLabel('toolbar.highlight'));
check('highlight panel shows the full palette',
  highlightPanel !== null &&
  highlightPanel.querySelectorAll('.toolbar-swatch').length ===
    settings.colors.highlight.length);
highlightPanel.querySelector('.toolbar-swatch').click();
check('picking a swatch sets the highlight mark',
  editor.getAttributes('highlight').color === settings.colors.highlight[0].value);
openPanel(byLabel('toolbar.highlight')).querySelector('.toolbar-popover-reset').click();
check('the reset entry removes the highlight mark',
  editor.getAttributes('highlight').color == null);

/* Alignment ----------------------------------------------------------------- */
for (const alignment of ['Center', 'Right', 'Justify', 'Left']) {
  click(byLabel(`toolbar.align${alignment}`));
  check(`alignment ${alignment.toLowerCase()} applies via its button`,
    editor.isActive({ textAlign: alignment.toLowerCase() }));
}

/* Line height + space after (spacing dropdown) ----------------------------- */
const lineHeightValue = settings.editor.lineHeights[1];
let spacingPanel = openPanel(byLabel('toolbar.spacing'));
panelOption(spacingPanel, lineHeightValue.toLocaleString('de')).click();
check('spacing panel applies a line-height preset',
  editor.getAttributes('paragraph').lineHeight === String(lineHeightValue));

const spaceAfterValue = settings.editor.paragraphSpacingsPt[1];
spacingPanel = openPanel(byLabel('toolbar.spacing'));
panelOption(spacingPanel, t('spacing.afterValue', { value: spaceAfterValue })).click();
check('spacing panel applies a space-after preset',
  editor.getAttributes('paragraph').spaceAfter === `${spaceAfterValue}pt`);

/* Lists ---------------------------------------------------------------------*/
click(byLabel('toolbar.bulletList'));
check('bullet list toggles on via its button', editor.isActive('bulletList'));
click(byLabel('toolbar.orderedList'));
check('ordered list takes over via its button',
  editor.isActive('orderedList') && !editor.isActive('bulletList'));
click(byLabel('toolbar.orderedList'));
check('ordered list toggles back off', !editor.isActive('orderedList'));

/* Indent bounds (plan: "Einzug-Grenzen") ------------------------------------ */
editor.commands.setContent('<p>Einzug</p>');
const indentButton = byLabel('toolbar.indentIncrease');
const outdentButton = byLabel('toolbar.indentDecrease');
check('outdent disabled at level 0', outdentButton.disabled === true);
check('indent enabled at level 0', indentButton.disabled === false);
for (let level = 0; level < settings.editor.indentMaxLevels; level += 1) {
  click(indentButton);
}
check(`indent reaches level ${settings.editor.indentMaxLevels}`,
  editor.getAttributes('paragraph').indent === settings.editor.indentMaxLevels);
check('indent disabled at the maximum level', indentButton.disabled === true);
check('outdent enabled at the maximum level', outdentButton.disabled === false);
for (let level = 0; level < settings.editor.indentMaxLevels; level += 1) {
  click(outdentButton);
}
check('outdent walks back to level 0 and greys out',
  (editor.getAttributes('paragraph').indent ?? 0) === 0 &&
  outdentButton.disabled === true && indentButton.disabled === false);

/* Page break + its in-table guard ------------------------------------------- */
const pageBreakButton = byLabel('toolbar.pageBreak');
click(pageBreakButton);
const hasPageBreak = () => {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'pageBreak') found = true;
  });
  return found;
};
check('page-break button inserts the node', hasPageBreak());

/* Table: insert via the size grid, act via the context menu ------------------ */
const tableButton = byLabel('toolbar.table');
let tablePanel = openPanel(tableButton);
const pickerCells = tablePanel.querySelectorAll('.toolbar-table-cell');
check('table panel outside a table shows the size grid',
  pickerCells.length === settings.table.pickerMax ** 2);
tablePanel.querySelector('[data-rows="2"][data-cols="2"]').click();
check('picking a grid cell inserts the table', editor.isActive('table'));
check('page break disabled inside a table (command guard drives the button)',
  pageBreakButton.disabled === true);

tablePanel = openPanel(tableButton);
check('table panel inside a table becomes the action menu',
  tablePanel.querySelectorAll('.toolbar-table-cell').length === 0 &&
  tablePanel.querySelectorAll('.toolbar-popover-option').length === 8);
panelOption(tablePanel, t('table.deleteTable')).click();
check('the delete entry removes the table',
  !editor.isActive('table') && pageBreakButton.disabled === false);

/* Undo / redo round trip through the buttons. Deliberately no claim about
   the EXACT restored state: the history groups rapid steps (newGroupDelay),
   so headless one undo may cover insert+delete together — grouping is a
   Tiptap policy, not chrome wiring. Wiring means: undo changes the document
   and arms redo, redo returns exactly to the pre-undo state. */
const beforeUndo = docJson();
click(undoButton);
check('undo button changes the document and arms redo',
  docJson() !== beforeUndo && redoButton.disabled === false);
click(redoButton);
check('redo button returns exactly to the pre-undo state', docJson() === beforeUndo);

/* Image: opens a native file picker — nothing observable headless, the click
   only must not throw (insertImageFiles has DOCX/paste coverage elsewhere). */
click(byLabel('toolbar.image'));
check('image button click passes without throwing', true);

/* File menu: every entry fires exactly its action and closes the panel. */
const menuTrigger = toolbarElement.querySelector('.toolbar-menu-trigger');
const menuWrap = menuTrigger.closest('.toolbar-dropdown');
for (const [key, action] of [
  ['file.new', menuActions.newDocument],
  ['file.open', menuActions.openDocument],
  ['file.save', menuActions.save],
  ['file.saveAs', menuActions.saveAs],
  ['file.backups', menuActions.backups],
  ['file.importDocx', menuActions.importDocx],
  ['file.exportDocx', menuActions.exportDocx],
  ['file.pageSetup', menuActions.pageSetup],
  ['file.print', menuActions.print],
  ['file.shortcuts', menuActions.shortcuts],
  ['file.settings', menuActions.settings],
]) {
  click(menuTrigger);
  const panel = menuWrap.querySelector('.toolbar-popover');
  const item = panelOption(panel, t(key));
  if (!item) {
    check(`menu entry "${key}" present`, false);
    continue;
  }
  item.click();
  check(`menu entry "${key}" fires its action and closes`,
    action.calls === 1 && menuWrap.querySelector('.toolbar-popover') === null);
}

/* ⋯ overflow: nothing is collapsed headless (no layout), but the toggle and
   its ARIA wiring must work — no claims about WHAT would collapse. */
const moreButton = byLabel('toolbar.more');
click(moreButton);
check('⋯ opens its (empty) panel', moreButton.getAttribute('aria-expanded') === 'true');
click(moreButton);
check('⋯ closes again', moreButton.getAttribute('aria-expanded') === 'false');

/* Tripwire: every toolbar button was exercised above. A new button fails
   here by name until the harness covers it. */
const untouched = [...toolbarElement.querySelectorAll('button.toolbar-button')]
  .filter((button) => !touched.has(button))
  .map((button) => button.getAttribute('aria-label'));
check('every toolbar button was exercised', untouched.length === 0,
  `untouched: ${untouched.join(', ')}`);

/* Status bar: the two stateful controls (plan scope: chrome smokes only). */
const pagelessLabel = t('statusbar.viewPageless');
click(byAria(statusbarElement, pagelessLabel));
check('status-bar view switch writes the app state',
  appState.get('viewMode') === 'pageless');
click(byAria(statusbarElement, t('statusbar.zoomIn')));
check('status-bar zoom + steps by zoomStep',
  appState.get('zoom') === settings.view.zoomDefault + settings.view.zoomStep);

/* ========================================================================== */
console.log('\nPART 3 — dialogs open and close');
/* ========================================================================== */

const overlayInDom = () => document.querySelector('.dialog-overlay') !== null;
const pressEscape = () =>
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));

/* Base dialog ---------------------------------------------------------------*/
{
  const promise = showDialog({
    title: 'T', message: 'M', defaultValue: 'default',
    buttons: [
      { label: 'No', value: 'no' },
      { label: 'Yes', value: 'yes', primary: true },
    ],
  });
  check('base dialog opens', overlayInDom() &&
    document.querySelector('.dialog[role="dialog"]') !== null);
  document.querySelector('.dialog-button--primary').click();
  check('base dialog resolves the clicked value and closes',
    (await promise) === 'yes' && !overlayInDom());

  const escaped = showDialog({
    title: 'T', message: 'M', defaultValue: 'default',
    buttons: [{ label: 'Ok', value: 'ok', primary: true }],
  });
  pressEscape();
  check('base dialog resolves the default on Escape',
    (await escaped) === 'default' && !overlayInDom());
}

/* Page setup: OK applies to the docSettings, Cancel does not ---------------- */
{
  const promise = showPageSetupDialog();
  const formatSelect = document.querySelectorAll('.dialog-margin-grid select')[0];
  check('page setup opens with every paper format',
    overlayInDom() && formatSelect.options.length === settings.page.formats.length);
  formatSelect.value = 'a5';
  // Default typeface (feature 8): pick Arial 14 in the same OK pass.
  const arialCss = settings.editor.fonts.find((font) => font.label === 'Arial').css;
  const dialogFontSelect = [...document.querySelectorAll('.dialog select')]
    .find((select) => [...select.options].some((option) => option.value === arialCss));
  check('page setup offers the default-typeface controls',
    dialogFontSelect !== undefined &&
    dialogFontSelect.options.length === settings.editor.fonts.length);
  dialogFontSelect.value = arialCss;
  dialogFontSelect.closest('.dialog-margin-grid').querySelector('input').value = '14';
  // First page different (feature 9): the two page-1 fields sit greyed
  // behind the flag; tick it, fill both texts in the same OK pass.
  const wideInputs = [...document.querySelectorAll('.dialog .dialog-field--wide input')];
  const firstCheckbox = document.querySelector('.dialog .dialog-checkbox input');
  check('page setup offers the first-page block (flag + two greyed fields)',
    wideInputs.length === 4 && firstCheckbox !== null && !firstCheckbox.checked &&
    wideInputs[2].disabled && wideInputs[3].disabled);
  firstCheckbox.checked = true;
  firstCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('ticking the flag enables the first-page fields',
    !wideInputs[2].disabled && !wideInputs[3].disabled);
  wideInputs[2].value = 'Briefkopf';
  wideInputs[3].value = 'Absender';
  document.querySelector('.dialog-button--primary').click();
  check('OK writes format and typeface into the docSettings and closes',
    (await promise) === true &&
    appState.get('docSettings').pageFormat === 'a5' &&
    appState.get('docSettings').fontFamily === arialCss &&
    appState.get('docSettings').fontSizePt === 14 && !overlayInDom());
  check('OK writes the first-page flag and texts too',
    appState.get('docSettings').firstPageDifferent === true &&
    appState.get('docSettings').firstHeaderText === 'Briefkopf' &&
    appState.get('docSettings').firstFooterText === 'Absender');
  // The toolbar's font controls follow the DOCUMENT default for unmarked text.
  editor.commands.setContent('<p>Grundschrift</p>');
  check('toolbar shows the new document default for unmarked text',
    byLabel('toolbar.fontSize').value === '14' &&
    byLabel('toolbar.fontFamily').value === arialCss);

  const cancelled = showPageSetupDialog();
  document.querySelectorAll('.dialog-margin-grid select')[0].value = 'letter';
  document.querySelector('.dialog-buttons .dialog-button:not(.dialog-button--primary)').click();
  check('Cancel leaves the docSettings untouched',
    (await cancelled) === false &&
    appState.get('docSettings').pageFormat === 'a5' && !overlayInDom());
  updateDocSettings({
    pageFormat: 'a4',
    fontFamily: settings.editor.fontFamily,
    fontSizePt: settings.editor.fontSizePt,
    firstPageDifferent: false,
    firstHeaderText: '',
    firstFooterText: '',
  }); // leave the shared state clean
}

/* Settings: live re-label on a language switch, then close ------------------ */
{
  const promise = showSettingsDialog();
  const heading = document.querySelector('.dialog-title');
  const deTitle = heading.textContent;
  check('settings dialog opens with language, theme and view selects',
    overlayInDom() &&
    document.querySelectorAll('.dialog select').length === 3 &&
    deTitle === t('settings.title'));
  const languageSelect = document.querySelector('.dialog select');
  changeSelect(languageSelect, 'en');
  check('the open dialog re-labels itself on a live language switch',
    heading.textContent === t('settings.title') && heading.textContent !== deTitle);
  changeSelect(languageSelect, 'de');
  document.querySelector('.dialog-button--primary').click();
  check('settings dialog closes via its button',
    (await promise) === true && !overlayInDom());
}

/* Shortcuts: content present, Escape closes ---------------------------------*/
{
  const promise = showShortcutsDialog();
  check('shortcuts dialog opens with the grouped list',
    overlayInDom() && document.querySelectorAll('.shortcuts-row').length > 20);
  pressEscape();
  await promise;
  check('shortcuts dialog closes on Escape', !overlayInDom());
}

/* Backups: needs IndexedDB → gated on fake-indexeddb like test:pages part 4. */
let hasFakeIdb = true;
try {
  await import('fake-indexeddb/auto');
  const realm = globalThis.window ?? {};
  globalThis.indexedDB = globalThis.indexedDB ?? realm.indexedDB;
  for (const key of Object.getOwnPropertyNames(realm)) {
    if (key.startsWith('IDB') && !(key in globalThis)) globalThis[key] = realm[key];
  }
} catch {
  hasFakeIdb = false;
  console.warn('backups-dialog checks skipped — fake-indexeddb missing (npm ci installs the pinned devDependencies)');
}
if (hasFakeIdb) {
  const { showBackupsDialog } = await import('../src/ui/dialogs/backups.js');
  const promise = showBackupsDialog({ mode: 'browse' });
  await waitFor(overlayInDom); // listSnapshots resolves on the (empty) store first
  check('backups dialog opens on an empty store with restore disabled',
    overlayInDom() &&
    document.querySelector('.dialog-button--primary')?.disabled === true);
  document.querySelector('.dialog-buttons .dialog-button:not(.dialog-button--primary)').click();
  check('backups dialog closes and resolves null',
    (await promise) === null && !overlayInDom());
}

/* ========================================================================== */

editor.destroy();
chrome.toolbar.destroy();
chrome.statusbar.destroy();

console.log(`\nTOTAL: ${passed} ok, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
