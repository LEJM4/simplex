// src/core/formatPainter.js
// ---------------------------------------------------------------------------
// Format painter (feature, 1.3.0) — Word's brush: pick up the formatting at
// the caret or selection, paint it onto the next selection or click.
//
// Word semantics implemented:
//   - Single click on the button arms the painter for ONE application;
//     double click makes it sticky (paint repeatedly) until Esc or a second
//     button click ends it.
//   - A click (empty selection) paints the WORD under the caret; a drag
//     paints the selection. Clicking whitespace paints paragraph formats
//     only.
//   - Painting REPLACES the target's character formatting (marks are cleared
//     first, then the source marks applied) and carries the paragraph
//     attributes (alignment, line spacing, space after, indent) over.
//   - One application = ONE undo step.
//
// Deliberate limits (documented):
//   - Links are neither copied nor removed — the painter transfers looks,
//     not targets (same rule as pendingMarks, 0.31.1).
//   - The block TYPE does not travel: a heading source does not turn the
//     target into a heading (Word copies the style; we do not have styles —
//     honest limit rather than a surprise).
//   - Shortcuts Ctrl+Shift+C / Ctrl+Shift+V mirror Word's copy/paste format.
//     Browsers may claim Ctrl+Shift+C (dev tools); in the desktop app both
//     always work (same honest line as the font-size shortcuts, 0.21.0).
//
// Architecture: the capture/apply/word-range core is PURE (state in, data
// out — headless-tested); the mode below is a thin shell holding one flag
// and three listeners. Empty target blocks reuse the pendingMarks seed
// (0.31.1), so painting onto a blank paragraph behaves like the toolbar.
// ---------------------------------------------------------------------------

import { TextSelection } from '@tiptap/pm/state';

/** Marks the painter never copies and never removes. */
const PROTECTED_MARKS = new Set(['link']);

/** Block attributes the painter carries (whitelist — internal attributes
 *  like pendingMarks must never travel). */
const BLOCK_ATTRS = ['textAlign', 'lineHeight', 'spaceAfter', 'indent'];

/* Pure core ----------------------------------------------------------------- */

/**
 * Read the formatting at the current selection: character marks (link
 * excluded) as plain JSON and the whitelisted block attributes of the
 * parent textblock. Returns null when the selection sits in no textblock.
 */
export function captureFormat(state) {
  const { selection, storedMarks } = state;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock) return null;

  // Character marks: caret = stored marks (a fresh toolbar choice counts)
  // falling back to the marks at the caret; range = marks of the first
  // character inside it (Word reads the start of the selection).
  let markSource;
  if (selection.empty) {
    markSource = storedMarks ?? $from.marks();
  } else {
    const first = state.doc.resolve(selection.from + 1);
    markSource = selection.from + 1 <= selection.to
      ? first.marks()
      : $from.marks();
  }
  const marks = markSource
    .filter((mark) => !PROTECTED_MARKS.has(mark.type.name))
    .map((mark) => ({ type: mark.type.name, attrs: { ...mark.attrs } }));

  const block = {};
  for (const key of BLOCK_ATTRS) {
    if (key in parent.attrs) block[key] = parent.attrs[key] ?? null;
  }
  return { marks, block };
}

/**
 * Word range around `pos` in its textblock: letters/digits (Unicode) hang
 * together. Returns {from, to} or null when `pos` touches no word — pure,
 * position math only.
 */
export function wordRangeAt(doc, pos) {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const text = parent.textContent;
  const offset = $pos.parentOffset;
  const isWord = (ch) => /[\p{L}\p{N}_]/u.test(ch);
  // A caret BETWEEN characters belongs to a word when either neighbour is one.
  const before = offset > 0 ? text[offset - 1] : '';
  const after = offset < text.length ? text[offset] : '';
  if (!isWord(before) && !isWord(after)) return null;
  let start = offset;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  let end = offset;
  while (end < text.length && isWord(text[end])) end += 1;
  const blockStart = pos - offset;
  return { from: blockStart + start, to: blockStart + end };
}

/**
 * Paint `capture` onto [from, to] — ONE transaction, one undo step:
 *   1. remove every mark except the protected ones,
 *   2. add the captured marks,
 *   3. patch the whitelisted block attributes of every textblock touched,
 *   4. empty textblocks take the capture as a pendingMarks seed instead
 *      (marks need text — 0.31.1), plus stored marks when the caret sits
 *      inside one.
 * Returns true when anything was dispatched.
 */
