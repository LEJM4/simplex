// src/core/imageNode.js
// ---------------------------------------------------------------------------
// Image support (phase-5 part, pulled forward).
//
// The node extends @tiptap/extension-image with three attributes:
//   width  (px)                    — set by dragging the corner handle
//   align  left | center | right  — block placement when not floating
//   float  none | left | right    — text wraps around the image (CSS float)
// Moving: a CUSTOM pointer drag (native HTML5 drag proved unreliable across
// browsers). Grab the image anywhere, a small tilted preview follows the
// cursor, an accent-colored insertion line marks the exact target gap, the
// workspace auto-scrolls near its edges, Escape cancels. Alt+Arrow up/down
// nudges the selected image one block at a time. Free-floating placement
// detached from the text flow (Word's "in front of text") stays a v2 topic.
//
// In the editor a NodeView renders a wrapper with a resize handle and a
// mini toolbar (alignment + wrap) that appears while the image is selected.
// Serialized HTML / JSON keeps the plain <img> with data-attributes, which
// print.css and the DOCX export map again. Sources are Base64 data URLs —
// they live directly inside the .sdoc JSON (no extra files, by design).
// ---------------------------------------------------------------------------

import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';

import { settings } from '../config/settings.js';
import { t } from '../i18n/index.js';
import { icons } from '../ui/icons.js';
import { showDialog } from '../ui/dialogs/dialog.js';

