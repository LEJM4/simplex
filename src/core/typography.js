// src/core/typography.js
// ---------------------------------------------------------------------------
// Typographic replacements while typing (phase 7b), built on the pinned
// @tiptap/extension-typography: straight quotes become German quotes,
// -- a Gedankenstrich, ... an ellipsis, and so on. Which rules run and which
// characters they insert lives in settings.js (typography.rules).
//
// Runtime toggle without an editor rebuild: every stock rule is wrapped in
// an InputRule whose handler returns null while the feature is off — the
// input-rule plugin then skips the rule and the typed character stays as-is
// (verified in @tiptap/core 3.29.1: `if (handler === null || !tr.steps.length)
// return`). The flag is read at the moment of typing (appState 'typography',
// set by the settings dialog and persisted by main.js), history stays intact,
// and Backspace right after a replacement restores the raw input via the
// core undoInputRule binding.
// ---------------------------------------------------------------------------

import { InputRule } from '@tiptap/core';
import Typography from '@tiptap/extension-typography';

import { settings } from '../config/settings.js';
import { appState } from './appState.js';

const typographyEnabled = () =>
  appState.get('typography') ?? settings.typography.enabled;

export const SwTypography = Typography.extend({
  addInputRules() {
    const rules = this.parent?.() ?? [];
    return rules.map(
      (rule) =>
        new InputRule({
          find: rule.find,
          undoable: rule.undoable,
          handler: (props) => (typographyEnabled() ? rule.handler(props) : null),
        })
    );
  },
});
