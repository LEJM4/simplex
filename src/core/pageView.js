// src/core/pageView.js
// ---------------------------------------------------------------------------
// Page view in the editor (phase 9). The document stays ONE continuous
// ProseMirror flow; the page gaps are widget DECORATIONS: non-editable
// in-flow spacers that draw [white filler → bottom margin strip → grey
// workbench gap → top margin strip] at every computed break. Decorations
// never serialize — .sdoc, DOCX, autosave and print (getHTML) see the plain
// document (same guarantee as the inspection mode).
//
// Division of labour:
//   core/paginator.js   pure Word rule core (computeBreaks) — headless-tested
//   this file           DOM measuring, scheduling, decorations, overlays
//
// Measuring discipline (review findings baked in):
//   - CSS `zoom` scales viewport rects; the mm→px target geometry does not.
//     Every measured value is divided by the current zoom factor first.
//   - Spacers sit inside the measured DOM. All Y values are converted into
//     "content space" by subtracting the accumulated spacer heights above
//     them — the computation therefore never feeds on its own output and
//     stays a fixed point (verified by a cheap re-measure pass).
//   - Bleed margins of a spacer are NOT constant (lists/quotes indent): the
//     left/right context edges are measured per break and written as inline
//     styles onto the spacer.
//   - Word's boundary margin rules fall out of the math: rects exclude
//     margins ("space after" is swallowed), and the measured margin-top of
//     the first block on a page is trimmed from the spacer's head strip
//     ("space before" is suppressed at a page start).
//
// Scheduling: one requestAnimationFrame after a document change, measuring
// only from the last break BEFORE the change and stopping as soon as the
// computed breaks re-join the previous ones (knownBreaks convergence in
// computeBreaks). Selection-only transactions cost nothing; pageless mode
// costs exactly zero. A single verify pass after every apply guards the
// fixed-point assumption (capped by settings.pageView.maxSchedulerPasses).
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { computeBreaks } from './paginator.js';
import { settings, defaultDocumentSettings } from '../config/settings.js';
import { appState } from './appState.js';
import { formatPageNumber, pageChrome, pageNumberTemplate, pageSizeMm } from './docSettings.js';

export const pageViewKey = new PluginKey('sw-page-view');

/** CSS reference pixels per millimetre (CSS: 1in = 96px, exact). */
const PX_PER_MM = 96 / 25.4;
const mmToPx = (mm) => mm * PX_PER_MM;

const CONTAINER_TYPES = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote']);
const ATOMIC_TYPES = new Set(['image', 'horizontalRule']);

/* Formatting for the on-sheet header/footer strips — mirrors the print
   pipeline (settings.print) so the editor shows what the PDF will show. */
const stripFont = () =>
  `font-family: var(--font-ui); font-size: ${settings.print.headerFooterFontSizePt}pt; ` +
  `color: ${settings.print.headerFooterColor};`;

/** Footer strip content: three zones (left | center | right). The footer
    text sits left, the page number in its configured zone — both share the
    left zone gracefully when they collide (flex gap on the zone). */
function renderFootStrip(strip, docSettings, page, pages) {
  strip.replaceChildren();
  const zones = {};
  for (const side of ['left', 'center', 'right']) {
    const zone = document.createElement('span');
    zone.className = `sw-page-foot-zone sw-page-foot-zone--${side}`;
    zones[side] = zone;
    strip.append(zone);
  }
  // Feature 9: page 1 may carry its own footer text and no number — the
  // rule lives in pageChrome() (shared with print CSS and DOCX parts).
  const chrome = pageChrome(docSettings, page);
  if (chrome.footerText) {
    const text = document.createElement('span');
    text.textContent = chrome.footerText;
    zones.left.append(text);
  }
  const numberText = chrome.numberedPage ? formatPageNumber(docSettings, page, pages) : '';
  if (numberText) {
    const number = document.createElement('span');
    number.textContent = numberText;
    zones[docSettings?.pageNumberPosition ?? 'center'].append(number);
  }
}

