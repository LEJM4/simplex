// src/core/spacing.js
// ---------------------------------------------------------------------------
// Custom Tiptap extension: line height and space-after-paragraph as BLOCK
// attributes on paragraphs and headings (Word semantics: caret in the
// paragraph → the whole paragraph changes, empty paragraphs included).
//
// Deliberately not @tiptap/extension-text-style's LineHeight: that one is
// mark-based (a <span> around characters, like font size), which breaks the
// per-paragraph model. Same pattern as TextAlign instead; the command names
// are free because the mark-based LineHeight is not registered in this app.
//
// Values are raw CSS strings: lineHeight '1.15' (unitless), spaceAfter '6pt'.
// null = document default from settings.js (via CSS variables).
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';

export const Spacing = Extension.create({
  name: 'spacing',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight
                ? { style: `line-height: ${attributes.lineHeight}` }
                : {},
          },
          spaceAfter: {
            default: null,
            parseHTML: (element) => element.style.marginBottom || null,
            renderHTML: (attributes) =>
              attributes.spaceAfter
                ? { style: `margin-bottom: ${attributes.spaceAfter}` }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // Same pattern as TextAlign upstream: try every configured type and
      // succeed if any matched. (`every` would short-circuit on the first
      // type that is not present at the selection — e.g. a caret inside a
      // heading makes updateAttributes('paragraph', …) return false, and the
      // heading would never be reached.)
      setLineHeight:
        (lineHeight) =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.updateAttributes(type, { lineHeight }))
            .some(Boolean),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.resetAttributes(type, 'lineHeight'))
            .some(Boolean),
      setSpaceAfter:
        (spaceAfter) =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.updateAttributes(type, { spaceAfter }))
            .some(Boolean),
      unsetSpaceAfter:
        () =>
        ({ commands }) =>
          this.options.types
            .map((type) => commands.resetAttributes(type, 'spaceAfter'))
            .some(Boolean),
    };
  },
});
