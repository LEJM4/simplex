// src/io/docxExport.js
// ---------------------------------------------------------------------------
// DOCX export via the `docx` library (loaded on demand — it only costs bundle
// size once the user actually exports).
//
// Mapping (Tiptap JSON → Word):
//   paragraph/heading  → Paragraph (headings use custom Heading1–3 styles that
//                        mirror the editor sizes from editor.css)
//   bullet/orderedList → numbering (nested levels; each top-level ordered
//                        list gets its own instance so numbering restarts)
//   marks              → bold/italics/underline/strike, color, font (first
//                        family of the CSS stack), size; highlight becomes
//                        character shading (Word's highlighter only knows a
//                        fixed color list, shading keeps our exact hex)
//   textAlign          → alignment incl. justified
//   link               → ExternalHyperlink with Word's "Hyperlink" style
//   lineHeight         → spacing.line (240ths, rule auto)
//   spaceAfter         → spacing.after (20ths of a point)
//   indent (level)     → indent.left (level × settings indentStepMm as
//                        twips); inside quotes on top of the quote indent,
//                        inside lists on top of the level indent (with the
//                        hanging kept so the marker geometry survives)
//   docSettings        → page size/margins, header text, footer text and
//                        localized page numbers ("Seite N von M")
// Images follow in phase 5. Honest limit: Word documents re-imported here
// keep structure and text, not every visual detail.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { pageChrome, pageFormatOf, pageNumberTemplate, pageSizeMm } from '../core/docSettings.js';
import { t } from '../i18n/index.js';
import { showDialog } from '../ui/dialogs/dialog.js';
import { supportsFileSystemAccess, stripDocExtension } from './fileSystem.js';
import { isTauri, pickSavePath, writeFileBytes } from './tauriFs.js';

const mmToTwip = (mm) => Math.round((mm * 1440) / 25.4);
const ptToHalfPoints = (pt) => Math.round(pt * 2);
const ptToTwentieths = (pt) => Math.round(pt * 20);
const firstFontName = (stack) =>
  String(stack).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
/** data:image/…;base64,… → { type (docx image type), data (bytes) } | null */
function parseDataUrl(src) {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(String(src ?? ''));
  if (!match) return null;
  const type = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const binary = atob(match[2]);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
  return { type, data };
}

/** Natural pixel sizes for every image in the document (browser only). */
export async function measureImages(contentJson) {
  if (typeof Image === 'undefined') return {};
  const sources = new Set();
  const walk = (node) => {
    if (node.type === 'image' && node.attrs?.src) sources.add(node.attrs.src);
    for (const child of node.content ?? []) walk(child);
  };
  walk(contentJson);
  const entries = await Promise.all(
    [...sources].map(
      (src) =>
        new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () =>
            resolve([src, { width: probe.naturalWidth, height: probe.naturalHeight }]);
          probe.onerror = () => resolve(null);
          probe.src = src;
        })
    )
  );
  return Object.fromEntries(entries.filter(Boolean));
}

const hexColor = (css) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(css ?? '').trim());
  return match ? match[1].toUpperCase() : undefined;
};

