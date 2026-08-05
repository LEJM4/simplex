// src/core/theme.js
// ---------------------------------------------------------------------------
// App theme (phase 6): preference 'system' | 'light' | 'dark', applied as
// data-theme="light|dark" on <html> — app.css maps the color tokens per theme.
// Deliberate scope: dark mode restyles the CHROME only; the sheet stays white
// paper (content colors are bound to the paper via the --color-ink-* tokens).
//
// Persistence is localStorage on purpose (unlike zoom/spellcheck → IndexedDB):
// the value must be readable synchronously before the first paint. The inline
// script in index.html does that early read; this module keeps everything in
// sync at runtime. `element.style.colorScheme` (not a CSS rule) drives native
// controls/scrollbars, because the inline script already sets it pre-CSS.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from './appState.js';

/** Preference values offered in the settings dialog (i18n key: theme.<value>). */
export const THEMES = ['system', 'light', 'dark'];

const media = window.matchMedia('(prefers-color-scheme: dark)');

const resolve = (preference) =>
  preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;

function apply(preference) {
  const resolved = resolve(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;

  // Browser/installed-window titlebar tint (phase 6d): follow the chrome
  // surface token. Read AFTER the theme attribute switch so the computed
  // value is the resolved theme's one.
  const surface = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface')
    .trim();
  if (surface) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
  }
}

/**
 * Wire the theme into the app state and apply the stored preference.
 * State key 'theme' holds the PREFERENCE ('system' included); the resolved
 * value only ever lives on the <html> element.
 */
export function initTheme() {
  appState.on('change:theme', ({ value }) => {
    apply(value);
    try {
      localStorage.setItem(settings.view.themeKey, value);
    } catch {
      /* persistence is a convenience — never block on it */
    }
  });

  // Follow the OS live while the preference is 'system'.
  media.addEventListener('change', () => {
    if (appState.get('theme') === 'system') apply('system');
  });

  let stored = null;
  try {
    stored = localStorage.getItem(settings.view.themeKey);
  } catch {
    /* fall back to default */
  }
  appState.set('theme', THEMES.includes(stored) ? stored : settings.view.themeDefault);
}
