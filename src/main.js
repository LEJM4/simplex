// src/main.js — application bootstrap
// ---------------------------------------------------------------------------
// Wiring only: initialise i18n, project settings into CSS variables, run the
// session-restore dialog, mount the editor and hand everything to the UI
// modules. All behaviour lives in the modules themselves.
//
// mountEditor() replaces the whole editor instance (open / new / restore) so
// the undo history always starts clean at a file boundary — every module
// therefore resolves the instance lazily via getEditor().
// ---------------------------------------------------------------------------

import './styles/app.css';
import './styles/editor.css';
import './styles/print.css';

import { settings } from './config/settings.js';
import { initI18n, t } from './i18n/index.js';
import { attachMarginClick } from './core/marginClick.js';
import { createEditor } from './core/editor.js';
import { appState } from './core/appState.js';
import { initDocSettings, replaceDocSettings } from './core/docSettings.js';
import { loadSnapshot, deleteSnapshot, initAutosave } from './io/autosave.js';
import { getDb } from './io/db.js';
import { initPdfPrint } from './io/pdfPrint.js';
import { initDocxExport } from './io/docxExport.js';
import { initDocxImport } from './io/docxImport.js';
import { showBackupsDialog } from './ui/dialogs/backups.js';
import { showPageSetupDialog } from './ui/dialogs/pageSetup.js';
import { showSettingsDialog } from './ui/dialogs/settingsDialog.js';
import { showShortcutsDialog } from './ui/dialogs/shortcutsDialog.js';
import { initTheme } from './core/theme.js';
import { initFileSystem } from './io/fileSystem.js';
import { isTauri, setNativeWindowTitle, takeLaunchFile, onOpenFile } from './io/tauriFs.js';
import { showDialog } from './ui/dialogs/dialog.js';
import { createFileMenu } from './ui/fileMenu.js';
import { initSearchPanel } from './ui/searchPanel.js';
import { initLinkUi } from './ui/linkUi.js';
import { initToolbar, stepFontSize } from './ui/toolbar.js';
import { initStatusbar } from './ui/statusbar.js';

/** Expose content typography from settings.js as CSS variables. Page
 *  geometry (--page-*, 0.27.0) and the default typeface (--content-font-*,
 *  0.29.0) are DOCUMENT state and live in core/docSettings.js → applyToCss,
 *  fired right below by initDocSettings() before the editor mounts — only
 *  line height and paragraph spacing remain app-level here. */
function applySettingsToCss() {
  const style = document.documentElement.style;
  const { editor } = settings;

  style.setProperty('--content-line-height', String(editor.lineHeight));
  style.setProperty('--content-paragraph-spacing', `${editor.paragraphSpacingPt}pt`);
}

/** Tab title: "• name – App" while there are unsaved changes. */
function initWindowTitle() {
  const update = () => {
    const name = appState.get('file')?.name ?? t('file.untitled');
    const dirty = appState.get('documentDirty') ? '\u2022 ' : '';
    const title = `${dirty}${name} \u2013 ${settings.app.name}`;
    document.title = title;
    // Desktop: the native titlebar does not follow document.title by itself.
    if (isTauri) setNativeWindowTitle(title).catch(() => {});
  };
  appState.on('change:file', update);
  appState.on('change:documentDirty', update);
  appState.on('language:changed', update); // "Untitled" is translated
  update();
}

/** Inspection mode: decoration overlay in the (replaceable) editor, persisted.
    Re-applied on file boundaries (fresh editor starts inactive) and on
    language switches (badge labels are translated). */
async function initInspect(getEditor) {
  appState.on('change:inspect', ({ value }) => {
    getEditor()?.commands.setInspect(value);
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.inspectKey))
      .catch(() => { /* convenience only */ });
  });
  const reapply = () => {
    if (appState.get('inspect')) getEditor()?.commands.setInspect(true);
  };
  appState.on('document:baseline', reapply);
  appState.on('language:changed', reapply);
  let stored = null;
  try {
    stored = await (await getDb()).get(settings.autosave.storeName, settings.view.inspectKey);
  } catch { /* fall back to default */ }
  appState.set('inspect', stored ?? settings.view.inspectDefault);
}

/** Native spellcheck toggle: applied to the (replaceable) editor, persisted. */
async function initSpellcheck(getEditor) {
  appState.on('change:spellcheck', ({ value }) => {
    const editor = getEditor();
    if (editor) editor.view.dom.spellcheck = value;
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.spellcheckKey))
      .catch(() => { /* convenience only */ });
  });
  let stored = null;
  try {
    stored = await (await getDb()).get(settings.autosave.storeName, settings.view.spellcheckKey);
  } catch { /* fall back to default */ }
  appState.set('spellcheck', stored ?? settings.editor.spellcheck);
}

/** Typographic replacements (phase 7b): persisted toggle, read per keystroke
 *  by the gated input rules (core/typography.js) — no editor rebuild needed. */