/** Chrome revision: folded into every widget key so a change of header/
    footer text, page-number format/position or UI language replaces the
    spacer DOM (ProseMirror treats widgets with equal keys as unchanged). */
function chromeRevision(docSettings) {
  const source = [
    docSettings?.headerText ?? '',
    docSettings?.footerText ?? '',
    // Feature 9: toggling the flag or editing the page-1 texts must replace
    // the first spacer (its foot belongs to page 1) and the overlays.
    docSettings?.firstPageDifferent === true ? '1' : '',
    docSettings?.firstHeaderText ?? '',
    docSettings?.firstFooterText ?? '',
    docSettings?.pageNumberPosition ?? '',
    pageNumberTemplate(docSettings), // resolves per language + format
  ].join('\u0001');
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/* Spacer DOM -----------------------------------------------------------------
   Built from PRE-MEASURED values stored on the break entry — toDOM must not
   touch layout. Structure: [fill][foot][gap][head], full-bleed via inline
   negative margins. pointer-events/user-select live in editor.css. */

function buildSpacerDom(entry, pages, docSettings) {
  const spacer = document.createElement('div');
  spacer.className = 'sw-page-spacer';
  spacer.contentEditable = 'false';
  spacer.style.marginLeft = `${-entry.outLeftPx}px`;
  spacer.style.marginRight = `${-entry.outRightPx}px`;

  // Word rule: neighbour margins are swallowed at the boundary — the strips
  // shrink by the already-present physical margins (trims), never below 0.
  const aboveGap = Math.max(0, entry.fillPx + entry.footHeightPx - entry.footTrimPx);
  const footH = Math.min(entry.footHeightPx, aboveGap);
  const fillH = aboveGap - footH;
  const headH = Math.max(0, entry.headHeightPx - entry.headTrimPx);

  const fill = document.createElement('div');
  fill.className = 'sw-page-spacer-fill';
  fill.style.height = `${fillH}px`;

  const foot = document.createElement('div');
  foot.className = 'sw-page-spacer-foot';
  foot.style.height = `${footH}px`;
  foot.style.cssText += stripFont();
  renderFootStrip(foot, docSettings, entry.page, pages);

  const gap = document.createElement('div');
  gap.className = 'sw-page-spacer-gap';
  gap.style.height = `${settings.pageView.gapPx}px`;

  const head = document.createElement('div');
  head.className = 'sw-page-spacer-head';
  head.style.height = `${headH}px`;
  head.style.cssText += stripFont();
  const headCenter = document.createElement('span');
  // The spacer head opens the FOLLOWING page (2, 3, …) — routed through
  // pageChrome anyway so the per-page rule lives in one place.
  headCenter.textContent = pageChrome(docSettings, entry.page + 1).headerText;
  head.append(headCenter);

  spacer.append(fill, foot, gap, head);
  return spacer;
}

function buildDecorations(doc, breaks, lastFillPx, pages, docSettings) {
  const chromeRev = chromeRevision(docSettings);
  const decorations = breaks.map((entry) =>
    Decoration.widget(entry.pos, () => buildSpacerDom(entry, pages, docSettings), {
      side: -1,
      ignoreSelection: true,
      key:
        `sw-sp|${entry.pos}|${entry.kind}|${entry.page}/${pages}` +
        `|${Math.round(entry.fillPx)}|${Math.round(entry.outLeftPx)}` +
        `|${Math.round(entry.headTrimPx)}|${Math.round(entry.footTrimPx)}` +
        `|${chromeRev}`,
    })
  );
  // End filler: stretches the last sheet to full page height. The page
  // margins themselves are the #page paddings, so only the white rest of
  // the content area is needed here.
  const endFill = document.createElement('div');
  endFill.className = 'sw-page-endfill';
  endFill.style.height = `${Math.max(0, lastFillPx)}px`;
  decorations.push(
    Decoration.widget(doc.content.size, () => endFill.cloneNode(false), {
      side: 1,
      ignoreSelection: true,
      key: `sw-endfill|${Math.round(lastFillPx)}|${pages}`,
    })
  );
  return DecorationSet.create(doc, decorations);
}

/* Plugin state ---------------------------------------------------------------
   { active, breaks, pages, lastFillPx, decorations, pendingFrom }
   pendingFrom: smallest changed document position since the last apply
   (null = clean). The view part consumes it in the next animation frame. */

const emptyState = () => ({
  active: false,
  breaks: [],
  pages: 1,
  lastFillPx: 0,
  decorations: DecorationSet.empty,
  pendingFrom: null,
});

function applyState(tr, previous) {
  const meta = tr.getMeta(pageViewKey);

  if (meta?.type === 'set') {
    if (!meta.active) return emptyState();
    return { ...emptyState(), active: true, pendingFrom: 0 };
  }

  if (!previous.active) return previous;

  if (meta?.type === 'refresh') {
    return { ...previous, pendingFrom: 0 };
  }

  if (meta?.type === 'apply') {
    return {
      ...previous,
      breaks: meta.breaks,
      pages: meta.pages,
      lastFillPx: meta.lastFillPx,
      decorations: buildDecorations(
        tr.doc,
        meta.breaks,
        meta.lastFillPx,
        meta.pages,
        appState.get('docSettings')
      ),
      pendingFrom: null,
    };
  }

  if (!tr.docChanged) return previous;

  // Map everything through the change so the existing optics stay put until
  // the scheduler replaces them; remember the smallest changed position.
  let changedFrom = Infinity;
  for (const step of tr.steps) {
    step.getMap().forEach((oldStart, oldEnd, newStart) => {
      changedFrom = Math.min(changedFrom, newStart);
    });
  }
  const breaks = previous.breaks.map((entry) => ({
    ...entry,
    pos: tr.mapping.map(entry.pos, entry.kind === 'split' ? -1 : -1),
  }));
  const pendingFrom = Math.min(
    previous.pendingFrom === null ? Infinity : tr.mapping.map(previous.pendingFrom),
    changedFrom
  );
  return {
    ...previous,
    breaks,
    decorations: previous.decorations.map(tr.mapping, tr.doc),
    pendingFrom: pendingFrom === Infinity ? 0 : pendingFrom,
  };
}

/* Measuring view -------------------------------------------------------------
   Owns the animation-frame scheduler, the DOM measurer and the two sheet
   overlays (first-page header, last-page footer + page number). */

class PageViewController {
  constructor(view) {
    this.view = view;
    this.raf = null;
    this.verifyFrom = null;
    this.passCount = 0;
    this.overlays = null;
    this.offLanguage = appState.on('language:changed', () => this.updateOverlayTexts());
    this.sync();
  }

  update() {
    this.sync();
  }

  sync() {
    const state = pageViewKey.getState(this.view.state);
    if (!state.active) {
      this.removeOverlays();
      this.cancel();
      return;
    }
    this.ensureOverlays();
    this.updateOverlayTexts();
    if (state.pendingFrom !== null || this.verifyFrom !== null) this.schedule();
  }

  schedule() {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.run();
    });
  }

  cancel() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.verifyFrom = null;
    this.passCount = 0;
  }

  destroy() {
    this.cancel();
    this.removeOverlays();
    this.offLanguage();
  }

  /* Overlays -------------------------------------------------------------- */

  pageElement() {
    return this.view.dom.closest('.page');
  }

  ensureOverlays() {
    if (this.overlays) return;
    const page = this.pageElement();
    if (!page) return;
    const head = document.createElement('div');
    head.className = 'sw-page-first-head';
    head.style.cssText += stripFont();
    const headText = document.createElement('span');
    head.append(headText);
    const foot = document.createElement('div');
    foot.className = 'sw-page-last-foot';
    foot.style.cssText += stripFont();
    page.append(head, foot);
    this.overlays = { head, headText, foot };
  }

  removeOverlays() {
    if (!this.overlays) return;
    this.overlays.head.remove();
    this.overlays.foot.remove();
    this.overlays = null;
  }

  updateOverlayTexts() {
    if (!this.overlays) return;
    const state = pageViewKey.getState(this.view.state);
    const docSettings = appState.get('docSettings');
    this.overlays.headText.textContent = pageChrome(docSettings, 1).headerText;
    renderFootStrip(this.overlays.foot, docSettings, state.pages, state.pages);
  }

  /* Measuring + scheduling -------------------------------------------------- */

  run() {
    const { view } = this;
    const state = pageViewKey.getState(view.state);
    if (!state.active) return;

    // Dead keys / IME composition: measuring mid-composition is pointless
    // and risky — every composition step dispatches a transaction, so the
    // next update() re-schedules automatically.
    if (view.composing) {
      this.schedule();
      return;
    }

    const from = state.pendingFrom ?? this.verifyFrom;
    this.verifyFrom = null;
    if (from === null) return;

    let result;
    try {
      result = this.measure(state, from);
    } catch (error) {
      console.error('[pageview] measuring failed', error);
      return;
    }
    if (!result) return;

    if (this.breaksEqual(state, result)) {
      this.passCount = 0; // fixed point reached — silence
      return;
    }

    if (this.passCount >= settings.pageView.maxSchedulerPasses) {
      console.warn('[pageview] convergence cap reached — keeping last result');
      this.passCount = 0;
      return;
    }
    this.passCount += 1;
    this.verifyFrom = from; // one guard pass re-checks the changed region

    view.dispatch(
      view.state.tr.setMeta(pageViewKey, {
        type: 'apply',
        breaks: result.breaks,
        pages: result.pages,
        lastFillPx: result.lastFillPx,
      })
    );
  }

  breaksEqual(state, result) {
    if (
      state.pendingFrom !== null || // a real change always needs an apply
      state.breaks.length !== result.breaks.length ||
      state.pages !== result.pages ||
      Math.abs(state.lastFillPx - result.lastFillPx) > 1
    ) {
      return false;
    }
    for (let i = 0; i < result.breaks.length; i += 1) {
      const a = state.breaks[i];
      const b = result.breaks[i];
      if (a.pos !== b.pos || a.kind !== b.kind || Math.abs(a.fillPx - b.fillPx) > 1) {
        return false;
      }
    }
    return true;
  }

  /**
   * Measure the document and compute the breaks, starting from the last
   * still-valid break before `from` and converging into the previous break
   * list as early as possible.
   */
  measure(state, from) {
    const { view } = this;
    const doc = view.state.doc;
    const zoom = (appState.get('zoom') ?? settings.view.zoomDefault) / 100;
    const docSettings = appState.get('docSettings') ?? defaultDocumentSettings();
    const margins = docSettings.pageMarginsMm;
    // Effective height follows the document's format + orientation (0.27.0).
    const contentHeight = mmToPx(
      pageSizeMm(docSettings).heightMm - margins.top - margins.bottom
    );

    const pageEl = this.pageElement();
    if (!pageEl) return null;
    const pageRect = pageEl.getBoundingClientRect();
    const baseRect = view.dom.getBoundingClientRect();
    const norm = (value) => (value - baseRect.top) / zoom;
    const normX = (value) => value / zoom;

    // Content space: subtract every spacer above a given normalised Y.
    const spacerBands = [...view.dom.querySelectorAll('.sw-page-spacer, .sw-page-endfill')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: norm(r.top), height: (r.bottom - r.top) / zoom };
      })
      .sort((a, b) => a.top - b.top);
    const toContentY = (normalizedY) => {
      let sum = 0;
      for (const band of spacerBands) {
        if (band.top < normalizedY - 0.01) sum += band.height;
        else break;
      }
      return normalizedY - sum;
    };

    /* Flow units with LAZY rect/style measuring: computeBreaks only pulls
       what it needs, so an early convergence never measures the whole
       document. */
    const units = [];
    const makeUnit = (node, pos, extra) => {
      let rect = null;
      let style = null;
      let dom = null;
      const domOf = () => {
        if (dom === null) dom = view.nodeDOM(pos);
        return dom;
      };
      const rectOf = () => {
        if (!rect) {
          const el = domOf();
          if (el?.getBoundingClientRect) {
            const r = el.getBoundingClientRect();
            rect = { top: toContentY(norm(r.top)), bottom: toContentY(norm(r.bottom)) };
          } else {
            rect = { top: 0, bottom: 0 }; // degrade harmlessly, never crash
          }
        }
        return rect;
      };
      const styleOf = () => {
        if (!style) {
          const el = domOf();
          style = el instanceof Element ? getComputedStyle(el) : null;
        }
        return style;
      };
      return {
        pos,
        end: pos + node.nodeSize,
        node,
        domOf,
        get top() {
          return rectOf().top;
        },
        get bottom() {
          return rectOf().bottom;
        },
        get marginTopPx() {
          return Number.parseFloat(styleOf()?.marginTop) || 0;
        },
        get marginBottomPx() {
          return Number.parseFloat(styleOf()?.marginBottom) || 0;
        },
        get floatBottom() {
          if (!extra.floating) return null;
          return rectOf().bottom;
        },
        ...extra.fields,
      };
    };

    const walk = (node, pos) => {
      const name = node.type.name;
      if (name === 'pageBreak') {
        units.push(makeUnit(node, pos, {
          fields: { type: 'pageBreak', keepWithNext: false, splittable: false },
        }));
        return;
      }
      if (name === 'table') {
        units.push(makeUnit(node, pos, {
          fields: { type: 'table', keepWithNext: false, splittable: false },
        }));
        return;
      }
      if (ATOMIC_TYPES.has(name)) {
        const floating = name === 'image' && node.attrs?.float && node.attrs.float !== 'none';
        units.push(makeUnit(node, pos, {
          floating,
          fields: { type: 'atomic', keepWithNext: false, splittable: false },
        }));
        return;
      }
      if (node.isTextblock) {
        units.push(makeUnit(node, pos, {
          fields: {
            type: 'text',
            keepWithNext:
              name === 'heading' && settings.pageView.keepHeadingWithNext,
            splittable: true,
          },
        }));
        return;
      }
      if (CONTAINER_TYPES.has(name)) {
        node.forEach((child, offset) => walk(child, pos + 1 + offset));
        return;
      }
      // Unknown block: treat as atomic — safe default.
      units.push(makeUnit(node, pos, {
        fields: { type: 'atomic', keepWithNext: false, splittable: false },
      }));
    };
    doc.forEach((child, offset) => walk(child, offset));

    /* Line boxes of a splittable unit: ONE Range per unit — its client
       rects come one per rendered line fragment; merging overlapping
       vertical bands yields the visual lines. posAtCoords (one call per
       line) resolves each line start to a document position. */
    const linesFor = (unit) => {
      const el = unit.domOf();
      if (!(el instanceof Element)) {
        return [{ top: unit.top, bottom: unit.bottom, pos: unit.pos + 1 }];
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()]
        .filter((r) => r.height > 0 && r.width >= 0)
        .sort((a, b) => a.top - b.top);
      if (rects.length === 0) {
        return [{ top: unit.top, bottom: unit.bottom, pos: unit.pos + 1 }];
      }
      const bands = [];
      for (const r of rects) {
        const last = bands[bands.length - 1];
        if (last && r.top < last.bottomV - 1) {
          last.bottomV = Math.max(last.bottomV, r.bottom);
          last.leftV = Math.min(last.leftV, r.left);
        } else {
          bands.push({ topV: r.top, bottomV: r.bottom, leftV: r.left });
        }
      }
      let lastPos = unit.pos;
      return bands.map((band) => {
        const found = view.posAtCoords({
          left: band.leftV + 1,
          top: (band.topV + band.bottomV) / 2,
        });
        let pos = found ? found.pos : lastPos + 1;
        pos = Math.max(unit.pos + 1, Math.min(pos, unit.end - 1));
        if (pos <= lastPos) pos = Math.min(lastPos + 1, unit.end - 1);
        lastPos = pos;
        return {
          top: toContentY(norm(band.topV)),
          bottom: toContentY(norm(band.bottomV)),
          pos,
        };
      });
    };

    /* Incremental window: keep every break strictly before the change,
       recompute from there, converge into the mapped old list. */
    const oldBreaks = state.breaks;
    let anchorIdx = -1;
    for (let i = 0; i < oldBreaks.length; i += 1) {
      if (oldBreaks[i].pos < from) anchorIdx = i;
      else break;
    }
    const anchorPos = anchorIdx >= 0 ? oldBreaks[anchorIdx].pos : 0;
    let startUnit = 0;
    while (startUnit < units.length && units[startUnit].pos < anchorPos) startUnit += 1;
    const slice = units.slice(startUnit);
    const known = oldBreaks
      .slice(anchorIdx + 1)
      .map((entry) => ({ pos: entry.pos, kind: entry.kind }));

    const options = {
      contentHeight,
      minOrphanLines: settings.pageView.minOrphanLines,
      minWidowLines: settings.pageView.minWidowLines,
      keepHeadingWithNext: settings.pageView.keepHeadingWithNext,
      epsilonPx: settings.pageView.epsilonPx,
      stretchOversize: settings.pageView.stretchOversize,
      knownBreaks: known,
    };
    const computed = computeBreaks(slice, options, (index) => linesFor(slice[index]));

    /* Sheet chrome measurements for the NEW breaks only (old ones keep
       their stored values — layout above/below merely shifted). */
    const footHeightPx = mmToPx(margins.bottom);
    const headHeightPx = mmToPx(margins.top);
    const chromeFor = (entry) => {
      // Bleed context: the first block of the NEW page (block/forced), or
      // the split paragraph itself (its box edges include list/quote
      // indents, which is exactly what the spacer must align to).
      let ctx = null;
      try {
        if (entry.kind === 'split') {
          const $pos = doc.resolve(entry.pos);
          ctx = view.nodeDOM($pos.before($pos.depth));
        } else {
          ctx = view.nodeDOM(entry.pos);
        }
      } catch {
        ctx = null;
      }
      const rect =
        ctx instanceof Element ? ctx.getBoundingClientRect() : baseRect;
      return {
        outLeftPx: Math.max(0, normX(rect.left - pageRect.left)),
        outRightPx: Math.max(0, normX(pageRect.right - rect.right)),
        footHeightPx,
        headHeightPx,
      };
    };

    const fresh = computed.breaks.map((entry) => ({ ...entry, ...chromeFor(entry) }));
    let breaks;
    let pages;
    let lastFillPx;
    if (computed.converged !== null && computed.converged !== undefined) {
      const rest = oldBreaks.slice(anchorIdx + 1 + computed.converged + 1);
      breaks = [...oldBreaks.slice(0, anchorIdx + 1), ...fresh, ...rest];
      lastFillPx = rest.length > 0 || anchorIdx >= 0 ? state.lastFillPx : computed.lastFillPx;
      if (rest.length === 0) lastFillPx = computed.lastFillPx;
    } else {
      breaks = [...oldBreaks.slice(0, anchorIdx + 1), ...fresh];
      lastFillPx = computed.lastFillPx;
    }
    breaks.forEach((entry, index) => {
      entry.page = index + 1;
    });
    pages = breaks.length + 1;

    return { breaks, pages, lastFillPx };
  }
}

/* Extension ------------------------------------------------------------------ */

export const PageView = Extension.create({
  name: 'swPageView',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pageViewKey,
        state: {
          init: emptyState,
          apply: applyState,
        },
        props: {
          decorations(state) {
            return pageViewKey.getState(state).decorations;
          },
        },
        view: (editorView) => new PageViewController(editorView),
      }),
    ];
  },

  addCommands() {
    return {
      /** Switch the page view on or off (app-level state, wired in main.js). */
      setPageView:
        (active) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(pageViewKey, { type: 'set', active }));
          return true;
        },

      /** Full repagination (page setup, zoom or language changed). */
      refreshPageView:
        () =>
        ({ state, tr, dispatch }) => {
          if (!pageViewKey.getState(state).active) return false;
          if (dispatch) dispatch(tr.setMeta(pageViewKey, { type: 'refresh' }));
          return true;
        },
    };
  },
});
