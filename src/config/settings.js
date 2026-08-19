// src/config/settings.js
// ---------------------------------------------------------------------------
// Central configuration. Every tunable value of the app lives here — other
// modules must read from this object instead of hardcoding values.
// New keys are added phase by phase (autosave interval, zoom, …) as soon as
// they are actually consumed by code. Colors live as CSS custom properties
// in styles/app.css; page metrics and content typography are injected from
// here into CSS variables at boot (see main.js → applySettingsToCss).
// ---------------------------------------------------------------------------

export const settings = {
  app: {
    name: 'Simplex', // product/brand name (a proper noun, not translated)
    version: '1.3.0',    // keep in sync with package.json
  },

  i18n: {
    defaultLanguage: 'en', // English is the project's main language since 1.0.0
    fallbackLanguage: 'en', // used when a key is missing in the active language
    // Language names are shown in their own language (proper nouns) — they
    // are identical in every dictionary, hence they live here, not in i18n.
    nativeNames: { de: 'Deutsch', en: 'English' },
  },

  // Page geometry (reworked in 0.27.0, feature 3): the paper FORMAT and
  // ORIENTATION are document settings now (docSettings.pageFormat /
  // .pageOrientation) — this block only offers the vocabulary. Labels are
  // proper nouns (identical in every language, like the font list), so they
  // live here instead of i18n. Effective width/height come from
  // core/docSettings.js → pageSizeMm(); the sheet is pageless on screen,
  // real pagination happens in the page view and in print/PDF via paged.js.
  page: {
    formats: [
      { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
      { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
      { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
    ],
    formatDefault: 'a4',
    orientations: ['portrait', 'landscape'],
    orientationDefault: 'portrait',
    marginsMm: { top: 25, right: 20, bottom: 20, left: 25 }, // app defaults
    marginRangeMm: [0, 80],  // clamp for the page-setup dialog
    // Page-number vocabulary (0.23.0). Each format id maps to the i18n
    // template `pageNumber.<id>` ({page}/{pages} placeholders); the order
    // here is the order in the page-setup select. 'off' is implicit.
    numberFormats: ['number', 'dash', 'ofPages', 'pageOfPages'],
    numberPositions: ['left', 'center', 'right'],
    numberFormatDefault: 'number',   // a single, book-style digit …
    numberPositionDefault: 'center', // … centred at the bottom of the sheet
  },

  view: {
    zoomDefault: 100, // percent
    zoomMin: 50,
    zoomMax: 200,
    zoomStep: 10,
    zoomKey: 'ui:zoom',             // IndexedDB key (app-level, not per document)
    spellcheckKey: 'ui:spellcheck', // persisted toggle state
    languageKey: 'ui:language',     // persisted UI language (IndexedDB)
    // Theme lives in localStorage, NOT IndexedDB: it must be readable
    // synchronously before the first paint (anti-flash inline script in
    // index.html — the key literal there must match this one).
    themeKey: 'simplex:theme',
    themeDefault: 'system',         // 'system' | 'light' | 'dark'
    inspectKey: 'ui:inspect',       // inspection-mode toggle (IndexedDB)
    inspectDefault: false,
    typographyKey: 'ui:typography', // typographic-replacements toggle (IndexedDB)
    viewModeKey: 'ui:viewMode',     // 'pageless' | 'pages' (IndexedDB)
  },

  // Page view in the editor (phase 9): the document stays ONE continuous
  // ProseMirror flow; page gaps are drawn by in-flow widget DECORATIONS at
  // computed break positions (core/pageView.js + core/paginator.js). All
  // Word-style break rules live here as tunables.
  pageView: {
    defaultMode: 'pages',   // 'pages' | 'pageless' — first start (then persisted)
    gapPx: 24,              // grey workbench gap between two sheets (CSS px @100 %)
    minOrphanLines: 2,      // min lines of a split paragraph left at a page END
    minWidowLines: 2,       // min lines of a split paragraph moved to the next page
    keepHeadingWithNext: true, // a heading never dangles alone at a page end
    epsilonPx: 0.5,         // sub-pixel tolerance for "line still fits" checks
    // Blocks taller than one full page (huge tables/images) stretch THEIR
    // page instead of overflowing the sheet (documented v1 table limit).
    stretchOversize: true,
    maxSchedulerPasses: 3,  // safety cap for measure→apply convergence
  },

  search: {
    debounceMs: 150, // typing pause before the document is searched
  },

  statusbar: {
    // Word/character count: full-document traversal (~4 ms at 120 pages),
    // therefore throttled and only recomputed on CONTENT changes — never on
    // selection-only transactions (see ui/statusbar.js).
    countUpdateMs: 300,
  },

  print: {
    headerFooterFontSizePt: 9,   // running header/footer + page numbers
    headerFooterColor: '#555555',
  },

  editor: {
    autofocus: true,          // place the caret into the document on load
    spellcheck: true,         // native browser spellcheck (toggle in status bar)
    headingLevels: [1, 2, 3], // exposed in the toolbar paragraph-format select
    // Times New Roman as document default: its digits sit ON the baseline.
    // Georgia (still in the list below) uses oldstyle figures by design —
    // 3/4/5/7/9 dip below the line, and classic Windows Georgia ships no
    // lining alternative, so no CSS feature can straighten them.
    fontFamily: "'Times New Roman', Times, serif", // document default
    fontSizePt: 12,                                  // document default
    lineHeight: 1.5,
    paragraphSpacingPt: 0, // default space after each paragraph / list block

    // Toolbar font list. Labels are font names (proper nouns, not translated);
    // `css` is the full stack that gets written into the document. The entry
    // whose `css` equals `fontFamily` above acts as the default (selecting it
    // removes the explicit fontFamily mark instead of storing it).
    fonts: [
      { label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
      { label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
      { label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
      { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
      { label: 'Courier New', css: "'Courier New', Courier, monospace" },
    ],
    // Point sizes offered in the toolbar (fontSizePt above is the default).
    fontSizesPt: [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48],
    // Bounds for the free size input and the A−/A+ / Strg+8/9 stepping.
    fontSizeMinPt: 4,
    fontSizeMaxPt: 200,

    // Paragraph indent (feature 2). Stored on the block as an integer LEVEL
    // (0 = none); one level renders/exports as indentStepMm. 12.5 mm mirrors
    // German Word's 1,25 cm grid; 8 levels (100 mm) stay inside the content
    // area at default margins — beyond that Word documents get weird anyway.
    indentStepMm: 12.5,
    indentMaxLevels: 8,

    // Steps offered in the line/paragraph-spacing dropdown. lineHeights are
    // unitless CSS factors; paragraphSpacingsPt is "space after" in points.
    // "Default" in the UI removes the attribute → the document defaults
    // apply again (lineHeight and paragraphSpacingPt above).
    lineHeights: [1, 1.15, 1.5, 2],
    paragraphSpacingsPt: [0, 6, 12, 18],
    // Clamps for the free-value inputs in the spacing dropdown.
    lineHeightRange: [0.5, 4],
    paragraphSpacingRangePt: [0, 96],
  },

  // Palettes for the two color dropdowns. `key` maps to the i18n entry
  // `color.<key>` (used as the swatch's accessible name).
  colors: {
    text: [
      { key: 'black', value: '#000000' },
      { key: 'gray', value: '#6f6c62' },
      { key: 'red', value: '#b3372c' },
      { key: 'orange', value: '#c2611b' },
      { key: 'green', value: '#33702f' },
      { key: 'blue', value: '#2f5d8a' },
      { key: 'purple', value: '#6d4b8a' },
      { key: 'brown', value: '#7a5232' },
    ],
    highlight: [
      { key: 'yellow', value: '#f9e37b' },
      { key: 'green', value: '#c5e8a6' },
      { key: 'cyan', value: '#b8e4e0' },
      { key: 'pink', value: '#f4c6d4' },
      { key: 'orange', value: '#f7cf9e' },
    ],
  },

  file: {
    extension: '.sdoc',       // native format: plain JSON (see io/container.js)
    // Accepted when OPENING: the current extension plus the legacy ones
    // (.sim from the brief 0.18.0 window, .swdoc from the Schreibwerk days)
    // — old files stay pickable and double-clickable.
    openExtensions: ['.sdoc', '.sim', '.swdoc'],
    docxExtension: '.docx',   // Word interchange (io/docxExport.js / docxImport.js)
    backupCopy: true,         // desktop: sibling .bak right before an overwrite
    backupSuffix: '.bak',
    maxRecent: 5,             // entries in the "recently opened" list
    recentKey: 'recent:files' // IndexedDB key of that list
  },

  image: {
    maxFileSizeMb: 8, // Base64 lives inside the .sdoc JSON — keep files sane
    minWidthPx: 40,   // lower bound for the resize handle
  },

  table: {
    pickerMax: 6, // size of the insert grid (6 → up to 6×6 directly)
  },

  link: {
    defaultProtocol: 'https', // bare "example.com" → https://example.com
    bubbleMaxChars: 42,       // href display length in the link bubble
  },

  // Typographic replacements while typing (phase 7b). `enabled` is only the
  // default for fresh installs — the live toggle sits in the settings dialog
  // and persists per user (IndexedDB, view.typographyKey). Every entry in
  // `rules` goes straight to @tiptap/extension-typography: a string replaces
  // the character the rule inserts, `false` switches that rule off. Rules not
  // listed keep the extension defaults (... → …, <- → ←, -> → →, (c) © (tm) ™
  // (r) ®, 1/2 ½ 1/4 ¼ 3/4 ¾, +/- ±, != ≠, 2x3 → 2×3, ^2 ² ^3 ³).
  typography: {
    enabled: true,
    rules: {
      openDoubleQuote: '„',  // German quotes instead of the English defaults
      closeDoubleQuote: '“',
      openSingleQuote: '‚',
      closeSingleQuote: '‘',
      emDash: '–',           // -- → Halbgeviertstrich (the German Gedankenstrich)
      laquo: false,          // « » off — German guillemets run »…« anyway
      raquo: false,
    },
  },

  // DOCX export tunables. Heading factors mirror editor.css (1.9em/1.5em/1.25em
  // of the base font size) so exported headings match the on-screen look.
  docx: {
    headingFactors: { 1: 1.9, 2: 1.5, 3: 1.25 },
  },

  autosave: {
    debounceMs: 1000,               // quiet time after the last keystroke
    dbName: 'simplex',              // IndexedDB database name
    storeName: 'documents',         // object store for snapshots
    snapshotKey: 'autosave:current',// key of the crash-recovery snapshot
    // Generations (feature 1, 0.25.0): time-spaced safety copies BESIDE the
    // continuously updated crash snapshot — they protect against "saved the
    // wrong thing", not just crashes. Keys sort chronologically (padded ms).
    generationPrefix: 'autosave:gen:',
    generationMinutes: 10,          // min. spacing between rotation copies
    maxGenerations: 6,              // kept generations (auto + saved together)
    savedMinGapMs: 60000,           // guard against save-spamming generations
  },
};

/* Document-level settings -----------------------------------------------------
   These travel INSIDE each .sdoc file (its `settings` field) and in the
   autosave snapshot — unlike everything above, which is app configuration. */

export function defaultDocumentSettings() {
  return {
    pageFormat: settings.page.formatDefault,           // 'a4' | 'a5' | 'letter'
    pageOrientation: settings.page.orientationDefault, // 'portrait' | 'landscape'
    pageMarginsMm: { ...settings.page.marginsMm },
    headerText: '',
    footerText: '',
    // Feature 9 (0.30.0): the letterhead case — page 1 gets its OWN header/
    // footer texts and no page number while the flag is on (Word's titlePg
    // semantics: the first footer is its own part, and our page number
    // belongs to the default footer). The texts survive toggling the flag
    // off, exactly like Word keeps first-page header content around.
    firstPageDifferent: false,
    firstHeaderText: '',
    firstFooterText: '',
    // 0.23.0: page numbers are a format + position choice instead of a bool.
    pageNumberFormat: settings.page.numberFormatDefault,     // 'off' | format id
    pageNumberPosition: settings.page.numberPositionDefault, // 'left'|'center'|'right'
    // Feature 8 (0.29.0): the document's default typeface. Font marks stay
    // ABSOLUTE deviations from this default — changing it never rewrites
    // marked text, only unmarked text follows.
    fontFamily: settings.editor.fontFamily,   // one of settings.editor.fonts[].css
    fontSizePt: settings.editor.fontSizePt,
  };
}

/** Merge loaded (possibly partial/older) document settings onto the defaults. */
export function mergeDocumentSettings(value) {
  const base = defaultDocumentSettings();
  if (!value || typeof value !== 'object') return base;
  const merged = {
    ...base,
    ...value,
    pageMarginsMm: { ...base.pageMarginsMm, ...(value.pageMarginsMm ?? {}) },
  };
  // Migration: files/snapshots up to 0.22.0 carried a `pageNumbers` boolean.
  // true meant "show numbers" (rendered app-side) → new app standard format;
  // false maps to 'off'. Files that already carry a format win over the bool.
  if (typeof value.pageNumbers === 'boolean' && value.pageNumberFormat === undefined) {
    merged.pageNumberFormat = value.pageNumbers ? base.pageNumberFormat : 'off';
  }
  delete merged.pageNumbers;
  // Unknown ids from newer/foreign files degrade to something sensible.
  if (merged.pageNumberFormat !== 'off'
      && !settings.page.numberFormats.includes(merged.pageNumberFormat)) {
    merged.pageNumberFormat = base.pageNumberFormat;
  }
  if (!settings.page.numberPositions.includes(merged.pageNumberPosition)) {
    merged.pageNumberPosition = base.pageNumberPosition;
  }
  // Feature 3 (0.27.0): files up to 0.26.0 carry no format/orientation —
  // the base merge already fills the defaults. Unknown ids from newer or
  // foreign files degrade the same way as the page-number vocabulary.
  if (!settings.page.formats.some((format) => format.id === merged.pageFormat)) {
    merged.pageFormat = base.pageFormat;
  }
  if (!settings.page.orientations.includes(merged.pageOrientation)) {
    merged.pageOrientation = base.pageOrientation;
  }
  // Feature 8 (0.29.0): files up to 0.28.0 carry no default typeface — the
  // base merge fills the app defaults. Foreign font stacks degrade to the
  // default (the select only offers our list anyway); sizes clamp to the
  // toolbar's bounds and snap to its half-point grid.
  if (!settings.editor.fonts.some((font) => font.css === merged.fontFamily)) {
    merged.fontFamily = base.fontFamily;
  }
  const mergedSizePt = Number.parseFloat(merged.fontSizePt);
  merged.fontSizePt = Number.isFinite(mergedSizePt)
    ? Math.min(settings.editor.fontSizeMaxPt,
        Math.max(settings.editor.fontSizeMinPt, Math.round(mergedSizePt * 2) / 2))
    : base.fontSizePt;
  // Feature 9 (0.30.0): files up to 0.29.x carry no first-page fields — the
  // base merge fills the defaults. Foreign junk degrades in the safe
  // direction: the flag must be a REAL boolean true, the texts real strings.
  merged.firstPageDifferent = merged.firstPageDifferent === true;
  if (typeof merged.firstHeaderText !== 'string') merged.firstHeaderText = base.firstHeaderText;
  if (typeof merged.firstFooterText !== 'string') merged.firstFooterText = base.firstFooterText;
  return merged;
}
