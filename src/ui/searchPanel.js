// src/ui/searchPanel.js
// ---------------------------------------------------------------------------
// Floating find & replace panel (top right, below the toolbar). Non-modal on
// purpose: typing in the document keeps working and the match count follows
// live. Enter = next, Shift+Enter = previous, Escape closes and clears the
// highlights. A non-empty selection pre-fills the search field on open.
// ---------------------------------------------------------------------------

import { t } from '../i18n/index.js';
import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { searchKey } from '../core/search.js';
import { icons } from './icons.js';

export function initSearchPanel(getEditor) {
  let panel = null;
  let searchInput = null;
  let replaceInput = null;
  let caseCheckbox = null;
  let countLabel = null;
  let debounceTimer = null;

  const pluginState = () => searchKey.getState(getEditor().state);

  const renderCount = () => {
    if (!panel || panel.style.display === 'none') return;
    const state = pluginState();
    if (!state.query) {
      countLabel.textContent = '';
    } else if (state.matches.length === 0) {
      countLabel.textContent = t('search.noMatches');
    } else {
      countLabel.textContent = t('search.count', {
        current: state.active >= 0 ? state.active + 1 : '–',
        total: state.matches.length,
      });
    }
  };

  const applyQuery = () => {
    getEditor().commands.setSearch({
      query: searchInput.value,
      caseSensitive: caseCheckbox.checked,
    });
  };
  const scheduleQuery = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyQuery, settings.search.debounceMs);
  };

  const next = () => getEditor().chain().focus().findNext().run();
  const previous = () => getEditor().chain().focus().findPrevious().run();
  const replaceOne = () => {
    const editor = getEditor();
    if (searchKey.getState(editor.state).active === -1) {
      next();
      return;
    }
    editor.chain().focus().replaceCurrent(replaceInput.value).run();
    editor.commands.findNext();
  };
  const replaceAll = () =>
    getEditor().chain().focus().replaceAll(replaceInput.value).run();

  const close = () => {
    if (!panel) return;
    panel.style.display = 'none';
    getEditor().chain().focus().clearSearch().run();
  };

  const build = () => {
    panel = document.createElement('div');
    panel.className = 'search-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('search.title'));

    const iconButton = (icon, label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-panel-button';
      button.innerHTML = icons[icon];
      button.title = label;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', onClick);
      return button;
    };
    const textButton = (label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-panel-textbutton';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };

    /* Row 1: search */
    const findRow = document.createElement('div');
    findRow.className = 'search-panel-row';
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'search-panel-input';
    searchInput.placeholder = t('search.find');
    searchInput.setAttribute('aria-label', t('search.find'));
    searchInput.addEventListener('input', scheduleQuery);
    countLabel = document.createElement('span');
    countLabel.className = 'search-panel-count';
    findRow.append(
      searchInput,
      countLabel,
      iconButton('chevronUp', t('search.previous'), previous),
      iconButton('chevronDown', t('search.next'), next),
      iconButton('close', t('search.close'), close)
    );

    /* Row 2: replace */
    const replaceRow = document.createElement('div');
    replaceRow.className = 'search-panel-row';
    replaceInput = document.createElement('input');
    replaceInput.type = 'text';
    replaceInput.className = 'search-panel-input';
    replaceInput.placeholder = t('search.replace');
    replaceInput.setAttribute('aria-label', t('search.replace'));
    replaceRow.append(
      replaceInput,
      textButton(t('search.replaceOne'), replaceOne),
      textButton(t('search.replaceAll'), replaceAll)
    );

    /* Row 3: options */
    const optionsRow = document.createElement('label');
    optionsRow.className = 'search-panel-option';
    caseCheckbox = document.createElement('input');
    caseCheckbox.type = 'checkbox';
    caseCheckbox.addEventListener('change', applyQuery);
    const caption = document.createElement('span');
    caption.textContent = t('search.matchCase');
    optionsRow.append(caseCheckbox, caption);

    panel.append(findRow, replaceRow, optionsRow);
    document.body.append(panel);
    panel.addEventListener('keydown', onPanelKeyDown);
  };

  const onPanelKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && event.target === searchInput) {
      event.preventDefault();
      if (debounceTimer) { clearTimeout(debounceTimer); applyQuery(); }
      if (event.shiftKey) previous();
      else next();
    } else if (event.key === 'Enter' && event.target === replaceInput) {
      event.preventDefault();
      replaceOne();
    }
  };

  // Registered ONCE for the app lifetime (initSearchPanel is never re-run):
  // renderCount is null-safe, and on a language switch the built panel is
  // simply discarded — the next open() rebuilds it with the new strings.
  appState.on('editor:transaction', renderCount);
  appState.on('language:changed', () => {
    if (!panel) return;
    if (panel.style.display !== 'none') close();
    panel.remove();
    panel = null;
  });

  const open = (focus = 'find') => {
    if (!panel) build();
    panel.style.display = 'flex';

    // Pre-fill with the current selection (single-line, sane length).
    const editor = getEditor();
    const { from, to } = editor.state.selection;
    if (to > from && to - from <= 200) {
      const selected = editor.state.doc.textBetween(from, to, '\uFFFC');
      if (selected && !selected.includes('\uFFFC')) {
        searchInput.value = selected;
      }
    }
    if (searchInput.value) applyQuery();

    (focus === 'replace' ? replaceInput : searchInput).focus();
    searchInput.select();
    renderCount();
  };

  return { open, close };
}
