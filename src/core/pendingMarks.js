// src/core/pendingMarks.js
// ---------------------------------------------------------------------------
// Word keeps character formatting on the paragraph mark (the pilcrow), so a
// font applied to EMPTY paragraphs survives until text arrives — the classic
// case: a fresh table, all cells selected, font family/size changed.
// ProseMirror marks need text to sit on, and stored marks cover only the one
// caret position, so a CellSelection over empty cells used to drop the
// change silently (source-verified in @tiptap/core setMark: empty selection
// → addStoredMark, ranges → addMark on existing inline content only).
//
// The bridge is a `pendingMarks` attribute on paragraph/heading — an array
// of serialized marks ([{ type, attrs }]) waiting for the block's first
// input, or null:
//
//   - seedPendingTextStyle({ fontFamily?, fontSize? }) merges the given
//     textStyle attrs into every EMPTY textblock of the selection
//     (TextSelection and table CellSelection alike — both expose `ranges`).
//     A null value REMOVES that component: the toolbar rule "picking the
//     document default clears the mark" applies to seeds too. Chained after
//     setFontFamily/setFontSize it shares their transaction — one undo step.
//   - Plugin, three appended rules:
//       (a) the caret enters an empty seeded block → the seed becomes
//           stored marks, so the next character materializes REAL marks;
//       (b) a block that gained content drops its seed (the marks now live
//           on the text) — the scan stays inside the changed range, no
//           full-document walk per keystroke (the 0.11.0 lesson);
//       (c) a block emptied by an edit re-seeds from the removed text's
//           marks and restores them as stored marks — "select all in the
//           cell, delete, retype" keeps the formatting (Word's pilcrow
//           behavior). Links are excluded: Word does not continue a
//           hyperlink onto newly typed text either.
//   - renderHTML paints font-family/size onto the empty block, so the caret
//     previews the pending formatting on screen and in print; a data
//     attribute round-trips the seed through copy/paste.
//
// `.sdoc` carries the attribute as plain JSON. The frozen v1 read promise
// holds: prosemirror-model's computeAttrs iterates the DECLARED attributes
// only (source-verified), so pre-0.31.1 readers drop the unknown attribute
// silently instead of failing.
//
// Honest limit: the seed lives in `.sdoc` only — DOCX export writes runs,
// and an empty paragraph has none (Word's pilcrow rPr stays out of scope).
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const TYPES = ['paragraph', 'heading'];

/* Seed helpers (pure — headless-tested) ------------------------------------ */

/** The textStyle attrs of a seed, or null. */
export function seedTextStyle(seed) {
  const entry = Array.isArray(seed)
    ? seed.find((mark) => mark?.type === 'textStyle')
    : null;
  return entry?.attrs ?? null;
}

/** Merge a textStyle patch into a seed; null values remove their key. */
export function mergeTextStyleSeed(seed, patch) {
  const attrs = { ...(compactAttrs(seedTextStyle(seed)) ?? {}) };
  Object.entries(patch ?? {}).forEach(([key, value]) => {
    if (value == null) delete attrs[key];
    else attrs[key] = value;
  });
  const rest = (Array.isArray(seed) ? seed : []).filter(
    (mark) => mark?.type !== 'textStyle'
  );
  const next = Object.keys(attrs).length
    ? [...rest, { type: 'textStyle', attrs }]
    : rest;
  return next.length ? next : null;
}