async function initTypography() {
  appState.on('change:typography', ({ value }) => {
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.typographyKey))
      .catch(() => { /* persistence is a convenience */ });
  });
  let stored = null;
  try {
    stored = await (await getDb()).get(settings.autosave.storeName, settings.view.typographyKey);
  } catch { /* fall back to default */ }
  appState.set('typography', stored ?? settings.typography.enabled);
}

/** App-level zoom: CSS zoom on the sheet, persisted in IndexedDB. */
async function initZoom() {
  const pageElement = document.getElementById('page');
  appState.on('change:zoom', ({ value }) => {
    pageElement.style.zoom = String(value / 100);
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.zoomKey))
      .catch(() => { /* zoom is a convenience — never block on it */ });
  });
  let stored = null;
  try {
    stored = await (await getDb()).get(settings.autosave.storeName, settings.view.zoomKey);
  } catch { /* fall back to default */ }
  appState.set('zoom', stored ?? settings.view.zoomDefault);
}

/** Page view (phase 9): 'pageless' | 'pages', persisted app-wide. The mode
 *  lives on <body data-view-mode> for the CSS side and as the swPageView
 *  plugin state inside the (replaceable) editor. Page-setup changes, zoom
 *  changes and language switches trigger a full repagination — margins,
 *  line metrics and spacer labels all depend on them. */
async function initViewMode(getEditor) {
  const currentMode = () => appState.get('viewMode') ?? settings.pageView.defaultMode;
  const apply = (mode) => {
    document.body.dataset.viewMode = mode;
    getEditor()?.commands.setPageView(mode === 'pages');
  };
  const refresh = () => {
    if (currentMode() === 'pages') getEditor()?.commands.refreshPageView();
  };

  appState.on('change:viewMode', ({ value }) => {
    apply(value);
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.viewModeKey))
      .catch(() => { /* persistence is a convenience */ });
  });
  // A fresh editor (open/new/restore) starts with the plugin inactive.
  appState.on('document:baseline', () => apply(currentMode()));
  appState.on('language:changed', refresh); // spacer/overlay labels are translated
  appState.on('change:docSettings', refresh); // margins, header/footer, numbers
  appState.on('change:zoom', refresh); // measuring space follows the zoom

  let stored = null;
  try {
    stored = await (await getDb()).get(settings.autosave.storeName, settings.view.viewModeKey);
  } catch { /* fall back to default */ }
  const initial = stored === 'pages' || stored === 'pageless'
    ? stored
    : settings.pageView.defaultMode;
  appState.set('viewMode', initial);
  apply(initial); // `set` skips the event when the value was already stored
}

