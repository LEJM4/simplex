// src/core/paginator.js
// ---------------------------------------------------------------------------
// The pagination RULE core (phase 9). computeBreaks() is a pure function:
// it receives measured unit metrics plus a line-measuring callback and
// returns the list of page breaks — no DOM, no view, no editor. That is the
// only way the Word rule set (orphan/widow control, keep-with-next,
// atomic blocks, float invariants, forced breaks) stays headless-testable;
// the DOM measuring lives in core/pageView.js and injects real values.
//
// Coordinate space: "content space" — CSS px at 100 % zoom with all page
// spacers subtracted, i.e. the document as if it were one continuous flow.
// Unit tops/bottoms are border-box rects WITHOUT margins (like
// getBoundingClientRect), which makes Word's "space after is swallowed at a
// page end" fall out of the math for free.
//
// Units are the breakable flow atoms of the document: textblocks (splittable
// line-wise), images/rules/code blocks (atomic), tables (atomic, documented
// v1 limit), and pageBreak nodes (forced). Lists and blockquotes are
// flattened into their children by the measurer, so lists break BETWEEN and
// INSIDE items exactly like top-level paragraphs.
//
// Container-start rule (1.2.1): flattening makes a unit's `pos` point at the
// paragraph INSIDE its list item — a legal position in the flow model, but
// not in the box model. Breaking there leaves the <li> box OPEN on the old
// page, where CSS draws its ::marker, while the text moves on: bullet on one
// page, words on the next. Every unit therefore carries `breakPos` — the
// position a break before it must actually use, hoisted out of every
// container whose FIRST child it is (paragraph → list item → list; same for
// blockquote, whose left bar tears the same way). Deliberately untouched:
// a mid-text split (the marker already has its lines) and a follow-up
// paragraph inside the same item (it has no marker of its own).
//
// Stability invariant: no active float may span a page boundary. A float
// poking over the computed edge pulls the break up to its anchor unit —
// otherwise the spacer's `clear: both` would re-wrap the lines after the
// gap and the whole computation could oscillate. With the invariant the
// pagination is a strict one-pass, monotonically progressing algorithm.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PageUnit
 * @property {number} pos            document position BEFORE the unit's node
 * @property {number} end            document position AFTER the unit's node
 * @property {number} [breakPos]     position a page break BEFORE this unit
 *                                   must use — `pos` hoisted out of every
 *                                   container whose first child the unit is
 *                                   (see container-start rule above).
 *                                   Defaults to `pos` when absent.
 * @property {number} top            content-space top (border box, no margin)
 * @property {number} bottom         content-space bottom (border box)
 * @property {number} marginTopPx    used margin-top (for head trimming)
 * @property {number} marginBottomPx used margin-bottom (for foot trimming)
 * @property {'text'|'atomic'|'table'|'pageBreak'} type
 * @property {boolean} keepWithNext  headings: never dangle at a page end
 * @property {boolean} splittable    line-wise split allowed (textblocks)
 * @property {number|null} floatBottom content-space bottom of the lowest
 *                                   float anchored in this unit, or null
 */

/**
 * @typedef {Object} PageBreakResult
 * @property {number} pos       document position where the NEW page starts
 *                              (between blocks, or an inline position for
 *                              a line split)
 * @property {'block'|'split'|'forced'} kind
 * @property {number} page      number of the page that ENDS here (1-based)
 * @property {number} fillPx    white filler between the last content and the
 *                              bottom page margin (content space)
 * @property {number} footTrimPx margin-bottom of the last block — swallowed
 *                              from the filler so the sheet geometry is exact
 * @property {number} headTrimPx margin-top of the first block on the next
 *                              page — trimmed from the spacer's head strip
 *                              (Word: "space before" is suppressed at a
 *                              page start)
 * @property {number} startY    content-space Y where the new page starts
 */

/**
 * Compute the page breaks for a measured document.
 *
 * @param {PageUnit[]} units    flow units in document order
 * @param {Object} options
 * @param {number} options.contentHeight   inner page height in content px
 * @param {number} options.minOrphanLines  min lines left at a page end
 * @param {number} options.minWidowLines   min lines moved to the next page
 * @param {boolean} options.keepHeadingWithNext
 * @param {number} options.epsilonPx       sub-pixel tolerance
 * @param {boolean} options.stretchOversize
 * @param {(unitIndex: number) => {top:number,bottom:number,pos:number}[]} linesFor
 *        line boxes of a splittable unit (content space, document order);
 *        only ever called for units with `splittable: true`
 * @returns {{ pages: number, breaks: PageBreakResult[], lastFillPx: number }}
 */
