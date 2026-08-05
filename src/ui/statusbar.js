// src/ui/statusbar.js
// ---------------------------------------------------------------------------
// Status bar. Left: current file name (● marks unsaved changes) and the
// autosave/save status (state key 'autosave'). Right: document info (live
// word/character count docks here in phase 5); app name + version for now.
// ---------------------------------------------------------------------------

import { t, getLanguage } from '../i18n/index.js';
import { icons } from './icons.js';
import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { pageViewKey } from '../core/pageView.js';

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(getLanguage(), {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initStatusbar(root, getEditor = () => null) {
  root.setAttribute('aria-label', t('statusbar.ariaLabel'));

  // Event-bus unsubscribers — the chrome is rebuilt on language switch,
  // destroy() below detaches this instance cleanly.
  const subscriptions = [];

  const file = document.createElement('span');
  file.className = 'statusbar-file';

  const counts = document.createElement('span');
  counts.className = 'statusbar-counts';
  const renderCounts = () => {
    const editor = getEditor();
    const storage = editor?.storage?.characterCount;
    if (!storage) { counts.textContent = ''; return; }
    counts.textContent = t('statusbar.counts', {
      words: storage.words().toLocaleString(getLanguage()),
      characters: storage.characters().toLocaleString(getLanguage()),
    });
  };
  // Counting traverses the whole document (~4 ms at 120 pages), so it runs
  // throttled and only when CONTENT changes — selection-only transactions
  // never alter the counts. File boundaries (new/open/restore) render
  // immediately via 'document:baseline'.
  let countTimer = null;
  const scheduleCounts = () => {
    if (countTimer) return; // trailing throttle: one render per window
    countTimer = setTimeout(() => {
      countTimer = null;
      renderCounts();
    }, settings.statusbar.countUpdateMs);
  };
  subscriptions.push(appState.on('document:updated', scheduleCounts));
  subscriptions.push(appState.on('document:baseline', renderCounts));

  const status = document.createElement('span');
  status.className = 'statusbar-status';

  /* Spellcheck toggle */
  const spellButton = document.createElement('button');
  spellButton.type = 'button';
  spellButton.className = 'statusbar-zoom-button';
  spellButton.innerHTML = icons.spellcheck;
  spellButton.title = t('statusbar.spellcheck');
  spellButton.setAttribute('aria-label', t('statusbar.spellcheck'));
  spellButton.setAttribute('aria-pressed', 'false');
  spellButton.style.marginRight = '10px';
  spellButton.addEventListener('click', () => {
    appState.set('spellcheck', !(appState.get('spellcheck') ?? settings.editor.spellcheck));
  });
  const renderSpell = () => {
    const on = appState.get('spellcheck') ?? settings.editor.spellcheck;
    spellButton.classList.toggle('is-active', on);
    spellButton.setAttribute('aria-pressed', String(on));
  };
  subscriptions.push(appState.on('change:spellcheck', renderSpell));

  const zoom = document.createElement('span');
  zoom.className = 'statusbar-zoom';

  /* Page view (phase 9, reworked 0.23.0): "Seite X von Y" sits left next to
     the word count (Word's spot); the pages/continuous switch is a segmented
     control by the zoom. Both buttons and the settings dialog write the same
     appState 'viewMode' — they can never drift apart. */
  const pageInfo = document.createElement('span');
  pageInfo.className = 'statusbar-pageinfo';

  const viewSegment = document.createElement('div');
  viewSegment.className = 'statusbar-segment';
  viewSegment.setAttribute('role', 'group');
  viewSegment.setAttribute('aria-label', t('statusbar.viewLabel'));
  const segmentButton = (icon, label, mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'statusbar-segment-button';
    button.innerHTML = icons[icon];
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => appState.set('viewMode', mode));
    viewSegment.append(button);
    return button;
  };
  const pagesButton = segmentButton('viewPages', t('statusbar.viewPages'), 'pages');
  const pagelessButton = segmentButton('viewPageless', t('statusbar.viewPageless'), 'pageless');

  const renderPageView = () => {
    const mode = appState.get('viewMode') ?? settings.pageView.defaultMode;
    const pages = mode === 'pages';
    pagesButton.classList.toggle('is-active', pages);
    pagesButton.setAttribute('aria-pressed', String(pages));
    pagelessButton.classList.toggle('is-active', !pages);
    pagelessButton.setAttribute('aria-pressed', String(!pages));

    const editor = getEditor();
    const state = editor ? pageViewKey.getState(editor.state) : null;
    if (!pages || !state?.active) {
      pageInfo.textContent = '';
      return;
    }
    const from = editor.state.selection.from;
    let page = 1;
    for (const entry of state.breaks) {
      if (entry.pos <= from) page += 1;
      else break;
    }
    pageInfo.textContent = t('statusbar.page', { page, pages: state.pages });
  };
  subscriptions.push(appState.on('editor:transaction', renderPageView));
  subscriptions.push(appState.on('change:viewMode', renderPageView));
  subscriptions.push(appState.on('document:baseline', renderPageView));

  const { zoomMin, zoomMax, zoomStep, zoomDefault } = settings.view;

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'statusbar-zoom-button';
  zoomOut.innerHTML = icons.minus;
  zoomOut.setAttribute('aria-label', t('statusbar.zoomOut'));
  zoomOut.title = t('statusbar.zoomOut');

  const zoomSlider = document.createElement('input');
  zoomSlider.type = 'range';
  zoomSlider.className = 'statusbar-zoom-slider';
  zoomSlider.min = String(zoomMin);
  zoomSlider.max = String(zoomMax);
  zoomSlider.step = String(zoomStep);
  zoomSlider.setAttribute('aria-label', t('statusbar.zoomLabel'));

  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'statusbar-zoom-button';
  zoomIn.innerHTML = icons.plus;
  zoomIn.setAttribute('aria-label', t('statusbar.zoomIn'));
  zoomIn.title = t('statusbar.zoomIn');

  // The percentage doubles as a reset-to-default button (Word behavior).
  const zoomValue = document.createElement('button');
  zoomValue.type = 'button';
  zoomValue.className = 'statusbar-zoom-value';
  zoomValue.setAttribute('aria-label', t('statusbar.zoomReset', { value: zoomDefault }));
  zoomValue.title = t('statusbar.zoomReset', { value: zoomDefault });

  zoom.append(zoomOut, zoomSlider, zoomIn, zoomValue);

  const setZoom = (value) =>
    appState.set('zoom', Math.min(zoomMax, Math.max(zoomMin, value)));
  zoomOut.addEventListener('click', () => setZoom((appState.get('zoom') ?? zoomDefault) - zoomStep));
  zoomIn.addEventListener('click', () => setZoom((appState.get('zoom') ?? zoomDefault) + zoomStep));
  zoomSlider.addEventListener('input', () => setZoom(Number(zoomSlider.value)));
  zoomValue.addEventListener('click', () => setZoom(zoomDefault));

  const renderZoom = () => {
    const value = appState.get('zoom') ?? zoomDefault;
    zoomValue.textContent = `${value}\u202f%`;
    zoomSlider.value = String(value);
    zoomOut.disabled = value <= zoomMin;
    zoomIn.disabled = value >= zoomMax;
  };
  subscriptions.push(appState.on('change:zoom', renderZoom));

  const info = document.createElement('span');
  info.className = 'statusbar-info';
  // Brand name + version number: not translatable UI text.
  info.textContent = `${settings.app.name} ${settings.app.version}`;

  const renderFile = () => {
    const name = appState.get('file')?.name ?? t('file.untitled');
    const dirty = appState.get('documentDirty');
    file.textContent = dirty ? `${name} ●` : name;
    file.title = dirty ? t('file.unsavedChanges') : name;
  };

  const renderStatus = (state) => {
    switch (state?.status) {
      case 'pending':
        status.textContent = t('statusbar.saving');
        break;
      case 'saved':
        status.textContent = t('statusbar.saved', { time: formatTime(state.time) });
        break;
      case 'file-saved':
        status.textContent = t('statusbar.fileSaved', {
          name: state.name,
          time: formatTime(state.time),
        });
        break;
      case 'restored':
        status.textContent = t('statusbar.restored', { time: formatTime(state.time) });
        break;
      case 'error':
        status.textContent = t('statusbar.saveError');
        break;
      default:
        status.textContent = t('statusbar.ready');
    }
  };

  subscriptions.push(appState.on('change:autosave', ({ value }) => renderStatus(value)));
  subscriptions.push(appState.on('change:file', renderFile));
  subscriptions.push(appState.on('change:documentDirty', renderFile));
  renderStatus(appState.get('autosave'));
  renderFile();
  renderZoom();
  renderCounts();
  renderSpell();
  renderPageView();

  root.replaceChildren(file, pageInfo, counts, status, spellButton, viewSegment, zoom, info);

  return {
    /** Detach from the event bus — the chrome is rebuilt on language switch. */
    destroy() {
      if (countTimer) clearTimeout(countTimer);
      subscriptions.forEach((unsubscribe) => unsubscribe());
    },
  };
}
