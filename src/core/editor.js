// src/core/editor.js
// ---------------------------------------------------------------------------
// Tiptap setup (v3, headless — the UI around it is entirely ours).
//
// Note on Tiptap 3.x: the StarterKit already registers Bold, Italic,
// Underline, Strike, Code, Headings, Lists, Blockquote, HorizontalRule,
// Link, HardBreak, Dropcursor, Gapcursor and UndoRedo (the former "History").
// Undo/redo therefore works out of the box and MUST stay the only history
// mechanism — no feature may bypass or break it.
//
// Phase 1 adds: TextStyle + FontFamily/FontSize/Color (all shipped inside
// @tiptap/extension-text-style in v3), Highlight (multicolor) and TextAlign.
// TextAlign keeps its default `defaultAlignment: null`, so unaligned nodes
// carry no attribute — the toolbar maps null to "left".
// ---------------------------------------------------------------------------

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';

import { Spacing } from './spacing.js';
import { Indent } from './indent.js';
import { ClearFormatting } from './clearFormatting.js';
import { PendingMarks } from './pendingMarks.js';
import { SwTypography } from './typography.js';
import { SwImage, insertImageFiles } from './imageNode.js';
import { Search } from './search.js';
import { Inspect } from './inspect.js';
import { PageBreak } from './pageBreakNode.js';
import { PageView } from './pageView.js';

import { settings } from '../config/settings.js';
import { appState } from './appState.js';
import { t } from '../i18n/index.js';

/**
 * Create the Tiptap editor inside the given element and wire its lifecycle
 * into the app-wide event bus.
 *
 * @param element  DOM node the editor renders into
 * @param options  { content } — restored document (Tiptap JSON) or null.
 *                 Passed to the constructor on purpose: content set this way
 *                 is the history's clean starting point, so Ctrl+Z right
 *                 after a restore can never wipe the document.
 *
 * Emitted events:
 *   - 'document:updated'    content changed (typing, paste, undo, …)
 *   - 'editor:transaction'  any transaction, incl. selection changes
 *                           (toolbars listen to this to refresh their state)
 * State keys:
 *   - 'editorReady' (boolean), 'documentDirty' (boolean)
 */
export function createEditor(element, { content = null } = {}) {
  // Late reference: the paste/drop handlers below run long after creation
  // and need the editor instance for the insert commands.
  let editorInstance = null;
  const hasImageFiles = (files) =>
    files?.length && [...files].some((file) => file.type?.startsWith('image/'));

  const editor = new Editor({
    element,
    content: content ?? undefined,
    extensions: [
      StarterKit.configure({
        heading: { levels: settings.editor.headingLevels },
        // Links (phase 7a): clicking a link places the caret — editing lives
        // in the bubble/dialog (ui/linkUi.js), opening is Ctrl+click (web).
        link: {
          openOnClick: false,
          defaultProtocol: settings.link.defaultProtocol,
        },
      }),
      Placeholder.configure({
        // Function, not string: re-evaluated on redraw, so a later language
        // switch (phase 6) picks up the translated text automatically.
        placeholder: () => t('editor.placeholder'),
      }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      // Word semantics: super- and subscript exclude each other. Enforced at
      // the SCHEMA level (excludes lists name the mark itself too, which
      // keeps plain toggling intact) — covers toolbar, shortcuts and paste.
      Subscript.extend({ excludes: 'subscript superscript' }),
      Superscript.extend({ excludes: 'superscript subscript' }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      Spacing,
      SwTypography.configure(settings.typography.rules),
      SwImage.configure({ allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // AFTER the list/table extensions on purpose: Tiptap gives LATER
      // extensions keymap precedence, and Indent's Tab handlers rely on
      // guarding themselves out of lists and tables (see core/indent.js).
      Indent,
      ClearFormatting,
      PendingMarks,
      CharacterCount,
      Search,
      Inspect,
      PageBreak,
      PageView,
    ],
    autofocus: settings.editor.autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        'aria-label': t('editor.ariaLabel'),
        // Native browser spellcheck; toggled at runtime via the status bar.
        spellcheck: String(appState.get('spellcheck') ?? settings.editor.spellcheck),
      },
      // Images from the clipboard land at the caret …
      handlePaste(view, event) {
        const files = event.clipboardData?.files;
        if (!hasImageFiles(files)) return false;
        event.preventDefault();
        insertImageFiles(editorInstance, files);
        return true;
      },
      // … dropped image files land where they were dropped. `moved` means an
      // in-document drag (e.g. our own image node) — ProseMirror handles that.
      handleDrop(view, event, _slice, moved) {
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!hasImageFiles(files)) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertImageFiles(editorInstance, files, coords?.pos ?? null);
        return true;
      },
    },
    onCreate() {
      appState.set('editorReady', true);
    },
    onUpdate() {
      appState.set('documentDirty', true);
      appState.emit('document:updated');
    },
    onTransaction() {
      appState.emit('editor:transaction');
    },
  });

  editorInstance = editor;
  return editor;
}