export const SwImage = Image.extend({
  // Native HTML5 dragging is disabled on purpose — the NodeView implements
  // its own pointer-based move (see below).
  draggable: false,

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveSelectedImage(this.editor, -1),
      'Alt-ArrowDown': () => moveSelectedImage(this.editor, 1),
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = element.style?.width || element.getAttribute('width');
          const value = Number.parseInt(raw, 10);
          return Number.isFinite(value) ? value : null;
        },
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}px` } : {}),
      },
      align: {
        default: 'center',
        parseHTML: (element) => element.getAttribute('data-align') ?? 'center',
        renderHTML: (attrs) => ({ 'data-align': attrs.align ?? 'center' }),
      },
      float: {
        default: 'none',
        parseHTML: (element) => element.getAttribute('data-float') ?? 'none',
        renderHTML: (attrs) => ({ 'data-float': attrs.float ?? 'none' }),
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node;

      const wrapper = document.createElement('div');
      wrapper.className = 'sw-image';
      wrapper.draggable = false;
      wrapper.title = t('image.dragHint');
      const img = document.createElement('img');
      img.draggable = false; // no native drag — the pointer logic below moves the node
      const handle = document.createElement('div');
      handle.className = 'sw-image-handle';
      handle.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('div');
      bar.className = 'sw-image-toolbar';
      wrapper.append(img, handle, bar);

      const setAttrs = (patch) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.chain().focus().setNodeSelection(pos).updateAttributes('image', patch).run();
      };

      const buttons = [];
      const addButton = (icon, label, getActive, onPick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sw-image-button';
        button.innerHTML = icons[icon];
        button.title = label;
        button.setAttribute('aria-label', label);
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', onPick);
        buttons.push({ button, getActive });
        bar.append(button);
      };
      addButton('alignLeft', t('image.alignLeft'),
        () => currentNode.attrs.float === 'none' && currentNode.attrs.align === 'left',
        () => setAttrs({ align: 'left', float: 'none' }));
      addButton('alignCenter', t('image.alignCenter'),
        () => currentNode.attrs.float === 'none' && currentNode.attrs.align === 'center',
        () => setAttrs({ align: 'center', float: 'none' }));
      addButton('alignRight', t('image.alignRight'),
        () => currentNode.attrs.float === 'none' && currentNode.attrs.align === 'right',
        () => setAttrs({ align: 'right', float: 'none' }));
      addButton('floatLeft', t('image.floatLeft'),
        () => currentNode.attrs.float === 'left',
        () => setAttrs({ float: currentNode.attrs.float === 'left' ? 'none' : 'left' }));
      addButton('floatRight', t('image.floatRight'),
        () => currentNode.attrs.float === 'right',
        () => setAttrs({ float: currentNode.attrs.float === 'right' ? 'none' : 'right' }));

      const sync = () => {
        if (img.getAttribute('src') !== currentNode.attrs.src) img.src = currentNode.attrs.src;
        img.alt = currentNode.attrs.alt ?? '';
        wrapper.dataset.align = currentNode.attrs.align ?? 'center';
        wrapper.dataset.float = currentNode.attrs.float ?? 'none';
        wrapper.style.width = currentNode.attrs.width ? `${currentNode.attrs.width}px` : '';
        for (const { button, getActive } of buttons) {
          button.classList.toggle('is-active', Boolean(getActive()));
        }
      };
      sync();

      /* Resize via the corner handle: live on the wrapper, ONE history step
         (updateAttributes) when the pointer is released. */
      let drag = null;
      const onPointerMove = (event) => {
        if (!drag) return;
        const delta = event.clientX - drag.startX;
        const max = wrapper.parentElement?.clientWidth || drag.startWidth;
        const width = Math.min(
          Math.max(settings.image.minWidthPx, drag.startWidth + delta),
          max
        );
        wrapper.style.width = `${width}px`;
        drag.lastWidth = width;
      };
      const onPointerUp = () => {
        if (!drag) return;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        const width = Math.round(drag.lastWidth ?? drag.startWidth);
        drag = null;
        setAttrs({ width });
      };
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        drag = { startX: event.clientX, startWidth: wrapper.offsetWidth, lastWidth: null };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });

      /* Custom move drag: press anywhere on the image, pull past a small
         threshold, follow with a preview, drop at the marked gap. */
      let move = null;
      const indicator = createDropIndicator();
      const preview = createDragPreview();

      const endMove = (commit, event) => {
        if (!move) return;
        window.removeEventListener('pointermove', onMoveMove);
        window.removeEventListener('pointerup', onMoveUp);
        window.removeEventListener('keydown', onMoveKey, true);
        document.body.classList.remove('sw-image-moving');
        wrapper.classList.remove('is-dragging');
        indicator.hide();
        preview.hide();
        const target = move.targetPos;
        move = null;
        if (commit && event && typeof target === 'number') {
          const fromPos = getPos();
          if (typeof fromPos === 'number') moveImageNode(editor, fromPos, target);
        }
      };
      const onMoveMove = (event) => {
        if (!move) return;
        if (!move.active) {
          const dx = event.clientX - move.startX;
          const dy = event.clientY - move.startY;
          if (Math.hypot(dx, dy) < 5) return; // click, not a drag (yet)
          move.active = true;
          document.body.classList.add('sw-image-moving');
          wrapper.classList.add('is-dragging');
          preview.show(currentNode.attrs.src, wrapper.offsetWidth);
        }
        event.preventDefault();
        preview.moveTo(event.clientX, event.clientY);
        autoScrollWorkspace(event.clientY);
        const fromPos = getPos();
        const target = dropGapFromEvent(editor.view, event, fromPos, currentNode.nodeSize);
        move.targetPos = target;
        if (target === null) indicator.hide();
        else indicator.showAt(editor.view, target);
      };
      const onMoveUp = (event) => {
        const commit = Boolean(move?.active);
        endMove(commit, event);
      };
      const onMoveKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          endMove(false);
        }
      };
      wrapper.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.sw-image-handle, .sw-image-toolbar')) return;
        event.preventDefault();
        const pos = getPos();
        if (typeof pos === 'number') {
          editor.chain().focus().setNodeSelection(pos).run();
        }
        move = { startX: event.clientX, startY: event.clientY, active: false, targetPos: null };
        window.addEventListener('pointermove', onMoveMove);
        window.addEventListener('pointerup', onMoveUp);
        window.addEventListener('keydown', onMoveKey, true);
      });

      return {
        dom: wrapper,
        update(updated) {
          if (updated.type.name !== currentNode.type.name) return false;
          currentNode = updated;
          sync();
          return true;
        },
        stopEvent(event) {
          // The NodeView owns all pointer interaction on the image (selection,
          // custom move, resize, mini toolbar) — keep ProseMirror out of it.
          if (event.type.startsWith('pointer') || event.type.startsWith('mouse') || event.type === 'click') {
            return true;
          }
          return Boolean(event.target?.closest?.('.sw-image-handle, .sw-image-toolbar'));
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          endMove(false);
          indicator.destroy();
          preview.destroy();
        },
      };
    };
  },
});

/* Moving ---------------------------------------------------------------------
   One transaction (delete + insert) = one undo step. Exported for tests and
   the Alt+Arrow shortcuts. */

export function moveImageNode(editor, fromPos, toPos) {
  const { state } = editor;
  const node = state.doc.nodeAt(fromPos);
  if (!node || node.type.name !== 'image') return false;
  if (toPos >= fromPos && toPos <= fromPos + node.nodeSize) return false; // no-op
  const tr = state.tr.delete(fromPos, fromPos + node.nodeSize);
  const mapped = tr.mapping.map(toPos);
  tr.insert(mapped, node);
  tr.setSelection(NodeSelection.create(tr.doc, mapped));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Alt+ArrowUp/-Down: nudge the selected image one top-level block. */
export function moveSelectedImage(editor, direction) {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') {
    return false;
  }
  const doc = editor.state.doc;
  const $from = doc.resolve(selection.from);
  const index = $from.index(0);
  let toPos;
  if (direction < 0) {
    if (index === 0) return true; // already first — swallow the key anyway
    toPos = $from.posAtIndex(index - 1, 0);
  } else {
    if (index >= doc.childCount - 1) return true;
    const next = doc.child(index + 1);
    // The StarterKit's trailing node keeps an empty paragraph at the very end.
    // Swapping with it would just spawn another one — treat it as "already last".
    const nextIsTrailingEmpty =
      index + 1 === doc.childCount - 1 &&
      next.type.name === 'paragraph' &&
      next.content.size === 0;
    if (nextIsTrailingEmpty) return true;
    toPos = $from.posAtIndex(index + 1, 0) + next.nodeSize;
  }
  moveImageNode(editor, selection.from, toPos);
  return true;
}

/** Cursor position → insertion gap between top-level blocks (or null). */
function dropGapFromEvent(view, event, fromPos, nodeSize) {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const doc = view.state.doc;
  const $pos = doc.resolve(found.pos);
  if ($pos.depth === 0) {
    // Between blocks already — snap to the nearest boundary.
    return clampGap(found.pos, fromPos, nodeSize, doc);
  }
  const blockStart = $pos.before(1);
  const blockNode = doc.nodeAt(blockStart);
  const dom = view.nodeDOM(blockStart);
  let before = true;
  if (dom?.getBoundingClientRect) {
    const rect = dom.getBoundingClientRect();
    before = event.clientY < rect.top + rect.height / 2;
  }
  const gap = before ? blockStart : blockStart + blockNode.nodeSize;
  return clampGap(gap, fromPos, nodeSize, doc);
}

function clampGap(gap, fromPos, nodeSize, doc) {
  const clamped = Math.max(0, Math.min(gap, doc.content.size));
  if (clamped >= fromPos && clamped <= fromPos + nodeSize) return null; // inside itself
  return clamped;
}

/** Accent-colored insertion line with a dot, positioned at a document gap. */
function createDropIndicator() {
  let element = null;
  return {
    showAt(view, pos) {
      if (!element) {
        element = document.createElement('div');
        element.className = 'sw-drop-indicator';
        document.body.append(element);
      }
      let top;
      try {
        top = view.coordsAtPos(pos).top;
      } catch {
        return;
      }
      const editorRect = view.dom.getBoundingClientRect();
      element.style.top = `${Math.round(top) - 2}px`;
      element.style.left = `${Math.round(editorRect.left)}px`;
      element.style.width = `${Math.round(editorRect.width)}px`;
      element.style.display = 'block';
    },
    hide() {
      if (element) element.style.display = 'none';
    },
    destroy() {
      element?.remove();
      element = null;
    },
  };
}

/** Small tilted thumbnail following the cursor while moving. */
function createDragPreview() {
  let element = null;
  let image = null;
  return {
    show(src, sourceWidth) {
      if (!element) {
        element = document.createElement('div');
        element.className = 'sw-drag-preview';
        image = document.createElement('img');
        element.append(image);
        document.body.append(element);
      }
      image.src = src;
      element.style.width = `${Math.min(sourceWidth || 180, 180)}px`;
      element.style.display = 'block';
    },
    moveTo(x, y) {
      if (!element) return;
      element.style.transform = `translate(${x + 14}px, ${y + 14}px) rotate(2.5deg)`;
    },
    hide() {
      if (element) element.style.display = 'none';
    },
    destroy() {
      element?.remove();
      element = null;
      image = null;
    },
  };
}

/** Keep dragging usable in long documents: scroll near the workspace edges. */
function autoScrollWorkspace(clientY) {
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  const rect = workspace.getBoundingClientRect();
  const zone = 70;
  if (clientY < rect.top + zone) workspace.scrollTop -= 14;
  else if (clientY > rect.bottom - zone) workspace.scrollTop += 14;
}

/* Insert helpers (toolbar button, paste and drop) --------------------------- */

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });

/**
 * Insert image files as Base64 data URLs. `pos` places them at a document
 * position (drop), otherwise they land at the current selection.
 * Oversized files are skipped with a dialog (Base64 bloats the .sdoc).
 */
export async function insertImageFiles(editor, files, pos = null) {
  const images = [...files].filter((file) => file.type?.startsWith('image/'));
  if (images.length === 0) return false;

  const maxBytes = settings.image.maxFileSizeMb * 1024 * 1024;

  // If an image node is currently selected, inserting would REPLACE it
  // (ProseMirror replace semantics) — insert after it instead.
  let target = pos;
  if (typeof target !== 'number') {
    const selection = editor.state.selection;
    if (selection.node?.type?.name === 'image') target = selection.to;
  }

  for (const file of images) {
    if (file.size > maxBytes) {
      await showDialog({
        title: t('image.tooBigTitle'),
        message: t('image.tooBig', { name: file.name, max: settings.image.maxFileSizeMb }),
        defaultValue: 'ok',
        buttons: [{ label: t('dialog.ok'), value: 'ok', primary: true }],
      });
      continue;
    }
    const src = await fileToDataUrl(file);
    const content = {
      type: 'image',
      attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') },
    };
    if (typeof target === 'number') {
      editor.chain().focus().insertContentAt(target, content).run();
      target += 1;
    } else {
      editor.chain().focus().insertContent(content).run();
    }
  }
  return true;
}