export function applyCapturedFormat(editor, capture, from, to) {
  if (!capture) return false;
  const { state } = editor;
  const doc = state.doc;
  const clampedFrom = Math.max(0, Math.min(from, doc.content.size));
  const clampedTo = Math.max(clampedFrom, Math.min(to, doc.content.size));

  return editor
    .chain()
    .command(({ tr, state: s }) => {
      // 1. Clear existing character formatting (link survives).
      for (const markType of Object.values(s.schema.marks)) {
        if (PROTECTED_MARKS.has(markType.name)) continue;
        tr.removeMark(clampedFrom, clampedTo, markType);
      }
      // 2. Apply the captured marks.
      for (const spec of capture.marks) {
        const markType = s.schema.marks[spec.type];
        if (!markType) continue; // future-proof: unknown mark in a capture
        if (clampedTo > clampedFrom) {
          tr.addMark(clampedFrom, clampedTo, markType.create(spec.attrs));
        }
      }
      // 3./4. Block attributes + seed for empty textblocks.
      const seed = capture.marks.length ? capture.marks : null;
      doc.nodesBetween(clampedFrom, clampedTo, (node, pos) => {
        if (!node.isTextblock) return true;
        const patch = {};
        for (const key of BLOCK_ATTRS) {
          if (key in node.attrs && key in capture.block) {
            patch[key] = capture.block[key];
          }
        }
        if ('pendingMarks' in node.attrs && node.content.size === 0) {
          patch.pendingMarks = seed;
        }
        if (Object.keys(patch).length) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }, node.marks);
        }
        return false;
      });
      // Caret inside an empty block: arm the stored marks right away, so
      // typing continues in the painted format without leaving first.
      const $from = tr.doc.resolve(Math.min(clampedFrom, tr.doc.content.size));
      if (
        clampedFrom === clampedTo &&
        $from.parent.isTextblock &&
        $from.parent.content.size === 0 &&
        seed
      ) {
        const marks = seed
          .map((spec) => {
            const markType = s.schema.marks[spec.type];
            return markType ? markType.create(spec.attrs) : null;
          })
          .filter(Boolean);
        tr.setStoredMarks(marks);
      }
      tr.setSelection(
        TextSelection.between(tr.doc.resolve(clampedFrom), tr.doc.resolve(clampedTo))
      );
      return true;
    })
    .run();
}

/* Mode shell ----------------------------------------------------------------- */

/**
 * The painter mode: armed by the toolbar button, applied by the next
 * pointerup inside the editor. `onChange` drives the button's active state.
 */
export function createFormatPainter(getEditor, { onChange } = {}) {
  let armed = false;
  let sticky = false;
  let capture = null;

  const notify = () => onChange?.(armed, sticky);

  const setDomClass = (on) => {
    const dom = getEditor()?.view?.dom;
    dom?.classList.toggle('sw-format-painter-active', on);
  };

  const disarm = () => {
    if (!armed) return;
    armed = false;
    sticky = false;
    capture = null;
    getEditor()?.view?.dom?.removeEventListener('pointerup', onPointerUp);
    setDomClass(false);
    notify();
  };

  const arm = (asSticky) => {
    const editor = getEditor();
    if (!editor) return;
    capture = captureFormat(editor.state);
    if (!capture) return;
    armed = true;
    sticky = asSticky;
    // (Re)attach on the CURRENT editor DOM — an editor rebuild between two
    // paints simply gets a fresh listener on the next arm.
    editor.view.dom.addEventListener('pointerup', onPointerUp);
    setDomClass(true);
    notify();
  };

  /** Toolbar entry point: click arms once, double click arms sticky,
   *  clicking while armed cancels (Word behaviour on all three). */
  const toggle = (asSticky) => {
    if (armed && !asSticky) {
      disarm();
      return;
    }
    arm(asSticky);
  };

  /** The paint stroke: selection when there is one, the word under the
   *  caret otherwise; whitespace clicks paint paragraph formats only. */
  const paint = () => {
    const editor = getEditor();
    if (!editor || !capture) return;
    const { selection } = editor.state;
    let from = selection.from;
    let to = selection.to;
    if (selection.empty) {
      const word = wordRangeAt(editor.state.doc, selection.from);
      if (word) ({ from, to } = word);
    }
    applyCapturedFormat(editor, capture, from, to);
    if (!sticky) disarm();
  };

  const onPointerUp = () => {
    if (!armed) return;
    // Let ProseMirror finish the selection this pointerup produces first.
    setTimeout(paint, 0);
  };
  const onKeyDown = (event) => {
    if (!armed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      disarm();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  /** Word's shortcut pair on the same store: Ctrl+Shift+C captures,
   *  Ctrl+Shift+V paints the current selection (no mode involved). */
  const onShortcut = (event) => {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false;
    const key = event.key.toLowerCase();
    const editor = getEditor();
    if (!editor || !editor.isFocused) return false;
    if (key === 'c') {
      capture = captureFormat(editor.state);
      return capture !== null;
    }
    if (key === 'v' && capture) {
      const { selection } = editor.state;
      let from = selection.from;
      let to = selection.to;
      if (selection.empty) {
        const word = wordRangeAt(editor.state.doc, selection.from);
        if (word) ({ from, to } = word);
      }
      applyCapturedFormat(editor, capture, from, to);
      return true;
    }
    return false;
  };

  return { toggle, disarm, onShortcut, isArmed: () => armed };
}