export function computeBreaks(units, options, linesFor) {
  const {
    contentHeight,
    minOrphanLines,
    minWidowLines,
    keepHeadingWithNext,
    epsilonPx: eps,
    stretchOversize,
  } = options;

  const breaks = [];
  if (units.length === 0) {
    return { pages: 1, breaks, lastFillPx: contentHeight, converged: null };
  }

  // Incremental convergence (options.knownBreaks): the previous, mapped
  // break list AFTER the recompute window. As soon as a freshly computed
  // break lands on a known position with the same kind, everything below is
  // provably unchanged (the layout merely shifted) — the caller reattaches
  // the old tail. `converged` returns the matched index, or null.
  const known = options.knownBreaks ?? null;
  let knownIndex = 0;
  let converged = null;

  let pageStartY = units[0].top;
  let pageEnd = pageStartY + contentHeight;
  let pageFirstIndex = 0; // first unit on the current page
  let page = 1;

  const effectiveBottom = (unit) =>
    unit.floatBottom !== null && unit.floatBottom !== undefined
      ? Math.max(unit.bottom, unit.floatBottom)
      : unit.bottom;

  const pushBreak = (entry) => {
    breaks.push({ page, ...entry });
    page += 1;
    pageStartY = entry.startY;
    pageEnd = pageStartY + contentHeight;
    if (known) {
      while (knownIndex < known.length && known[knownIndex].pos < entry.pos) {
        knownIndex += 1;
      }
      if (
        knownIndex < known.length &&
        known[knownIndex].pos === entry.pos &&
        known[knownIndex].kind === entry.kind
      ) {
        converged = knownIndex;
      }
    }
  };

  /**
   * A block break is planned before `index`. Walk backwards over
   * keep-with-next chains (h1+h2+paragraph …) and float anchors until the
   * break position is stable. Returns the resolved index.
   */
  const resolveBreakIndex = (index) => {
    let j = index;
    for (;;) {
      let moved = false;
      // Keep-with-next: a heading must not end a page.
      while (
        keepHeadingWithNext &&
        j > pageFirstIndex &&
        units[j - 1].keepWithNext
      ) {
        j -= 1;
        moved = true;
      }
      // Float invariant: no float from an earlier unit on this page may
      // reach below the planned break line.
      const breakY = units[j].top;
      for (let k = pageFirstIndex; k < j; k += 1) {
        const fb = units[k].floatBottom;
        if (fb !== null && fb !== undefined && fb > breakY + eps) {
          j = k;
          moved = true;
          break;
        }
      }
      if (!moved) return j;
    }
  };

  let i = 0;
  let guard = 0;
  const guardMax = units.length * 8 + 64; // hard stop against logic bugs

  while (i < units.length && converged === null) {
    guard += 1;
    if (guard > guardMax) {
      // Never trap the UI in a loop — bail out with what we have.
      console.error('[paginator] convergence guard tripped');
      break;
    }

    const unit = units[i];

    /* Forced break -------------------------------------------------------- */
    if (unit.type === 'pageBreak') {
      const next = units[i + 1] ?? null;
      pushBreak({
        pos: unit.end,
        kind: 'forced',
        fillPx: Math.max(0, pageEnd - unit.bottom),
        footTrimPx: unit.marginBottomPx,
        headTrimPx: next ? next.marginTopPx : 0,
        startY: next ? next.top : unit.bottom,
      });
      pageFirstIndex = i + 1;
      i += 1;
      continue;
    }

    /* Fits on the current page -------------------------------------------- */
    if (effectiveBottom(unit) <= pageEnd + eps) {
      i += 1;
      continue;
    }

    /* Line-wise split ------------------------------------------------------ */
    // A unit whose float would poke over the edge is never split — the
    // whole thing moves (invariant, see header).
    const floatBlocksSplit =
      unit.floatBottom !== null &&
      unit.floatBottom !== undefined &&
      unit.floatBottom > pageEnd + eps;

    if (unit.splittable && !floatBlocksSplit) {
      const lines = linesFor(i);
      const total = lines.length;
      let fit = 0;
      while (fit < total && lines[fit].bottom <= pageEnd + eps) fit += 1;

      if (fit >= total) {
        // Measurement noise — the block fits after all.
        i += 1;
        continue;
      }

      // Widow control: enough lines must travel to the next page.
      const remaining = total - fit;
      if (remaining < minWidowLines) fit -= minWidowLines - remaining;

      // Orphan control: enough lines must stay behind — otherwise the
      // whole block moves (falls through to the block break below).
      if (fit >= minOrphanLines) {
        const splitLine = lines[fit];
        pushBreak({
          pos: splitLine.pos,
          kind: 'split',
          fillPx: Math.max(0, pageEnd - lines[fit - 1].bottom),
          footTrimPx: 0,
          headTrimPx: 0,
          startY: splitLine.top,
        });
        // The same unit continues on the new page (it may split again).
        pageFirstIndex = i;
        continue;
      }
    }

    /* Block break ---------------------------------------------------------- */
    const target = resolveBreakIndex(i);

    if (units[target].top <= pageStartY + eps) {
      // The offender starts the page and still does not fit (block taller
      // than a page, or a keep chain longer than a page): stretch THIS page
      // so the sheet grows instead of the content overflowing it.
      if (stretchOversize) {
        pageEnd = Math.max(pageEnd, effectiveBottom(unit));
      }
      i += 1;
      continue;
    }

    const prev = units[target - 1];
    pushBreak({
      // Container-start rule: hoisted position, so the <li>/<blockquote> box
      // opens on the NEW page together with its marker/bar. Geometry keeps
      // using the unit's own rect — the container's border box starts at the
      // same line, only its margin-top differs (headTrim, sub-pixel).
      pos: units[target].breakPos ?? units[target].pos,
      kind: 'block',
      fillPx: Math.max(0, pageEnd - prev.bottom),
      footTrimPx: prev.marginBottomPx,
      headTrimPx: units[target].marginTopPx,
      startY: units[target].top,
    });
    pageFirstIndex = target;
    i = target;
  }

  const last = units[units.length - 1];
  return {
    pages: page,
    breaks,
    lastFillPx: Math.max(0, pageEnd - effectiveBottom(last)),
    converged,
  };
}
