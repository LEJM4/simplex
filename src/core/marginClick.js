// src/core/marginClick.js
// ---------------------------------------------------------------------------
// Clicking the sheet's margin used to park the caret at the DOCUMENT END —
// fine as a "focus somewhere" fallback, jarring next to a specific line.
// Word maps a margin click to the closest text position; we do the same:
// clamp the click point into the content column and let ProseMirror's
// posAtCoords resolve it. Left margin → the start of that visual line,
// right margin → its end (the clamped X lands on the line's near edge);
// the vertical paddings clamp to the first/last line. TextSelection.near
// absorbs positions that are not directly selectable (table edges, images).
//
// posAtCoords needs real layout, which jsdom cannot provide (all rects are
// 0×0) — so the coordinate mapping lives here as a pure, headless-testable
// helper and the DOM wiring stays a thin, stubbable layer.
// ---------------------------------------------------------------------------

import { TextSelection } from '@tiptap/pm/state';

/** Clamp a client point into a rect; the 1px inset keeps posAtCoords inside. */
export function clampToRect(point, rect) {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  return {
    left: clamp(point.left, rect.left + 1, rect.right - 1),
    top: clamp(point.top, rect.top + 1, rect.bottom - 1),
  };
}

/** Wire the margin-click mapping onto the sheet element (#page). */
export function attachMarginClick(pageElement, getEditor) {
  pageElement.addEventListener('mousedown', (event) => {
    // Clicks INSIDE the content column are ProseMirror's business; only the
    // sheet's own padding (the page margins) reaches us as direct target.
    if (event.target !== pageElement) return;
    const editor = getEditor();
    if (!editor) return;
    event.preventDefault(); // the sheet must not steal focus from the editor

    const rect = editor.view.dom.getBoundingClientRect();
    const found = editor.view.posAtCoords(
      clampToRect({ left: event.clientX, top: event.clientY }, rect)
    );
    if (found) {
      const pos = Math.min(found.pos, editor.state.doc.content.size);
      const selection = TextSelection.near(editor.state.doc.resolve(pos));
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    }
    editor.view.focus();
  });
}
