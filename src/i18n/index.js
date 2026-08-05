// src/i18n/index.js
// ---------------------------------------------------------------------------
// Minimal i18n module: flat "key → string" dictionaries, one file per
// language. Every user-visible string in the app MUST go through t('key').
// Adding a language = adding one file and one entry in `dictionaries`.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { de } from './de.js';
import { en } from './en.js';

const dictionaries = { de, en };

let currentLanguage = settings.i18n.defaultLanguage;

/**
 * Translate a key. Optional placeholders: t('x.y', { count: 3 }) replaces
 * "{count}" inside the string. Falls back to the fallback language, then to
 * the key itself (with a console warning) so missing keys are always visible.
 */
export function t(key, vars = {}) {
  const text =
    dictionaries[currentLanguage]?.[key] ??
    dictionaries[settings.i18n.fallbackLanguage]?.[key];

  if (text === undefined) {
    console.warn(`[i18n] missing key "${key}" for language "${currentLanguage}"`);
    return key;
  }

  return text.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

/** Current language code, e.g. 'de'. */
export function getLanguage() {
  return currentLanguage;
}

/** All available language codes. */
export function getAvailableLanguages() {
  return Object.keys(dictionaries);
}

/** Switch the UI language at runtime (used by the settings dialog, phase 6). */
export function setLanguage(code) {
  if (!(code in dictionaries) || code === currentLanguage) return;
  currentLanguage = code;
  document.documentElement.lang = code;
  appState.set('language', code);
  appState.emit('language:changed', code);
}

/**
 * Initialise the language on app start. `initial` is the persisted choice
 * from IndexedDB (may be null or stale) — invalid codes fall back to the
 * default from settings.js.
 */
export function initI18n(initial = null) {
  if (initial && initial in dictionaries) currentLanguage = initial;
  document.documentElement.lang = currentLanguage;
  appState.set('language', currentLanguage);
}

// Dev-only guard: all language files must define the same keys
// (part of the project's definition of done).
if (import.meta.env?.DEV) {
  const allKeys = new Set(
    Object.values(dictionaries).flatMap((dict) => Object.keys(dict))
  );
  for (const [code, dict] of Object.entries(dictionaries)) {
    for (const key of allKeys) {
      if (!(key in dict)) {
        console.warn(`[i18n] language "${code}" is missing key "${key}"`);
      }
    }
  }
}