/** Build the docx Document (exported separately for tests). */
export function buildDocxDocument(docx, contentJson, docSettings, imageSizes = {}) {
  const {
    Document, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, LevelFormat,
    PageNumber, PageBreak, PageOrientation, Header, Footer, Tab, TabStopType, LineRuleType, ShadingType,
    Table, TableRow, TableCell, WidthType, BorderStyle, ExternalHyperlink,
  } = docx;

  const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  };
  const editorCfg = settings.editor;
  const hfSize = ptToHalfPoints(settings.print.headerFooterFontSizePt);
  const hfColor = hexColor(settings.print.headerFooterColor) ?? '555555';

  /* Inline content → TextRuns */
  const runsFromInline = (node, runExtras = {}) => {
    const runs = [];
    for (const child of node.content ?? []) {
      if (child.type === 'hardBreak') {
        runs.push(new TextRun({ break: 1 }));
        continue;
      }
      if (child.type !== 'text') continue;
      const options = { text: child.text, ...runExtras };
      let linkHref = null;
      for (const mark of child.marks ?? []) {
        if (mark.type === 'bold') options.bold = true;
        else if (mark.type === 'italic') options.italics = true;
        else if (mark.type === 'underline') options.underline = {};
        else if (mark.type === 'strike') options.strike = true;
        else if (mark.type === 'link') linkHref = mark.attrs?.href ?? null;
        else if (mark.type === 'subscript') options.subScript = true;
        else if (mark.type === 'superscript') options.superScript = true;
        else if (mark.type === 'textStyle') {
          const { color, fontFamily, fontSize } = mark.attrs ?? {};
          const hex = hexColor(color);
          if (hex) options.color = hex;
          if (fontFamily) options.font = firstFontName(fontFamily);
          const pt = Number.parseFloat(fontSize);
          if (Number.isFinite(pt)) options.size = ptToHalfPoints(pt);
        } else if (mark.type === 'highlight') {
          options.shading = {
            type: ShadingType.CLEAR,
            fill: hexColor(mark.attrs?.color) ?? 'F9E37B',
          };
        }
      }
      if (linkHref) {
        // Word's built-in "Hyperlink" character style (the docx defaults ship
        // it) — explicit marks in `options` still win over the style.
        runs.push(
          new ExternalHyperlink({
            link: linkHref,
            children: [new TextRun({ style: 'Hyperlink', ...options })],
          })
        );
      } else {
        runs.push(new TextRun(options));
      }
    }
    return runs;
  };

  /* Paragraph indent (feature 2): the block attribute is an integer level;
     one level equals settings.editor.indentStepMm (see core/indent.js). */
  const indentStepTwips = mmToTwip(settings.editor.indentStepMm);
  const indentTwips = (attrs = {}) => {
    const level = Number.parseInt(attrs?.indent, 10);
    return Number.isFinite(level) && level > 0 ? level * indentStepTwips : 0;
  };

  const paragraphSpacing = (attrs = {}) => {
    const spacing = {};
    const lineHeight = Number.parseFloat(attrs?.lineHeight);
    if (Number.isFinite(lineHeight)) {
      spacing.line = Math.round(lineHeight * 240);
      spacing.lineRule = LineRuleType.AUTO;
    }
    const after = Number.parseFloat(attrs?.spaceAfter);
    if (Number.isFinite(after)) spacing.after = ptToTwentieths(after);
    return Object.keys(spacing).length ? spacing : undefined;
  };

  const paragraphFromNode = (node, extras = {}) => {
    // Call sites that pass extras.indent (quote, list) have already folded
    // the node's own level in — plain paragraphs/headings map it here.
    const own = indentTwips(node.attrs);
    return new Paragraph({
      children: runsFromInline(node, extras.run),
      alignment: ALIGN[node.attrs?.textAlign],
      spacing: paragraphSpacing(node.attrs),
      heading: extras.heading,
      bullet: extras.bullet,
      numbering: extras.numbering,
      indent: extras.indent ?? (own > 0 ? { left: own } : undefined),
      thematicBreak: extras.thematicBreak,
    });
  };

  /* Block walk — generic: cells and quotes contain blocks themselves, so
     every branch writes into a passed-in sink array. */
  let orderedInstance = 0;

  const walkList = (listNode, depth, orderedContext, sink) => {
    for (const item of listNode.content ?? []) {
      for (const block of item.content ?? []) {
        if (block.type === 'paragraph') {
          const extras = orderedContext
            ? { numbering: { reference: 'sw-ordered', level: depth, instance: orderedContext.instance } }
            : { bullet: { level: depth } };
          // An extra paragraph indent inside a list: direct formatting would
          // OVERRIDE the level's style indent, so re-state the level base
          // (720/level, hanging 360 — mirrors the numbering config) plus the
          // node's own offset. Only when actually set: the style stays the
          // single source of truth for plain list paragraphs.
          const own = indentTwips(block.attrs);
          if (own > 0) extras.indent = { left: 720 * (depth + 1) + own, hanging: 360 };
          sink.push(paragraphFromNode(block, extras));
        } else if (block.type === 'bulletList') {
          walkList(block, depth + 1, null, sink);
        } else if (block.type === 'orderedList') {
          walkList(block, depth + 1, orderedContext ?? { instance: ++orderedInstance }, sink);
        }
      }
    }
  };

  const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: 'B8B5AC' };

  const buildTable = (tableNode) => {
    const rows = (tableNode.content ?? []).map(
      (rowNode) =>
        new TableRow({
          children: (rowNode.content ?? []).map((cellNode) => {
            const attrs = cellNode.attrs ?? {};
            const cellChildren = blocksFrom(cellNode.content ?? []);
            if (cellChildren.length === 0) cellChildren.push(new Paragraph({}));
            return new TableCell({
              children: cellChildren,
              columnSpan: attrs.colspan > 1 ? attrs.colspan : undefined,
              rowSpan: attrs.rowspan > 1 ? attrs.rowspan : undefined,
              shading:
                cellNode.type === 'tableHeader'
                  ? { type: ShadingType.CLEAR, fill: 'F0EEE8' }
                  : undefined,
            });
          }),
        })
    );

    // Column widths: present once the user dragged a column border in the
    // editor (prosemirror-tables stores px per cell). 1 px ≈ 15 twips @96dpi.
    let columnWidths;
    const firstRow = tableNode.content?.[0];
    if (firstRow) {
      const widths = [];
      for (const cellNode of firstRow.content ?? []) {
        const colwidth = cellNode.attrs?.colwidth;
        if (!Array.isArray(colwidth)) { columnWidths = undefined; widths.length = 0; break; }
        for (const px of colwidth) widths.push(Math.round(px * 15));
      }
      if (widths.length > 0) columnWidths = widths;
    }

    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths,
      borders: {
        top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder,
        insideHorizontal: tableBorder, insideVertical: tableBorder,
      },
    });
  };

  const blocksFrom = (nodes, sink = []) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'paragraph':
          sink.push(paragraphFromNode(node));
          break;
        case 'heading': {
          const level = Math.min(Math.max(node.attrs?.level ?? 1, 1), 3);
          sink.push(paragraphFromNode(node, { heading: HeadingLevel[`HEADING_${level}`] }));
          break;
        }
        case 'bulletList':
          walkList(node, 0, null, sink);
          break;
        case 'orderedList':
          walkList(node, 0, { instance: ++orderedInstance }, sink);
          break;
        case 'blockquote':
          for (const inner of node.content ?? []) {
            if (inner.type === 'paragraph') {
              sink.push(
                paragraphFromNode(inner, { indent: { left: 720 + indentTwips(inner.attrs) } })
              );
            }
          }
          break;
        case 'codeBlock': {
          const text = (node.content ?? []).map((c) => c.text ?? '').join('');
          for (const line of text.split('\n')) {
            sink.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
          }
          break;
        }
        case 'horizontalRule':
          sink.push(new Paragraph({ thematicBreak: true }));
          break;
        case 'pageBreak':
          // Word's manual break: an (empty) paragraph carrying a page-break
          // run — exactly what Ctrl+Enter produces in Word itself.
          sink.push(new Paragraph({ children: [new PageBreak()] }));
          break;
        case 'image': {
          const parsed = parseDataUrl(node.attrs?.src);
          if (!parsed) break;
          const pageMargins = docSettings.pageMarginsMm;
          const contentWidthPx = Math.round(
            ((pageSizeMm(docSettings).widthMm - pageMargins.left - pageMargins.right) * 96) / 25.4
          );
          const natural = imageSizes[node.attrs.src];
          let width = node.attrs?.width ?? natural?.width ?? Math.round(contentWidthPx * 0.6);
          width = Math.min(width, contentWidthPx);
          const height = natural
            ? Math.max(1, Math.round((width * natural.height) / natural.width))
            : Math.round(width * 0.75);
          // Floating (text wrap) is a v2 topic for DOCX — floated images export
          // as their own left/right-aligned line.
          const alignment =
            node.attrs?.float === 'left' ? AlignmentType.LEFT
            : node.attrs?.float === 'right' ? AlignmentType.RIGHT
            : ALIGN[node.attrs?.align] ?? AlignmentType.CENTER;
          sink.push(new Paragraph({
            alignment,
            children: [new ImageRun({
              type: parsed.type,
              data: parsed.data,
              transformation: { width, height },
            })],
          }));
          break;
        }
        case 'table':
          sink.push(buildTable(node));
          break;
        default:
          break;
      }
    }
    return sink;
  };

  const children = blocksFrom(contentJson.content ?? []);

  /* Header/footer from the document settings */
  const headerFooterRun = (options) =>
    new TextRun({ size: hfSize, color: hfColor, ...options });
  const numberTemplate = pageNumberTemplate(docSettings);
  const numberPosition = docSettings.pageNumberPosition ?? 'center';
  const pageNumberParts = () =>
    numberTemplate
      .split(/(\{page\}|\{pages\})/)
      .map((part) => {
        if (part === '{page}') return PageNumber.CURRENT;
        if (part === '{pages}') return PageNumber.TOTAL_PAGES;
        return part;
      })
      .filter((part) => part !== '');

  /* Feature 9: running pages vs page 1 — same shared rule as the sheet
     strips and the print CSS (core/docSettings.js -> pageChrome). While the
     flag is on we ALWAYS write explicit first parts (empty paragraph when
     no text): w:titlePg without a first reference is implementation-defined
     territory — Word itself writes empty parts. */
  const firstPageDifferent = docSettings.firstPageDifferent === true;
  const running = pageChrome(docSettings, 2);
  const first = pageChrome(docSettings, 1);

  const headerParagraphOf = (text) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: text ? [headerFooterRun({ text })] : [],
    });
  let headers;
  if (running.headerText || firstPageDifferent) {
    headers = {};
    if (running.headerText) {
      headers.default = new Header({ children: [headerParagraphOf(running.headerText)] });
    }
    if (firstPageDifferent) {
      headers.first = new Header({ children: [headerParagraphOf(first.headerText)] });
    }
  }

  const margins = docSettings.pageMarginsMm;
  let footers;
  if (running.footerText || numberTemplate) {
    // Mirror of the sheet strips: footer text left, page number in its
    // configured zone. Center/right use a tab stop; a left/left collision
    // joins both into one run separated by an en space.
    const contentWidthTwip = mmToTwip(pageSizeMm(docSettings).widthMm - margins.left - margins.right);
    const footerChildren = [];
    let alignment;
    let tabStops;
    if (running.footerText && numberTemplate) {
      if (numberPosition === 'left') {
        footerChildren.push(
          headerFooterRun({ children: [`${running.footerText}\u2002`, ...pageNumberParts()] })
        );
      } else {
        tabStops = [
          numberPosition === 'center'
            ? { type: TabStopType.CENTER, position: Math.round(contentWidthTwip / 2) }
            : { type: TabStopType.RIGHT, position: contentWidthTwip },
        ];
        footerChildren.push(headerFooterRun({ text: running.footerText }));
        footerChildren.push(headerFooterRun({ children: [new Tab(), ...pageNumberParts()] }));
      }
    } else if (numberTemplate) {
      alignment =
        numberPosition === 'center'
          ? AlignmentType.CENTER
          : numberPosition === 'right'
            ? AlignmentType.RIGHT
            : undefined; // left = Word's paragraph default
      footerChildren.push(headerFooterRun({ children: pageNumberParts() }));
    } else {
      footerChildren.push(headerFooterRun({ text: running.footerText }));
    }
    footers = {
      default: new Footer({
        children: [new Paragraph({ alignment, tabStops, children: footerChildren })],
      }),
    };
  }
  if (firstPageDifferent) {
    // First footer: text only, sitting left like the sheet strip — NEVER a
    // page number (it belongs to the default footer, Word's titlePg rule).
    footers = footers ?? {};
    footers.first = new Footer({
      children: [
        new Paragraph({
          children: first.footerText ? [headerFooterRun({ text: first.footerText })] : [],
        }),
      ],
    });
  }

  /* Styles: defaults + headings mirroring editor.css */
  // Feature 8: headings scale from the DOCUMENT base size (docSettings),
  // mirroring the em-based CSS on screen; old callers without the fields
  // fall back to the app default.
  const base = docSettings.fontSizePt ?? editorCfg.fontSizePt;
  const headingStyle = (level) => {
    const factor = settings.docx.headingFactors[level];
    const sizePt = base * factor;
    return {
      id: `Heading${level}`,
      name: `heading ${level}`,
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      // No explicit color: Word's "automatic" = black, same as body text.
      run: { size: ptToHalfPoints(sizePt), bold: true },
      paragraph: {
        spacing: {
          before: ptToTwentieths(sizePt * 1.2),
          after: ptToTwentieths(sizePt * 0.5),
          line: Math.round(1.25 * 240),
          lineRule: LineRuleType.AUTO,
        },
      },
    };
  };

  return new Document({
    numbering: {
      config: [
        {
          reference: 'sw-ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            font: firstFontName(docSettings.fontFamily ?? editorCfg.fontFamily),
            size: ptToHalfPoints(docSettings.fontSizePt ?? editorCfg.fontSizePt),
          },
          paragraph: {
            spacing: {
              line: Math.round(editorCfg.lineHeight * 240),
              lineRule: LineRuleType.AUTO,
              after: ptToTwentieths(editorCfg.paragraphSpacingPt),
            },
          },
        },
      },
      paragraphStyles: [headingStyle(1), headingStyle(2), headingStyle(3)],
    },
    sections: [
      {
        properties: {
          // Feature 9: <w:titlePg/> switches Word to the first header/footer
          // pair on page 1 (docx 9.7.1 writes the bare element for true and
          // omits it entirely for undefined — verified in the Properties
          // constructor and OnOffElement).
          titlePage: firstPageDifferent ? true : undefined,
          page: {
            // PORTRAIT dimensions on purpose: docx 9.7.1 swaps w:w/w:h
            // itself when the orientation is landscape (verified in
            // createPageSize) — pre-swapped values would double-swap.
            size: {
              width: mmToTwip(pageFormatOf(docSettings).widthMm),
              height: mmToTwip(pageFormatOf(docSettings).heightMm),
              orientation:
                docSettings.pageOrientation === 'landscape'
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: {
              top: mmToTwip(margins.top),
              right: mmToTwip(margins.right),
              bottom: mmToTwip(margins.bottom),
              left: mmToTwip(margins.left),
            },
          },
        },
        headers,
        footers,
        children,
      },
    ],
  });
}

