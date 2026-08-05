// src/ui/linkUi.js
// ---------------------------------------------------------------------------
// Link UI (phase 7a). The Link extension itself ships with the StarterKit
// (mark, autolink while typing, paste detection, URI sanitizing) — this
// module adds the missing user interface on top:
//
//   Dialog (Ctrl+K / toolbar button): empty selection inserts the address as
//   linked text (Word behavior), a selection or a caret inside a link
//   (re)links the whole range, plus a remove button. Bare "example.com" is
//   normalized to https://…, "name@host.de" to mailto:. Validation delegates
//   to the extension's isAllowedUri via editor.can().setLink() — one source
//   of truth for what a link may be (javascript: etc. stay rejected).
//
//   Bubble at the caret: whenever the selection sits inside a link, a small
//   floating bar below the line shows the target and offers open (web only) /
//   edit / remove. Buttons prevent focus loss on mousedown, exactly like the
//   toolbar, so the selection survives every interaction.
//
// Opening links: browser only for now (bubble anchor + Ctrl+click). The
// desktop webview needs an opener plugin for external URLs — parked as an
// open point in the plan; on the desktop the bubble shows the plain target.
// ---------------------------------------------------------------------------

import { settings } from '../config/settings.js';
import { appState } from '../core/appState.js';
import { t } from '../i18n/index.js';
import { isTauri } from '../io/tauriFs.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** Raw input → canonical href; empty input → null. */
function normalizeHref(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (SCHEME_PATTERN.test(value)) return value;
  if (EMAIL_PATTERN.test(value)) return `mailto:${value}`;
  return `${settings.link.defaultProtocol}://${value}`;
}

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;

