// src/core/inspect.js
// ---------------------------------------------------------------------------
// Inspection mode (phase 6c+, toggle in the settings dialog): a formatting
// X-ray for finding ACCIDENTAL layout changes.
//
// While active, every textblock gets a small margin badge showing its
// effective font size, plus its line height (×1,15) and space-after (+6 pt)
// — the latter two only when explicitly set on the block. Badges of blocks
// that deviate from the document defaults are accent-colored; inline runs
// whose explicit size differs from the block's dominant size are outlined
// and labelled directly at the text ("the accidentally enlarged word").
//
// Everything is ProseMirror DECORATIONS: the document, its JSON, the .sdoc
// file, DOCX export and print (which serializes via getHTML) stay untouched.
// Sizes shown are the LOGICAL ones (explicit mark, else the type's default —
// headings via settings.docx.headingFactors, mirroring editor.css); template
// styling like the code mark's 0.9em is intentional and not reported.
//
// Badges are skipped inside tables (a chip hanging left of a cell would
// cover the neighbour cell) — inline deviation runs still show there.
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { settings } from '../config/settings.js';
import { appState } from './appState.js';
import { t, getLanguage } from '../i18n/index.js';

export const inspectKey = new PluginKey('sw-inspect');

const parseNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/* Label building is the hot part of the scan (runs per block, per keystroke
   while active): toLocaleString would create an Intl.NumberFormat PER CALL
   (measured: ~70 ms for a 122-page document). One cached formatter per
   language plus memoized label strings bring the full scan down to ~2 ms —
   thousands of default paragraphs share the identical "12 pt" label. */
let numberFormat = null;
let numberFormatLanguage = null;
const labelCache = new Map();

function formatNumber(value) {
  const language = getLanguage();
  if (language !== numberFormatLanguage) {
    numberFormat = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
    numberFormatLanguage = language;
    labelCache.clear(); // labels embed formatted numbers AND t() texts
  }
  return numberFormat.format(value);
}

const cached = (key, build) => {
  let label = labelCache.get(key);
  if (label === undefined) {
    label = build();
    labelCache.set(key, label);
  }
  return label;
};

const sizeLabel = (pt) =>
  cached(`s|${pt}`, () => t('inspect.sizePt', { value: formatNumber(pt) }));

const blockLabel = (pt, lineHeight, spaceAfterPt, indentLevel) =>
  cached(`b|${pt}|${lineHeight}|${spaceAfterPt}|${indentLevel}`, () => {
    const parts = [sizeLabel(pt)];
    if (lineHeight !== null) parts.push(t('inspect.lineHeight', { value: formatNumber(lineHeight) }));
    if (spaceAfterPt !== null) parts.push(t('inspect.spaceAfter', { value: formatNumber(spaceAfterPt) }));
    if (indentLevel !== null) parts.push(t('inspect.indent', { value: formatNumber(indentLevel) }));
    return parts.join(' · ');
  });

/** Logical size of a block without explicit marks (pt). */
function blockDefaultPt(node, base) {
  if (node.type.name === 'heading') {
    return base * (settings.docx.headingFactors[node.attrs.level] ?? 1);
  }
  return base;
}

/** Explicit fontSize (pt) of a text node's textStyle mark, or null. */
function explicitPt(textNode) {
  const mark = textNode.marks.find((candidate) => candidate.type.name === 'textStyle');
  return mark ? parseNumber(mark.attrs.fontSize) : null;
}

/**
 * Walk the document and describe every textblock:
 *   { from, to, label, deviates, badge, runs: [{ from, to, label }] }
 * Pure function (no view, no DOM) — exported for headless tests/benchmarks.
 */
export function collectInspect(doc, basePt = settings.editor.fontSizePt) {
  const blocks = [];

  const walk = (node, pos, inTable) => {
    if (node.isTextblock) {
      // Dominant explicit size = the one covering the most characters;
      // unmarked text counts as null (→ the block's logical default).
      const coverage = new Map(); // key: pt value or null
      node.content.forEach((child) => {
        if (!child.isText) return;
        const key = explicitPt(child);
        coverage.set(key, (coverage.get(key) ?? 0) + child.text.length);
      });
      let dominantExplicit = null;
      let dominantChars = -1;
      for (const [key, chars] of coverage) {
        if (chars > dominantChars) { dominantChars = chars; dominantExplicit = key; }
      }

      const defaultPt = blockDefaultPt(node, basePt);
      const dominantPt = dominantExplicit ?? defaultPt;

      // Contiguous runs whose explicit size differs from the dominant one.
      const runs = [];
      let run = null;
      node.content.forEach((child, offset) => {
        const from = pos + 1 + offset;
        const size = child.isText ? explicitPt(child) : null;
        if (child.isText && size !== dominantExplicit) {
          const pt = size ?? defaultPt;
          if (run && run.pt === pt && run.to === from) {
            run.to = from + child.nodeSize;
          } else {
            run = { from, to: from + child.nodeSize, pt };
            runs.push(run);
          }
        } else {
          run = null;
        }
      });

      const lineHeight = parseNumber(node.attrs.lineHeight);
      const spaceAfterPt = parseNumber(node.attrs.spaceAfter);
      const indentLevel =
        Number.isInteger(node.attrs.indent) && node.attrs.indent > 0 ? node.attrs.indent : null;

      blocks.push({
        from: pos,
        to: pos + node.nodeSize,
        label: blockLabel(dominantPt, lineHeight, spaceAfterPt, indentLevel),
        deviates:
          dominantPt !== defaultPt || runs.length > 0 || lineHeight !== null ||
          spaceAfterPt !== null || indentLevel !== null,
        badge: !inTable,
        runs: runs.map(({ from, to, pt }) => ({
          from,
          to,
          label: sizeLabel(pt),
        })),
      });
      return; // textblocks have inline content only — nothing to descend into
    }

    const nextInTable = inTable || node.type.name === 'table';
    node.forEach((child, offset) => walk(child, pos + 1 + offset, nextInTable));
  };

  doc.forEach((child, offset) => walk(child, offset, false));
  return blocks;
}

function buildDecorations(doc) {
  const decorations = [];
  // Feature 8: deviations are measured against the DOCUMENT base — a 14-pt
  // document must not flag its own default (and the badge shows 14, not 12).
  for (const block of collectInspect(
    doc,
    appState.get('docSettings')?.fontSizePt ?? settings.editor.fontSizePt
  )) {
    if (block.badge) {
      decorations.push(
        Decoration.node(block.from, block.to, {
          class: 'sw-inspect' + (block.deviates ? ' sw-inspect--dev' : ''),
          'data-sw-inspect': block.label,
        })
      );
    }
    for (const run of block.runs) {
      decorations.push(
        Decoration.inline(run.from, run.to, {
          class: 'sw-inspect-run',
          'data-sw-inspect': run.label,
        })
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

export const Inspect = Extension.create({
  name: 'swInspect',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: inspectKey,
        state: {
          init: () => ({ active: false, decorations: DecorationSet.empty }),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(inspectKey);
            if (meta !== undefined) {
              return {
                active: meta.active,
                decorations: meta.active ? buildDecorations(newState.doc) : DecorationSet.empty,
              };
            }
            if (!previous.active) return previous;
            if (tr.docChanged) {
              return { active: true, decorations: buildDecorations(newState.doc) };
            }
            return previous; // selection-only transactions cost nothing
          },
        },
        props: {
          decorations(state) {
            return inspectKey.getState(state).decorations;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      /** Toggle the diagnostic overlay (app-level state, wired in main.js). */
      setInspect:
        (active) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(inspectKey, { active }));
          return true;
        },
    };
  },
});
