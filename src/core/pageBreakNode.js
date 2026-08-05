// src/core/pageBreakNode.js
// ---------------------------------------------------------------------------
// Manual page break (phase 7c / part of the page-view work): a real block
// node in the document. In print/PDF it forces a page (rule in the GENERATED
// print CSS — io/pdfPrint.js; static print.css never reaches paged.js's
// breaks module, verified in pagedjs 0.4.3 previewer sources). In the DOCX
// export it becomes a Word page-break run; the import maps Word's
// <w:br type="page"/> back onto this node (io/docxImport.js styleMap).
//
// Keyboard: Ctrl+Enter, exactly like Word. The pinned HardBreak extension
// binds Mod-Enter AND Shift-Enter without an opt-out (verified in
// @tiptap/extension-hard-break 3.29.1) — this extension therefore carries
// priority 101: Tiptap sorts keymaps by priority (verified in @tiptap/core),
// our handler wins Mod-Enter, Shift-Enter stays the line break.
//
// Rendering: the serialized form (getHTML → print, copy/paste) is a bare
// <div data-sw-page-break> — NO label text, because serialized output must
// never contain UI language. The label the user sees in the editor comes
// from a NodeView (t()-translated, rebuilt on language switch via the
// editor remaining untouched — the label is re-read on node redraw only,
// so a live language switch updates it on the next document change; the
// chrome rebuild covers the common case).
//
// Not allowed inside tables: Word refuses page breaks in table cells, and
// our v1 pagination treats tables as unbreakable blocks. The command guards
// against it, which also disables the toolbar button via can().
// ---------------------------------------------------------------------------

import { Node } from '@tiptap/core';

import { t } from '../i18n/index.js';

/** True when the resolved selection start sits anywhere inside a table. */
function insideTable($from) {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return true;
  }
  return false;
}

export const PageBreak = Node.create({
  name: 'pageBreak',

  // Keymap BEFORE HardBreak (default priority 100) — see header comment.
  priority: 101,

  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [
      // Canonical serialized form (copy/paste round trip).
      { tag: 'div[data-sw-page-break]' },
      // DOCX import target: mammoth maps <w:br type="page"/> to this class
      // (io/docxImport.js). Priority above horizontalRule's plain `hr` rule
      // (default 50), so a mapped break never parses as a divider — and a
      // plain <hr> stays a divider.
      { tag: 'hr.sw-page-break', priority: 60 },
    ];
  },

  renderHTML() {
    return ['div', { 'data-sw-page-break': '', class: 'sw-page-break' }];
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('div');
      dom.className = 'sw-page-break';
      dom.setAttribute('data-sw-page-break', '');
      dom.contentEditable = 'false';
      const label = document.createElement('span');
      label.className = 'sw-page-break-label';
      label.textContent = t('pageBreak.label');
      dom.append(label);
      return {
        dom,
        // The label is generated content — never let mutations inside it
        // reach ProseMirror.
        ignoreMutation() {
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      /** Insert a page break at the selection (splits the paragraph like
       *  Word does) and place the caret after it. Refused inside tables. */
      insertPageBreak:
        () =>
        ({ state, chain }) => {
          if (insideTable(state.selection.$from)) return false;
          return chain()
            .insertContent({ type: this.name })
            .scrollIntoView()
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    };
  },
});
