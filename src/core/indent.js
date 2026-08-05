// src/core/indent.js
// ---------------------------------------------------------------------------
// Custom Tiptap extension (feature 2): left paragraph indent as a BLOCK
// attribute on paragraphs and headings — same architecture as core/spacing.js
// (Word semantics: caret in the paragraph → the whole paragraph changes).
//
// The attribute stores an integer LEVEL (0 = none). One level equals
// settings.editor.indentStepMm; renderHTML writes it as an inline
// `margin-left` in mm, so .sdoc (JSON attr), print (getHTML) and copy/paste
// all carry it without extra plumbing. parseHTML accepts two shapes:
//   - inline margin-left in mm/cm/in/pt/px (own output, Word clipboard HTML)
//   - the class `sw-indent-N` that the DOCX import styleMap produces
// Both snap to the level grid and clamp to indentMaxLevels.
//
// Inside LISTS the indent buttons/shortcuts change the LIST level instead
// (sink/lift) — exactly what Word's indent buttons do there. The attribute
// itself stays off list paragraphs; their indent belongs to the list.
//
// Keyboard: Strg+M / Strg+Umschalt+M everywhere; Tab / Umschalt+Tab only at
// the very START of a plain paragraph/heading. This extension is registered
// AFTER the list and table extensions, so its keymap plugin has HIGHER
// precedence (Tiptap reverses the extension order for keymaps) — the
// handlers therefore guard themselves out of lists (sink/lift keeps Tab)
// and tables (cell navigation keeps Tab) by returning false there.
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';

import { settings } from '../config/settings.js';

const MM_PER_UNIT = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };

/** "12.5mm" / "35.4pt" / "48px" / "1.27cm" / "0.5in" → millimetres | null. */
function cssLengthToMm(raw) {
  const match = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|px)$/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  return Number.parseFloat(match[1]) * MM_PER_UNIT[match[2].toLowerCase()];
}

const clampLevel = (level) =>
  Math.max(0, Math.min(settings.editor.indentMaxLevels, Math.round(level)));

export const Indent = Extension.create({
  name: 'indent',

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
          indent: {
            default: 0,
            parseHTML: (element) => {
              // DOCX import path: mammoth styleMap classes (io/docxImport.js).
              const byClass = /(?:^|\s)sw-indent-(\d+)(?:\s|$)/.exec(
                element.getAttribute('class') ?? ''
              );
              if (byClass) return clampLevel(Number.parseInt(byClass[1], 10));
              // Own output + foreign clipboard HTML: inline margin-left.
              const mm = cssLengthToMm(element.style?.marginLeft);
              if (mm === null || mm <= 0) return 0;
              return clampLevel(mm / settings.editor.indentStepMm);
            },
            renderHTML: (attributes) => {
              const level = attributes.indent;
              if (!Number.isInteger(level) || level < 1) return {};
              return { style: `margin-left: ${level * settings.editor.indentStepMm}mm` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    /* Per-node stepping: every paragraph/heading in the selection moves by
       ±1 from ITS OWN level (Word behaviour on multi-paragraph selections),
       clamped to [0, indentMaxLevels]. setNodeMarkup never changes node
       sizes, so iterating the captured doc stays position-safe. */
    const step = (direction) => ({ editor, commands, tr, dispatch }) => {
      if (editor.isActive('listItem')) {
        return direction > 0
          ? commands.sinkListItem('listItem')
          : commands.liftListItem('listItem');
      }
      const names = new Set(this.options.types);
      let changed = false;
      tr.selection.ranges.forEach(({ $from, $to }) => {
        tr.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (!names.has(node.type.name)) return;
          const current = Number.isInteger(node.attrs.indent) ? node.attrs.indent : 0;
          const next = clampLevel(current + direction);
          if (next === current) return;
          changed = true;
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        });
      });
      return changed;
    };

    return {
      increaseIndent: () => step(1),
      decreaseIndent: () => step(-1),
    };
  },

  addKeyboardShortcuts() {
    const tabApplies = () => {
      const { editor } = this;
      if (editor.isActive('listItem') || editor.isActive('table')) return false;
      const { empty, $from } = editor.state.selection;
      return (
        empty &&
        this.options.types.includes($from.parent.type.name) &&
        $from.parentOffset === 0
      );
    };
    return {
      'Mod-m': () => this.editor.commands.increaseIndent(),
      'Mod-Shift-m': () => this.editor.commands.decreaseIndent(),
      // Consume Tab even when the level is already at its bound — the key
      // must never fall through to the browser's focus navigation while the
      // caret sits at a paragraph start.
      Tab: () => {
        if (!tabApplies()) return false;
        this.editor.commands.increaseIndent();
        return true;
      },
      'Shift-Tab': () => {
        if (!tabApplies()) return false;
        this.editor.commands.decreaseIndent();
        return true;
      },
    };
  },
});
