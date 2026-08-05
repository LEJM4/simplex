// src/core/clearFormatting.js
// ---------------------------------------------------------------------------
// "Clear formatting" (feature 2), Word's Strg+Leertaste on steroids: one
// command that takes the selection back to plain default text.
//
//   1. resetAttributes  — our block attributes (textAlign, lineHeight,
//                         spaceAfter, indent, pendingMarks) back to defaults
//   2. unsetAllMarks    — bold/italic/…, color, size, font, highlight, link
//   3. clearNodes       — headings → paragraph, quotes/lists lifted
//
// The order is deliberate: attribute resets and mark removal never shift
// document positions, so clearNodes (which lifts and therefore remaps) has
// to run LAST — the built-in resetAttributes iterates unmapped positions.
// clearNodes converts textblocks via setNodeMarkup and KEEPS shared
// attributes, which is exactly why step 1 exists: without it a cleared
// heading would stay right-aligned or indented.
//
// Honest limit (documented in the plan): unsetAllMarks removes link marks
// too — "clear formatting" on a link deletes the link, not just its look.
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';

const BLOCK_ATTRIBUTES = ['textAlign', 'lineHeight', 'spaceAfter', 'indent', 'pendingMarks'];

export const ClearFormatting = Extension.create({
  name: 'clearFormatting',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
    };
  },

  addCommands() {
    return {
      clearFormatting: () => ({ tr, commands }) => {
        const reset = this.options.types.map((type) =>
          commands.resetAttributes(type, BLOCK_ATTRIBUTES)
        );
        const marks = commands.unsetAllMarks();
        // Caret without selection: also drop the pending ("stored") marks so
        // the NEXT typed character starts clean — Word's Strg+Leertaste feel.
        if (tr.selection.empty) tr.setStoredMarks(null);
        const nodes = commands.clearNodes();
        return reset.some(Boolean) || marks || nodes;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Capital "Space" on purpose: prosemirror-keymap's alias check
      // (`result == "Space"` → " ") is case-sensitive.
      'Mod-Space': () => this.editor.commands.clearFormatting(),
    };
  },
});