/** Compile the CURRENT document to a DOCX Blob — shared by the export menu
 *  entry below and by Save As with the Word type picked (io/fileSystem.js,
 *  loaded lazily from there to keep the modules free of a static cycle). */
export async function buildDocxBlob(getEditor) {
  const docx = await import('docx');
  const contentJson = getEditor().getJSON();
  const wordDocument = buildDocxDocument(
    docx,
    contentJson,
    appState.get('docSettings'),
    await measureImages(contentJson)
  );
  return docx.Packer.toBlob(wordDocument);
}

export function initDocxExport(getEditor) {
  async function exportDocx() {
    try {
      const blob = await buildDocxBlob(getEditor);
      const baseName =
        stripDocExtension(appState.get('file')?.name) ?? t('file.untitled');
      const suggestedName = `${baseName}${settings.file.docxExtension}`;

      if (isTauri) {
        // Desktop (phase 6e part 3): native dialog + direct write — the
        // fallback's blob-anchor download is not reliably wired inside the
        // webview, so the Tauri branch must come first here too.
        let path = await pickSavePath(suggestedName, [
          { name: t('file.docxPickerType'), extension: settings.file.docxExtension },
        ]);
        if (!path) return; // cancelled
        if (!path.toLowerCase().endsWith(settings.file.docxExtension)) {
          path += settings.file.docxExtension;
        }
        await writeFileBytes(path, new Uint8Array(await blob.arrayBuffer()));
      } else if (supportsFileSystemAccess) {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [
            {
              description: t('file.docxPickerType'),
              accept: {
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                  [settings.file.docxExtension],
              },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = suggestedName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[docx] export failed', error);
        await showDialog({
          title: t('file.errorTitle'),
          message: t('file.exportError'),
          defaultValue: 'ok',
          buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
        });
      }
    }
  }

  return { exportDocx };
}