const seedEquals = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Attrs without null/undefined values, or null when nothing remains. */
function compactAttrs(attrs) {
  const entries = Object.entries(attrs ?? {}).filter(([, value]) => value != null);
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * Real marks → seed entries. Null-valued attrs are dropped (mark.toJSON()
 * carries every schema attribute, e.g. Color's `color: null` on textStyle);
 * a textStyle whose attrs compact away carries nothing and is skipped.
 */
function marksToSeed(marks) {
  const seed = marks
    .map((mark) => {
      const json = mark.toJSON();
      const attrs = compactAttrs(json.attrs);
      if (json.type === 'textStyle' && !attrs) return null;
      return attrs ? { type: json.type, attrs } : { type: json.type };
    })
    .filter(Boolean);
  return seed.length ? seed : null;
}

/** Serialized seed → real marks; unknown types drop (forward tolerant). */
function seedToMarks(seed, schema) {
  return (Array.isArray(seed) ? seed : [])
    .map((mark) => {
      const type = schema.marks[mark?.type];
      try {
        return type ? type.create(mark.attrs ?? undefined) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** Inline style preview for an empty seeded block (caret metrics). */
function seedStyle(seed) {
  const attrs = seedTextStyle(seed);
  if (!attrs) return null;
  const parts = [];
  if (attrs.fontFamily) parts.push(`font-family: ${attrs.fontFamily}`);
  if (attrs.fontSize) parts.push(`font-size: ${attrs.fontSize}`);
  return parts.length ? parts.join('; ') : null;
}

/**
 * The pending textStyle at the selection, or null. Covers the caret in an
 * empty block AND a CellSelection (whose $from sits on the row, one level
 * above the anchor cell) — the toolbar display falls back to this so a just
 * seeded selection shows the chosen font instead of the document default.
 */
export function pendingTextStyleAt(state) {
  const { $from } = state.selection;
  let block = $from.parent;
  if (!block.isTextblock) {
    const after = $from.nodeAfter; // CellSelection: the anchor cell
    block = after?.isTextblock ? after : (after?.firstChild ?? null);
  }
  if (!block?.isTextblock || block.childCount > 0) return null;
  return seedTextStyle(block.attrs?.pendingMarks ?? null);
}

/* Extension ----------------------------------------------------------------- */

export const PendingMarks = Extension.create({
  name: 'pendingMarks',

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          pendingMarks: {
            default: null,
            parseHTML: (element) => {
              try {
                const raw = element.getAttribute('data-pending-marks');
                const parsed = raw ? JSON.parse(raw) : null;
                return Array.isArray(parsed) && parsed.length ? parsed : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attributes) => {
              const seed = attributes.pendingMarks;
              if (!Array.isArray(seed) || seed.length === 0) return {};
              const style = seedStyle(seed);
              return {
                'data-pending-marks': JSON.stringify(seed),
                ...(style ? { style } : {}),
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      seedPendingTextStyle: (patch) => ({ tr, state }) => {
        const seedAt = (node, pos) => {
          if (!node.isTextblock || node.childCount > 0) return;
          if (!TYPES.includes(node.type.name)) return;
          const next = mergeTextStyleSeed(node.attrs.pendingMarks, patch);
          if (!seedEquals(next, node.attrs.pendingMarks)) {
            tr.setNodeAttribute(pos, 'pendingMarks', next);
          }
        };
        const { selection } = state;
        if (selection.empty) {
          // nodesBetween may skip a zero-width range — address the caret's
          // block directly.
          seedAt(selection.$from.parent, selection.$from.before());
        } else {
          selection.ranges.forEach(({ $from, $to }) => {
            state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
              seedAt(node, pos);
            });
          });
        }
        return true; // best effort — never break the surrounding chain
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pendingMarks'),
        appendTransaction(transactions, oldState, newState) {
          // Undo/redo replays inverted steps — appending fresh changes on
          // top would create new history items and corrupt the redo chain.
          if (transactions.some((item) => item.getMeta('history$'))) return null;

          let tr = null;
          const ensure = () => (tr = tr ?? newState.tr);
          const docChanged = transactions.some((item) => item.docChanged);

          if (docChanged) {
            // Envelope of the changed positions in the NEW document — keeps
            // the scan local to the edit instead of walking 120 pages.
            let from = Infinity;
            let to = -Infinity;
            transactions.forEach((item) =>
              item.mapping.maps.forEach((map) =>
                map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
                  from = Math.min(from, newFrom);
                  to = Math.max(to, newTo);
                })
              )
            );
            if (from <= to) {
              const scanFrom = Math.max(0, from - 1);
              const scanTo = Math.min(newState.doc.content.size, to + 1);
              // (b) content arrived → the seed did its job, drop it.
              newState.doc.nodesBetween(scanFrom, scanTo, (node, pos) => {
                if (node.isTextblock && node.childCount > 0 && node.attrs.pendingMarks) {
                  ensure().setNodeAttribute(pos, 'pendingMarks', null);
                }
              });
            }

            // (c) the caret's block was emptied by this edit → re-seed from
            // the marks the removed text carried and restore them as stored
            // marks, so retyping continues the formatting immediately.
            const { selection } = newState;
            const parent = selection.$from.parent;
            const oldParent = oldState.selection.$from.parent;
            if (
              selection.empty &&
              parent.isTextblock &&
              parent.childCount === 0 &&
              !parent.attrs.pendingMarks &&
              TYPES.includes(parent.type.name) &&
              oldParent.isTextblock &&
              oldParent.childCount > 0 // never conjure formatting from nothing
            ) {
              const marks = (oldState.storedMarks ?? oldState.selection.$from.marks())
                .filter((mark) => mark.type.name !== 'link');
              const seed = marksToSeed(marks);
              if (seed) {
                ensure()
                  .setNodeAttribute(selection.$from.before(), 'pendingMarks', seed)
                  .setStoredMarks(marks);
              }
            }
          }

          // (a) the caret sits in an empty seeded block without stored marks
          // (fresh entry, or ProseMirror dropped them on selection change) →
          // arm the seed. A user toggle leaves an ARRAY behind (possibly
          // empty), so `== null` never fights an explicit removal.
          const { selection } = newState;
          if (selection.empty && newState.storedMarks == null) {
            const parent = selection.$from.parent;
            if (parent.isTextblock && parent.childCount === 0 && parent.attrs.pendingMarks) {
              const marks = seedToMarks(parent.attrs.pendingMarks, newState.schema);
              if (marks.length) ensure().setStoredMarks(marks);
            }
          }

          return tr;
        },
      }),
    ];
  },
});