async function init() {
  // The stored language must be known BEFORE anything renders text (the
  // session-restore dialog below is the first translated UI on screen).
  let storedLanguage = null;
  try {
    storedLanguage = await (await getDb()).get(
      settings.autosave.storeName,
      settings.view.languageKey
    );
  } catch { /* fall back to the default language */ }
  initI18n(storedLanguage);
  // Subscribed AFTER initI18n on purpose: only user changes are persisted.
  appState.on('change:language', ({ value }) => {
    getDb()
      .then((db) => db.put(settings.autosave.storeName, value, settings.view.languageKey))
      .catch(() => { /* persistence is a convenience */ });
  });

  initTheme();
  applySettingsToCss();
  initDocSettings();

  const editorElement = document.getElementById('editor');
  let editor = null;
  const getEditor = () => editor;

  const mountEditor = (content = null) => {
    if (editor) editor.destroy();
    editorElement.replaceChildren();
    editor = createEditor(editorElement, { content });
    appState.set('documentDirty', false);
    appState.emit('document:baseline');
    appState.emit('editor:transaction');
  };

  // Session restore (reworked in 0.25.0): a crash snapshot only exists when
  // the last session ended with unsaved changes. The backups dialog offers
  // that snapshot PLUS the older generations; the chosen content goes into
  // the fresh editor's constructor — restoring at boot is not undoable.
  const snapshot = await loadSnapshot();
  let restored = null;
  if (snapshot) {
    const chosen = await showBackupsDialog({ mode: 'boot' });
    if (chosen) {
      mountEditor(chosen.content);
      replaceDocSettings(chosen.docSettings);
      if (chosen.fileName) {
        appState.set('file', { name: chosen.fileName, handle: null });
      }
      restored = chosen;
    } else {
      // Declined: only the crash snapshot goes — the generations stay, they
      // are the safety net and remain reachable via Datei → Sicherungen.
      await deleteSnapshot();
      mountEditor(null);
    }
  } else {
    mountEditor(null);
  }

  initAutosave(getEditor);

  if (restored) {
    // The restored content is still unsaved — keep the safety net armed.
    appState.set('documentDirty', true);
    appState.set('autosave', { status: 'restored', time: restored.savedAt });
    appState.emit('document:updated');
  }

  const searchPanel = initSearchPanel(getEditor);
  const linkUi = initLinkUi(getEditor);
  const fileActions = initFileSystem({ getEditor, mountEditor });
  const { print } = initPdfPrint(getEditor);
  const { exportDocx } = initDocxExport(getEditor);
  const { importDocx } = initDocxImport({
    mountEditor,
    confirmDiscardIfDirty: fileActions.confirmDiscardIfDirty,
  });
  /** Datei → Sicherungen: restore replaces the content as ONE transaction —
      Ctrl+Z brings the previous state back, so no discard confirmation. The
      file binding stays untouched; the user decides where to save. */
  const restoreBackup = async () => {
    const chosen = await showBackupsDialog({ mode: 'browse' });
    if (!chosen) return;
    getEditor().commands.setContent(chosen.content, { emitUpdate: true });
    replaceDocSettings(chosen.docSettings);
  };

  const menuActions = {
    ...fileActions,
    backups: restoreBackup,
    pageSetup: showPageSetupDialog,
    shortcuts: showShortcutsDialog,
    settings: showSettingsDialog,
    print,
    exportDocx,
    importDocx,
  };

  // Toolbar + status bar bake their t() strings into the DOM at build time.
  // A language switch therefore tears the old instances down (destroy()
  // unsubscribes them from the event bus) and builds fresh, translated ones.
  const toolbarElement = document.getElementById('toolbar');
  const statusbarElement = document.getElementById('statusbar');
  let chrome = null;
  const buildChrome = () => {
    chrome?.destroy();
    const toolbar = initToolbar(
      toolbarElement,
      getEditor,
      [createFileMenu(menuActions)],
      { openSearch: () => searchPanel.open('find'), openLink: () => linkUi.openLinkDialog() }
    );
    const statusbar = initStatusbar(statusbarElement, getEditor);
    chrome = {
      destroy() {
        toolbar.destroy();
        statusbar.destroy();
      },
    };
  };
  buildChrome();
  appState.on('language:changed', () => {
    buildChrome();
    // The live editor keeps its history — only its accessible name changes.
    getEditor()?.view.dom.setAttribute('aria-label', t('editor.ariaLabel'));
  });

  initWindowTitle();
  await initZoom();
  await initViewMode(getEditor);
  await initSpellcheck(getEditor);
  await initTypography();
  await initInspect(getEditor);

  // File shortcuts (plain Ctrl — Ctrl+Shift+S stays strikethrough).
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      fileActions.save();
    } else if (key === 'o') {
      event.preventDefault();
      fileActions.openDocument();
    } else if (key === 'p') {
      event.preventDefault();
      print();
    } else if (key === 'f') {
      event.preventDefault();
      searchPanel.open('find');
    } else if (key === 'h') {
      event.preventDefault();
      searchPanel.open('replace');
    } else if (key === 'k') {
      event.preventDefault();
      linkUi.openLinkDialog();
    } else if (key === '8') {
      // Word parity: shrink by 1 pt. Reliable in the desktop app; browsers
      // may reserve Ctrl+digit for tab switching.
      event.preventDefault();
      stepFontSize(getEditor, -1);
    } else if (key === '9') {
      event.preventDefault();
      stepFontSize(getEditor, 1);
    }
  });

  // Installed PWA (phase 6d): the OS hands over double-clicked .sdoc files
  // here (manifest file_handlers). openRecent runs the full open path —
  // dirty-check, permission, mount, recents entry.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(({ files }) => {
      const [handle] = files ?? [];
      if (handle) fileActions.openRecent({ name: handle.name, handle });
    });
  }

  // Desktop (phase 6e part 3): the OS hands double-clicked .sdoc files over
  // as launch arguments. A fresh launch parks the path in Rust until the app
  // is ready (take_launch_file); while running, the single-instance plugin
  // forwards a second launch's argv as an 'open-file' event. Both funnel
  // into openRecent — the full open path with dirty-check and recents entry
  // (the path itself was already allowed on the fs scope by the Rust side).
  if (isTauri) {
    const openLaunchedFile = (path) => {
      if (typeof path === 'string' && path) fileActions.openRecent({ path });
    };
    takeLaunchFile().then(openLaunchedFile).catch(() => {});
    onOpenFile(openLaunchedFile).catch(() => {});
  }

  // Clicking the sheet's margin places the caret on the clicked LINE (Word
  // behavior: left margin → line start, right margin → line end) instead of
  // jumping to the document end. Mapping lives in core/marginClick.js.
  attachMarginClick(document.getElementById('page'), getEditor);
}

init();

// Offline support (phase 6d). Production only — a service worker would fight
// Vite's dev server and HMR. Update strategy lives in public/sw.js.
// (Not in Tauri: the desktop app is offline by nature, a worker only risks
// stale shells inside the webview's custom protocol.)
if (import.meta.env.PROD && !isTauri && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // BASE_URL is Vite's base ('/' locally, /<repo>/app/ on Pages); the
    // worker's scope defaults to its own directory — exactly that base.
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch((error) => {
      console.error('[pwa] service-worker registration failed', error);
    });
  });
}