export function initLinkUi(getEditor) {
  let dialogOpen = false;

  /* Dialog ------------------------------------------------------------------ */

  function openLinkDialog() {
    const editor = getEditor();
    if (!editor || dialogOpen) return Promise.resolve(false);
    dialogOpen = true;
    hideBubble();

    return new Promise((resolve) => {
      const existing = editor.getAttributes('link').href ?? null;

      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';
      const box = document.createElement('div');
      box.className = 'dialog dialog--form';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      const title = existing ? t('link.editTitle') : t('link.insertTitle');
      box.setAttribute('aria-label', title);
      const heading = document.createElement('h2');
      heading.className = 'dialog-title';
      heading.textContent = title;

      const field = document.createElement('label');
      field.className = 'dialog-field dialog-field--wide';
      const caption = document.createElement('span');
      caption.textContent = t('link.urlLabel');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'dialog-input';
      input.value = existing ?? '';
      input.placeholder = t('link.urlPlaceholder');
      input.spellcheck = false;
      field.append(caption, input);

      const error = document.createElement('p');
      error.className = 'dialog-error';
      error.hidden = true;
      error.textContent = t('link.invalid');

      const row = document.createElement('div');
      row.className = 'dialog-buttons';
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'dialog-button';
      cancelButton.textContent = t('file.cancel');
      const okButton = document.createElement('button');
      okButton.type = 'button';
      okButton.className = 'dialog-button dialog-button--primary';
      okButton.textContent = t('dialog.ok');

      if (existing) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'dialog-button dialog-button--danger';
        removeButton.textContent = t('link.remove');
        removeButton.addEventListener('click', () => {
          getEditor().chain().focus().extendMarkRange('link').unsetLink().run();
          finish(true);
        });
        row.append(removeButton);
      }
      row.append(cancelButton, okButton);

      const finish = (applied) => {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        dialogOpen = false;
        getEditor()?.commands.focus();
        resolve(applied);
      };

      const apply = () => {
        const targetEditor = getEditor();
        const href = normalizeHref(input.value);
        if (!href) {
          // Empty address changes nothing — removing has its own button.
          finish(false);
          return;
        }
        // The extension's isAllowedUri decides (dry run, works regardless of
        // the selection); rejected addresses show the inline error instead.
        if (!targetEditor.can().setLink({ href })) {
          error.hidden = false;
          input.focus();
          input.select();
          return;
        }
        if (targetEditor.state.selection.empty && !targetEditor.isActive('link')) {
          // Nothing selected, no link under the caret: insert the address as
          // its own linked text; unsetMark clears the stored mark so typing
          // right after continues UNlinked (Word behavior).
          targetEditor
            .chain()
            .focus()
            .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
            .unsetMark('link')
            .run();
        } else {
          // Selection, or caret inside an existing link: (re)link the range.
          targetEditor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        }
        finish(true);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        } else if (event.key === 'Enter' && event.target === input) {
          event.preventDefault();
          apply();
        } else if (event.key === 'Tab') {
          // Keep focus inside the dialog.
          const focusable = [...box.querySelectorAll('input, button')];
          const index = focusable.indexOf(document.activeElement);
          if (event.shiftKey && index <= 0) {
            event.preventDefault();
            focusable[focusable.length - 1].focus();
          } else if (!event.shiftKey && index === focusable.length - 1) {
            event.preventDefault();
            focusable[0].focus();
          }
        }
      };

      cancelButton.addEventListener('click', () => finish(false));
      okButton.addEventListener('click', apply);
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener('keydown', onKeyDown, true);

      box.append(heading, field, error, row);
      overlay.append(box);
      document.body.append(overlay);
      input.focus();
      input.select();
    });
  }

  /* Bubble ------------------------------------------------------------------ */

  const bubble = document.createElement('div');
  bubble.className = 'link-bubble';
  bubble.hidden = true;
  // Toolbar rule: never steal the editor focus, the selection must survive.
  bubble.addEventListener('mousedown', (event) => event.preventDefault());
  document.body.append(bubble);

  let shownHref = null;

  const buildBubble = (href) => {
    bubble.replaceChildren();
    bubble.setAttribute('aria-label', t('link.bubbleLabel'));

    // In the browser the target itself is a real anchor (click = open in a
    // new tab); the desktop webview has no external-open channel yet, so it
    // shows the plain address there.
    let urlElement;
    if (isTauri) {
      urlElement = document.createElement('span');
    } else {
      urlElement = document.createElement('a');
      urlElement.href = href;
      urlElement.target = '_blank';
      urlElement.rel = 'noopener noreferrer';
      urlElement.setAttribute('aria-label', t('link.open'));
    }
    urlElement.className = 'link-bubble-url';
    urlElement.textContent = truncate(href, settings.link.bubbleMaxChars);
    urlElement.title = href;

    const actionButton = (label, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-bubble-button';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };

    bubble.append(
      urlElement,
      actionButton(t('link.edit'), () => openLinkDialog()),
      actionButton(t('link.remove'), () =>
        getEditor().chain().focus().extendMarkRange('link').unsetLink().run()
      )
    );
  };

  const hideBubble = () => {
    bubble.hidden = true;
    shownHref = null;
  };

  const updateBubble = () => {
    const editor = getEditor();
    const href =
      editor && !editor.isDestroyed && editor.isActive('link')
        ? editor.getAttributes('link').href ?? null
        : null;
    if (!href || dialogOpen) {
      hideBubble();
      return;
    }
    if (href !== shownHref) {
      buildBubble(href);
      shownHref = href;
    }
    // Anchor below the caret line; make it measurable first, then clamp the
    // box into the viewport (coordsAtPos returns viewport coordinates, the
    // bubble is position:fixed — scroll/resize listeners re-run this).
    bubble.hidden = false;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const left = Math.max(8, Math.min(coords.left, window.innerWidth - bubble.offsetWidth - 8));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${coords.bottom + 6}px`;
  };

  const reposition = () => {
    if (!bubble.hidden) updateBubble();
  };

  const offTransaction = appState.on('editor:transaction', updateBubble);
  window.addEventListener('scroll', reposition, { capture: true, passive: true });
  window.addEventListener('resize', reposition);

  // Ctrl/Cmd+click on a link opens the target (browser only — see header).
  // Capture phase, so ProseMirror's own click handling cannot swallow it.
  const onCtrlClick = (event) => {
    if (!(event.ctrlKey || event.metaKey) || isTauri) return;
    const anchor = event.target.closest?.('.ProseMirror a[href]');
    if (!anchor) return;
    event.preventDefault();
    window.open(anchor.getAttribute('href'), '_blank', 'noopener');
  };
  document.addEventListener('click', onCtrlClick, true);

  return {
    openLinkDialog,
    /** Detach listeners and remove the bubble (symmetry with the chrome). */
    destroy() {
      offTransaction();
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
      document.removeEventListener('click', onCtrlClick, true);
      bubble.remove();
    },
  };
}
