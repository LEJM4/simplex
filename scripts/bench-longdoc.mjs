// scripts/bench-longdoc.mjs
// ---------------------------------------------------------------------------
// Micro-benchmark of the app's per-keystroke and per-save hot paths against
// the generated long document (phase 6c). Runs headless in Node (same V8 as
// Chrome), using the REAL app schema and the REAL search implementation:
//
//   - parseContainer            → opening a .sdoc (JSON.parse + validation)
//   - Node.fromJSON             → building the ProseMirror document
//   - characters()/words() path → what the status-bar count costs per update
//   - doc.toJSON()              → what every autosave snapshot costs
//   - findMatches()             → one full search pass (panel open + typing)
//
//   node scripts/bench-longdoc.mjs [file]        (default: beispiele/langtest.sdoc)
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Node as PmNode } from '@tiptap/pm/model';

import { parseContainer } from '../src/io/container.js';
import { findMatches } from '../src/core/search.js';
import { collectInspect } from '../src/core/inspect.js';
import { computeBreaks } from '../src/core/paginator.js';

const FILE = resolve(process.argv[2] ?? 'beispiele/langtest.sdoc');

/** Median of `runs` timed executions (ms, 2 warm-up runs discarded). */
function bench(label, runs, fn) {
  for (let i = 0; i < 2; i += 1) fn();
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`${label.padEnd(46)} ${median.toFixed(2).padStart(8)} ms`);
  return median;
}

const bytes = readFileSync(FILE);
console.log(`Datei: ${FILE} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)\n`);

/* Schema exactly as the app builds it, minus DOM-only extensions (image
   node views, search plugin) — the document contains none of their nodes. */
const schema = getSchema([
  StarterKit,
  TextStyle,
  FontFamily,
  FontSize,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
]);

let parsed = null;
bench('parseContainer (.sdoc öffnen)', 9, () => {
  parsed = parseContainer(bytes);
});

let doc = null;
bench('Node.fromJSON (Dokument aufbauen)', 9, () => {
  doc = PmNode.fromJSON(schema, parsed.content);
});

/* Status-bar count: mirrors @tiptap/extensions CharacterCount — a full
   textBetween pass for characters() plus a split for words(). */
let textCache = '';
bench('characters(): textBetween über alles', 15, () => {
  textCache = doc.textBetween(0, doc.content.size, ' ', ' ');
});
bench('words(): split + filter', 15, () => {
  textCache.split(' ').filter((word) => word !== '').length;
});

bench('doc.toJSON() (Autosave-Snapshot)', 9, () => {
  doc.toJSON();
});

bench('JSON.stringify(pretty) (Datei speichern)', 9, () => {
  JSON.stringify(parsed, null, 2);
});

let matches = [];
bench("findMatches('Dokument') — Suche, ganzer Text", 9, () => {
  matches = findMatches(doc, 'Dokument');
});

let inspected = [];
bench('collectInspect (Inspektionsmodus, ganzer Text)', 9, () => {
  inspected = collectInspect(doc);
});

/* Page view (phase 9): the RULE core over synthetic metrics at the real
   block count — DOM measuring is browser territory, this isolates what the
   computeBreaks loop itself costs per scheduler pass. Heights are estimated
   from text length (≈90 chars/line, 28 px lines, tables/images atomic). */
const pageUnits = [];
{
  let y = 0;
  let pos = 0;
  const push = (height, fields) => {
    pageUnits.push({
      pos, end: pos + 2, top: y, bottom: y + height,
      marginTopPx: 0, marginBottomPx: 0,
      keepWithNext: false, splittable: false, floatBottom: null, ...fields,
    });
    pos += 2;
    y += height;
  };
  const walkBench = (node) => {
    if (node.type === 'table') { push(200, { type: 'table' }); return; }
    if (node.type === 'image' || node.type === 'horizontalRule') {
      push(120, { type: 'atomic' }); return;
    }
    if (node.content && ['bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)) {
      node.content.forEach(walkBench); return;
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const chars = (node.content ?? []).reduce((sum, c) => sum + (c.text?.length ?? 0), 0);
      const lines = Math.max(1, Math.ceil(chars / 90));
      push(lines * 28, {
        type: 'text', splittable: true, keepWithNext: node.type === 'heading',
      });
    }
  };
  parsed.content.content.forEach(walkBench);
}
const pageOptions = {
  contentHeight: 952, // A4 with the default margins at 96 dpi
  minOrphanLines: 2, minWidowLines: 2,
  keepHeadingWithNext: true, epsilonPx: 0.5, stretchOversize: true,
};
const syntheticLines = (index) => {
  const u = pageUnits[index];
  const count = Math.max(1, Math.round((u.bottom - u.top) / 28));
  const h = (u.bottom - u.top) / count;
  return Array.from({ length: count }, (_, k) => ({
    top: u.top + k * h, bottom: u.top + (k + 1) * h, pos: u.pos,
  }));
};
let pagination = null;
bench('computeBreaks (Seitenansicht, voll)', 15, () => {
  pagination = computeBreaks(pageUnits, pageOptions, syntheticLines);
});
bench('computeBreaks (inkrementell, Tipp-Fall)', 15, () => {
  const known = pagination.breaks.map(({ pos, kind }) => ({ pos, kind }));
  computeBreaks(pageUnits, { ...pageOptions, knownBreaks: known }, syntheticLines);
});
console.log(`\nTreffer für "Dokument": ${matches.length}`);
console.log(`Seitenansicht (synthetisch): ${pagination.pages} Seiten, ${pagination.breaks.length} Umbrüche`);
console.log(`Inspektions-Blöcke: ${inspected.length}`);
console.log(`Wörter: ${textCache.split(' ').filter(Boolean).length.toLocaleString('de-DE')}`);
