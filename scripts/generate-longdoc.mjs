// scripts/generate-longdoc.mjs
// ---------------------------------------------------------------------------
// Generates a large, realistic .sdoc test document for performance testing
// (phase 6c): ~110 A4 pages of chapters, headings, formatted paragraphs,
// lists, blockquotes and tables. Deterministic (seeded RNG) so every run
// produces the identical file — benchmark results stay comparable.
//
//   node scripts/generate-longdoc.mjs [outfile]     (default: beispiele/langtest.sdoc)
//
// The content only uses node/mark types from the app schema (StarterKit,
// TextAlign, Highlight, TextStyle, Table) — no images, so the file stays a
// pure text-layout stress test and benchmarks need no custom extensions.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'beispiele/langtest.sdoc');

/* Deterministic RNG (mulberry32) — same seed, same document. */
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20260728);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));

/* German-ish filler vocabulary (plain words — spellcheck noise is fine). */
const WORDS = (
  'der die das ein eine und oder aber doch wenn dann also dabei dazu damit ' +
  'Dokument Absatz Zeile Seite Entwurf Fassung Bericht Kapitel Abschnitt ' +
  'Gliederung Inhalt Struktur Beispiel Hinweis Ergebnis Verfahren Prüfung ' +
  'schreiben lesen ändern speichern drucken formatieren markieren einfügen ' +
  'schnell einfach deutlich vollständig zuverlässig lokal offen klar knapp ' +
  'Text Wort Zeichen Tabelle Liste Bild Rand Vorlage Entwurfsstand Anmerkung ' +
  'zeigt bleibt wirkt entsteht beschreibt umfasst enthält verweist ergibt'
).split(' ');

const text = (value, marks = null) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };

/** A sentence of `count` words; the odd word carries a mark. */
function sentence(count) {
  const nodes = [];
  let plain = '';
  for (let i = 0; i < count; i += 1) {
    let word = pick(WORDS);
    if (i === 0) word = word[0].toUpperCase() + word.slice(1);
    const roll = random();
    if (roll < 0.02) {
      if (plain) { nodes.push(text(plain)); plain = ''; }
      nodes.push(text(word, [{ type: 'bold' }]));
    } else if (roll < 0.04) {
      if (plain) { nodes.push(text(plain)); plain = ''; }
      nodes.push(text(word, [{ type: 'italic' }]));
    } else if (roll < 0.05) {
      if (plain) { nodes.push(text(plain)); plain = ''; }
      nodes.push(text(word, [{ type: 'highlight', attrs: { color: '#f9e37b' } }]));
    } else {
      plain += word;
    }
    plain += i === count - 1 ? '. ' : ' ';
  }
  if (plain) nodes.push(text(plain));
  return nodes;
}

function paragraph(sentences, attrs = null) {
  const content = [];
  for (let i = 0; i < sentences; i += 1) content.push(...sentence(between(9, 18)));
  const node = { type: 'paragraph', content };
  if (attrs) node.attrs = attrs;
  return node;
}

const heading = (level, words) => ({
  type: 'heading',
  attrs: { level },
  content: [text(sentence(words).map((n) => n.text).join('').replace(/\. $/, ''))],
});

const bulletList = (items) => ({
  type: 'bulletList',
  content: Array.from({ length: items }, () => ({
    type: 'listItem',
    content: [paragraph(1)],
  })),
});

const blockquote = () => ({ type: 'blockquote', content: [paragraph(2)] });

function table(rows, cols) {
  const cell = (type) => ({
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [{ type: 'paragraph', content: sentence(between(2, 5)) }],
  });
  const row = (type) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, () => cell(type)),
  });
  return {
    type: 'table',
    content: [row('tableHeader'), ...Array.from({ length: rows - 1 }, () => row('tableCell'))],
  };
}

/* Document: chapters → sections → paragraphs with sprinkled structure.
   30 × 5 sections ≈ 110–120 A4 pages at our defaults (verified via stats). */
const content = { type: 'doc', content: [] };
for (let chapter = 1; chapter <= 30; chapter += 1) {
  content.content.push(heading(1, 4), paragraph(3));
  for (let section = 1; section <= 5; section += 1) {
    content.content.push(heading(2, 5));
    const blocks = between(5, 7);
    for (let block = 0; block < blocks; block += 1) {
      const roll = random();
      if (roll < 0.1) content.content.push(bulletList(between(3, 6)));
      else if (roll < 0.16) content.content.push(blockquote());
      else if (roll < 0.2) content.content.push(heading(3, 4), paragraph(2));
      else if (roll < 0.24) content.content.push(paragraph(between(2, 4), { textAlign: 'justify' }));
      else content.content.push(paragraph(between(2, 4)));
    }
    if (random() < 0.3) content.content.push(table(between(4, 7), between(3, 5)));
  }
}

/* Wrap in the .sdoc envelope (mirrors io/container.js, formatVersion 1). */
const documentJson = {
  formatVersion: 1,
  meta: {
    app: 'Simplex',
    appVersion: 'longdoc-generator',
    savedAt: new Date(0).toISOString(), // fixed → file is byte-identical per run
    title: 'Langtest',
  },
  settings: {},
  content,
};

/* Stats */
let words = 0;
let characters = 0;
let nodes = 0;
const walk = (node) => {
  nodes += 1;
  if (node.type === 'text') {
    characters += node.text.length;
    words += node.text.split(/\s+/).filter(Boolean).length;
  }
  node.content?.forEach(walk);
};
walk(content);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(documentJson, null, 2));

const CHARS_PER_A4 = 2600; // ~12 pt Georgia, 1.5 line height, our margins (measured)
console.log(`geschrieben: ${OUT}`);
console.log(
  `~${Math.round(characters / CHARS_PER_A4)} A4-Seiten · ${words.toLocaleString('de-DE')} Wörter · ` +
  `${characters.toLocaleString('de-DE')} Zeichen · ${nodes.toLocaleString('de-DE')} Knoten`
);
