// src/ui/toolbar.js
// ---------------------------------------------------------------------------
// The full formatting toolbar. Pattern for every control: label + tooltip
// via t(), command via getEditor().chain().focus(), state refresh on the
// 'editor:transaction' event. Buttons prevent focus loss on mousedown so the
// text selection in the editor survives every toolbar interaction.
//
// The editor instance is REPLACEABLE (open/new mount a fresh one to keep the
// undo history clean), therefore all controls resolve it lazily through
// getEditor() instead of capturing a reference.
// ---------------------------------------------------------------------------

import { t, getLanguage } from '../i18n/index.js';
import { appState } from '../core/appState.js';
import { pendingTextStyleAt } from '../core/pendingMarks.js';
import { settings } from '../config/settings.js';
import { icons } from './icons.js';
import { createDropdown } from './dropdown.js';
import { insertImageFiles } from '../core/imageNode.js';

const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

/* Building blocks ---------------------------------------------------------- */

/* Font-size plumbing (0.21.0) — module level so the Strg+8/9 shortcuts in
   main.js reuse exactly the same rules as the toolbar controls. */

/** Word-style half-point grid, clamped to the settings bounds. */
function clampSizePt(value) {
  const rounded = Math.round(value * 2) / 2;
  return Math.min(
    settings.editor.fontSizeMaxPt,
    Math.max(settings.editor.fontSizeMinPt, rounded)
  );
}

/* Feature 8 (0.29.0): the "default" the font controls compare against is the
   DOCUMENT default from the docSettings, not the app setting. Font marks are
   absolute — changing the document default never rewrites them; picking the
   current default in a control removes the mark instead of storing it. */
const docFontDefaults = () => {
  const doc = appState.get('docSettings');
  return {
    fontFamily: doc?.fontFamily ?? settings.editor.fontFamily,
    fontSizePt: doc?.fontSizePt ?? settings.editor.fontSizePt,
  };
};

/** Current size at the caret/selection in pt (document default if unset). */
export function currentFontSizePt(getEditor) {
  const editor = getEditor();
  const raw = Number.parseFloat(editor?.getAttributes('textStyle')?.fontSize);
  if (Number.isFinite(raw)) return raw;
  // Empty seeded block (fresh table cell): the pending size counts.
  const seeded = Number.parseFloat(
    editor ? pendingTextStyleAt(editor.state)?.fontSize : undefined
  );
  return Number.isFinite(seeded) ? seeded : docFontDefaults().fontSizePt;
}

/** Apply a size; the document default clears the mark instead of storing it. */
export function applyFontSizePt(getEditor, value) {
  const editor = getEditor();
  if (!editor || !Number.isFinite(value)) return;
  const size = clampSizePt(value);
  const isDefault = size === docFontDefaults().fontSizePt;
  const command = editor.chain().focus();
  // Empty blocks in the selection (fresh table cells!) keep the choice as a
  // pending seed — one chain, one transaction, one undo step.
  (isDefault ? command.unsetFontSize() : command.setFontSize(`${size}pt`))
    .seedPendingTextStyle({ fontSize: isDefault ? null : `${size}pt` })
    .run();
}

/** ±delta stepping (A−/A+ buttons and Strg+8/9). */
export function stepFontSize(getEditor, delta) {
  applyFontSizePt(getEditor, currentFontSizePt(getEditor) + delta);
}

function createButton({ icon, label, shortcut, onClick, toggle = false, colorBar = false }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toolbar-button' + (colorBar ? ' toolbar-button--color' : '');
  button.innerHTML = icons[icon] + (colorBar ? '<span class="toolbar-color-bar"></span>' : '');
  button.setAttribute('aria-label', label);
  if (toggle) button.setAttribute('aria-pressed', 'false');
  button.title = shortcut ? `${label} (${shortcut})` : label;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function setActive(button, active) {
  button.classList.toggle('is-active', active);
  if (button.hasAttribute('aria-pressed')) {
    button.setAttribute('aria-pressed', String(active));
  }
}

function createSelect({ label, options, onChange }) {
  const select = document.createElement('select');
  select.className = 'toolbar-select';
  select.setAttribute('aria-label', label);
  select.title = label;
  for (const { value, text } of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

/**
 * Toolbar button that opens a color palette. The colored bar underneath the
 * icon mirrors the color at the current selection (or a fallback).
 */
function createColorControl({ icon, label, shortcut, palette, resetText, fallbackBar, getCurrent, onPick, onReset }) {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dropdown';

  const button = createButton({ icon, label, shortcut, colorBar: true });
  const bar = button.querySelector('.toolbar-color-bar');
  wrap.append(button);

  const keepEditorFocus = (el) =>
    el.addEventListener('mousedown', (event) => event.preventDefault());

  createDropdown({
    trigger: button,
    buildPanel(panel, close) {
      const current = getCurrent();

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'toolbar-popover-reset';
      reset.textContent = resetText;
      keepEditorFocus(reset);
      reset.addEventListener('click', () => { onReset(); close(); });

      const grid = document.createElement('div');
      grid.className = 'toolbar-swatch-grid';
      for (const { key, value } of palette) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'toolbar-swatch' + (value === current ? ' is-active' : '');
        swatch.style.background = value;
        swatch.setAttribute('aria-label', t(`color.${key}`));
        swatch.title = t(`color.${key}`);
        keepEditorFocus(swatch);
        swatch.addEventListener('click', () => { onPick(value); close(); });
        grid.append(swatch);
      }

      panel.append(reset, grid);
    },
  });

  return {
    element: wrap,
    refresh() {
      bar.style.background = getCurrent() ?? fallbackBar;
    },
  };
}

/**
 * Dropdown for line height and space-after-paragraph. Both lists mark the
 * value at the caret; "Default" removes the attribute (document defaults
 * from settings.js apply again). Below the presets each section offers a
 * free-value input (comma or dot decimals) — line height as a unitless
 * factor, space-after in points.
 */
function createSpacingControl(getEditor, chain) {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dropdown';

  const button = createButton({ icon: 'spacing', label: t('toolbar.spacing') });
  wrap.append(button);

  // The caret sits either in a paragraph or in a heading.
  const getBlockAttribute = (name) =>
    getEditor().getAttributes('paragraph')[name] ??
    getEditor().getAttributes('heading')[name] ??
    null;

  const parseDecimal = (text) => {
    const value = Number.parseFloat(String(text).trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  };
  const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
  const localized = (value) => Number(value).toLocaleString(getLanguage());

  createDropdown({
    trigger: button,
    buildPanel(panel, close) {
      const label = (text) => {
        const element = document.createElement('span');
        element.className = 'toolbar-popover-label';
        element.textContent = text;
        return element;
      };
      const option = (text, active, onPick) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'toolbar-popover-option' + (active ? ' is-active' : '');
        element.textContent = text;
        element.addEventListener('mousedown', (event) => event.preventDefault());
        element.addEventListener('click', () => { onPick(); close(); });
        return element;
      };
      // Free-value row: text input (inputmode=decimal) + unit + apply button.
      // The input NEEDS focus, so unlike the buttons it must not prevent the
      // mousedown default — the editor keeps its selection in state and gets
      // it back via chain().focus() when the value is applied.
      const inputRow = ({ ariaLabel, unit, currentValue, isCustom, apply }) => {
        const row = document.createElement('div');
        row.className = 'toolbar-popover-inputrow' + (isCustom ? ' is-active' : '');

        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.className = 'toolbar-popover-input';
        input.placeholder = t('spacing.custom');
        input.setAttribute('aria-label', ariaLabel);
        if (isCustom && currentValue !== null) input.value = localized(currentValue);

        const submit = () => {
          const value = parseDecimal(input.value);
          if (value === null) {
            input.select();
            return;
          }
          apply(value);
          close();
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
          // Escape bubbles to the dropdown handler and closes the panel.
        });

        const applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.className = 'toolbar-popover-apply';
        applyButton.innerHTML = icons.check;
        applyButton.setAttribute('aria-label', t('spacing.apply'));
        applyButton.title = t('spacing.apply');
        applyButton.addEventListener('click', submit);

        row.append(input);
        if (unit) {
          const unitElement = document.createElement('span');
          unitElement.className = 'toolbar-popover-unit';
          unitElement.textContent = unit;
          row.append(unitElement);
        }
        row.append(applyButton);
        return row;
      };

      /* Line height ------------------------------------------------------- */
      const currentLineHeight = getBlockAttribute('lineHeight');
      const lineHeightPresets = settings.editor.lineHeights.map(String);
      panel.append(
        label(t('spacing.lineHeight')),
        option(t('spacing.default'), currentLineHeight === null, () =>
          chain().unsetLineHeight().run()
        ),
        ...settings.editor.lineHeights.map((value) =>
          option(localized(value), currentLineHeight === String(value), () =>
            chain().setLineHeight(String(value)).run()
          )
        ),
        inputRow({
          ariaLabel: `${t('spacing.lineHeight')} – ${t('spacing.custom')}`,
          unit: null,
          currentValue: currentLineHeight === null ? null : Number.parseFloat(currentLineHeight),
          isCustom: currentLineHeight !== null && !lineHeightPresets.includes(currentLineHeight),
          apply: (value) => {
            const rounded = Math.round(clamp(value, settings.editor.lineHeightRange) * 100) / 100;
            chain().setLineHeight(String(rounded)).run();
          },
        })
      );

      /* Space after paragraph ---------------------------------------------- */
      const currentSpaceAfter = getBlockAttribute('spaceAfter');
      const currentSpaceAfterPt =
        currentSpaceAfter === null ? null : Number.parseFloat(currentSpaceAfter);
      const spacingPresets = settings.editor.paragraphSpacingsPt.map((value) => `${value}pt`);
      panel.append(
        label(t('spacing.spaceAfter')),
        option(t('spacing.default'), currentSpaceAfter === null, () =>
          chain().unsetSpaceAfter().run()
        ),
        ...settings.editor.paragraphSpacingsPt.map((value) =>
          option(t('spacing.afterValue', { value }), currentSpaceAfter === `${value}pt`, () =>
            chain().setSpaceAfter(`${value}pt`).run()
          )
        ),
        inputRow({
          ariaLabel: `${t('spacing.spaceAfter')} – ${t('spacing.custom')}`,
          unit: 'pt',
          currentValue: currentSpaceAfterPt,
          isCustom: currentSpaceAfter !== null && !spacingPresets.includes(currentSpaceAfter),
          apply: (value) => {
            const rounded =
              Math.round(clamp(value, settings.editor.paragraphSpacingRangePt) * 10) / 10;
            chain().setSpaceAfter(`${rounded}pt`).run();
          },
        })
      );
    },
  });

  return wrap;
}

/**
 * One table button, two modes: outside a table it opens a Word-style size
 * picker (hover an N×M grid, click to insert with a header row); with the
 * caret inside a table it turns into the table action menu.
 */
function createTableControl(getEditor, chain) {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dropdown';

  const button = createButton({ icon: 'table', label: t('toolbar.table'), toggle: true });
  wrap.append(button);

  createDropdown({
    trigger: button,
    buildPanel(panel, close) {
      const label = (text) => {
        const element = document.createElement('span');
        element.className = 'toolbar-popover-label';
        element.textContent = text;
        return element;
      };
      const option = (text, onPick) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'toolbar-popover-option';
        element.textContent = text;
        element.addEventListener('mousedown', (event) => event.preventDefault());
        element.addEventListener('click', () => { onPick(); close(); });
        return element;
      };

      if (!getEditor().isActive('table')) {
        /* Size picker */
        panel.append(label(t('table.insert')));
        const max = settings.table.pickerMax;
        const grid = document.createElement('div');
        grid.className = 'toolbar-table-grid';
        grid.style.gridTemplateColumns = `repeat(${max}, 18px)`;
        const size = document.createElement('span');
        size.className = 'toolbar-table-size';
        size.textContent = t('table.size', { rows: 0, cols: 0 });
        const cells = [];
        for (let row = 1; row <= max; row += 1) {
          for (let col = 1; col <= max; col += 1) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'toolbar-table-cell';
            cell.dataset.rows = String(row);
            cell.dataset.cols = String(col);
            cell.setAttribute('aria-label', t('table.size', { rows: row, cols: col }));
            cell.addEventListener('mousedown', (event) => event.preventDefault());
            cell.addEventListener('mouseenter', () => {
              for (const other of cells) {
                other.classList.toggle(
                  'is-hot',
                  Number(other.dataset.rows) <= row && Number(other.dataset.cols) <= col
                );
              }
              size.textContent = t('table.size', { rows: row, cols: col });
            });
            cell.addEventListener('click', () => {
              chain().insertTable({ rows: row, cols: col, withHeaderRow: true }).run();
              close();
            });
            cells.push(cell);
            grid.append(cell);
          }
        }
        panel.append(grid, size);
        return;
      }

      /* Action menu inside a table: grouped (rows | columns | structure),
         the destructive whole-table delete visually set apart. */
      const menuSeparator = () => {
        const line = document.createElement('div');
        line.className = 'menu-separator';
        line.setAttribute('aria-hidden', 'true');
        return line;
      };
      const deleteTableOption = option(t('table.deleteTable'), () => chain().deleteTable().run());
      deleteTableOption.classList.add('toolbar-popover-option--danger');

      panel.append(
        option(t('table.rowAbove'), () => chain().addRowBefore().run()),
        option(t('table.rowBelow'), () => chain().addRowAfter().run()),
        option(t('table.deleteRow'), () => chain().deleteRow().run()),
        menuSeparator(),
        option(t('table.colLeft'), () => chain().addColumnBefore().run()),
        option(t('table.colRight'), () => chain().addColumnAfter().run()),
        option(t('table.deleteCol'), () => chain().deleteColumn().run()),
        menuSeparator(),
        option(t('table.toggleHeader'), () => chain().toggleHeaderRow().run()),
        deleteTableOption
      );
    },
  });

  return { element: wrap, button };
}

/* Toolbar ------------------------------------------------------------------ */

/**
 * The "⋯" overflow control (0.23.0). Unlike createDropdown its panel is
 * PERSISTENT: collapsed toolbar sections are moved into it and must survive
 * open/close cycles. Nested dropdowns (colors, table, spacing) keep working
 * inside — their outside-click handlers see the panel as "inside".
 */
function createOverflowControl() {
  const wrap = document.createElement('div');
  wrap.className = 'toolbar-dropdown toolbar-overflow';
  const button = createButton({ icon: 'more', label: t('toolbar.more') });
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'toolbar-popover toolbar-popover--overflow';
  panel.hidden = true;
  wrap.append(button, panel);

  const onOutsidePointerDown = (event) => {
    if (!wrap.contains(event.target)) close();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  };
  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }
  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  return { wrap, button, panel, close };
}

export function initToolbar(root, getEditor, leadingElements = [], actions = {}) {
  root.setAttribute('aria-label', t('toolbar.ariaLabel'));

  const chain = () => getEditor().chain().focus();
  const group = (...children) => {
    const g = document.createElement('div');
    g.className = 'toolbar-group';
    g.append(...children);
    return g;
  };
  const separator = () => {
    const s = document.createElement('span');
    s.className = 'toolbar-separator';
    s.setAttribute('aria-hidden', 'true');
    return s;
  };
  /* Sections are the units the one-line layout works with: [separator?,
     group]. `fixed` sections (file menu, undo/redo) never collapse into
     the overflow panel. */
  const sections = [];
  const section = ({ fixed = false, withSeparator = true }, ...children) => {
    const el = document.createElement('div');
    el.className = 'toolbar-section';
    if (withSeparator) el.append(separator());
    el.append(group(...children));
    sections.push({ el, fixed });
    return el;
  };

  /* History */
  const undoButton = createButton({
    icon: 'undo', label: t('toolbar.undo'), shortcut: t('shortcut.undo'),
    onClick: () => chain().undo().run(),
  });
  const redoButton = createButton({
    icon: 'redo', label: t('toolbar.redo'), shortcut: t('shortcut.redo'),
    onClick: () => chain().redo().run(),
  });

  /* Paragraph format (incl. the "quote" block style) */
  const paragraphSelect = createSelect({
    label: t('toolbar.paragraphFormat'),
    options: [
      { value: 'p', text: t('paragraph.text') },
      ...settings.editor.headingLevels.map((level) => ({
        value: `h${level}`,
        text: t(`paragraph.h${level}`),
      })),
      { value: 'quote', text: t('paragraph.quote') },
    ],
    onChange: (value) => {
      const inQuote = getEditor().isActive('blockquote');
      let command = chain();
      if (inQuote && value !== 'quote') command = command.unsetBlockquote();
      if (value === 'p') command = command.setParagraph();
      else if (value === 'quote') {
        command = command.setParagraph();
        if (!inQuote) command = command.setBlockquote();
      } else {
        command = command.setHeading({ level: Number(value.slice(1)) });
      }
      command.run();
    },
  });

  /* Font family + size */
  const fontSelect = createSelect({
    label: t('toolbar.fontFamily'),
    options: settings.editor.fonts.map((font) => ({ value: font.css, text: font.label })),
    onChange: (value) => {
      // Choosing the document default removes the mark instead of storing
      // it; empty blocks in the selection keep the choice as a pending seed.
      const isDefault = value === docFontDefaults().fontFamily;
      const command = chain();
      (isDefault ? command.unsetFontFamily() : command.setFontFamily(value))
        .seedPendingTextStyle({ fontFamily: isDefault ? null : value })
        .run();
    },
  });
  fontSelect.classList.add('toolbar-select--font');

  /* Font size (0.21.0, presets reworked in 0.23.1): free number input plus
     Word-style A−/A+ stepping. Enter/blur applies, Escape reverts; values
     snap to the half-point grid within the bounds. The preset list is our
     OWN dropdown on the ▾ button — the native datalist on number inputs is
     unreliable (Chromium prefix-filters against the prefilled value and then
     shows nothing; Firefox has no datalist UI on number inputs at all). */
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.className = 'toolbar-input toolbar-input--size';
  sizeInput.min = String(settings.editor.fontSizeMinPt);
  sizeInput.max = String(settings.editor.fontSizeMaxPt);
  sizeInput.step = '0.5';
  sizeInput.setAttribute('aria-label', t('toolbar.fontSize'));
  sizeInput.title = t('toolbar.fontSize');
  sizeInput.addEventListener('change', () =>
    applyFontSizePt(getEditor, Number.parseFloat(sizeInput.value))
  );
  sizeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sizeInput.blur(); // fires 'change' when the value differs
    } else if (event.key === 'Escape') {
      event.preventDefault();
      refresh();
      getEditor()?.commands.focus();
    }
  });

  const sizeBox = document.createElement('div');
  sizeBox.className = 'toolbar-dropdown toolbar-sizebox';
  const sizePresetsButton = createButton({
    icon: 'chevronDown', label: t('toolbar.fontSizePresets'),
  });
  sizePresetsButton.classList.add('toolbar-button--compact');
  sizeBox.append(sizeInput, sizePresetsButton);
  createDropdown({
    trigger: sizePresetsButton,
    panelClassName: 'toolbar-popover toolbar-popover--sizes',
    buildPanel(panel, close) {
      const current = currentFontSizePt(getEditor);
      for (const size of settings.editor.fontSizesPt) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className =
          'toolbar-popover-option' + (size === current ? ' is-active' : '');
        option.textContent = size.toLocaleString(getLanguage());
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.addEventListener('click', () => {
          applyFontSizePt(getEditor, size); // same rules as field, A−/A+, Strg+8/9
          close();
        });
        panel.append(option);
      }
    },
  });

  const sizeDecreaseButton = createButton({
    icon: 'fontSizeDecrease', label: t('toolbar.fontSizeDecrease'),
    shortcut: t('shortcut.fontSizeDecrease'),
    onClick: () => stepFontSize(getEditor, -1),
  });
  const sizeIncreaseButton = createButton({
    icon: 'fontSizeIncrease', label: t('toolbar.fontSizeIncrease'),
    shortcut: t('shortcut.fontSizeIncrease'),
    onClick: () => stepFontSize(getEditor, 1),
  });

  /* Clear formatting (feature 2) — Word keeps it in the font group too. */
  const clearFormatButton = createButton({
    icon: 'clearFormat', label: t('toolbar.clearFormat'), shortcut: t('shortcut.clearFormat'),
    onClick: () => chain().clearFormatting().run(),
  });

  /* Basic marks */
  const boldButton = createButton({
    icon: 'bold', label: t('toolbar.bold'), shortcut: t('shortcut.bold'),
    toggle: true, onClick: () => chain().toggleBold().run(),
  });
  const italicButton = createButton({
    icon: 'italic', label: t('toolbar.italic'), shortcut: t('shortcut.italic'),
    toggle: true, onClick: () => chain().toggleItalic().run(),
  });
  const underlineButton = createButton({
    icon: 'underline', label: t('toolbar.underline'), shortcut: t('shortcut.underline'),
    toggle: true, onClick: () => chain().toggleUnderline().run(),
  });
  const strikeButton = createButton({
    icon: 'strikethrough', label: t('toolbar.strike'), shortcut: t('shortcut.strike'),
    toggle: true, onClick: () => chain().toggleStrike().run(),
  });

  const subscriptButton = createButton({
    icon: 'subscript', label: t('toolbar.subscript'), shortcut: t('shortcut.subscript'),
    toggle: true, onClick: () => chain().toggleSubscript().run(),
  });
  const superscriptButton = createButton({
    icon: 'superscript', label: t('toolbar.superscript'), shortcut: t('shortcut.superscript'),
    toggle: true, onClick: () => chain().toggleSuperscript().run(),
  });

  /* Link (phase 7a): dialog + bubble live in ui/linkUi.js */
  const linkButton = createButton({
    icon: 'link', label: t('toolbar.link'), shortcut: t('shortcut.link'),
    toggle: true, onClick: () => actions.openLink?.(),
  });

  /* Colors */
  const textColor = createColorControl({
    icon: 'textColor',
    label: t('toolbar.textColor'),
    palette: settings.colors.text,
    resetText: t('color.automatic'),
    fallbackBar: 'var(--color-text)',
    getCurrent: () => getEditor().getAttributes('textStyle').color ?? null,
    onPick: (value) => chain().setColor(value).run(),
    onReset: () => chain().unsetColor().run(),
  });
  const highlightColor = createColorControl({
    icon: 'highlighter',
    label: t('toolbar.highlight'),
    shortcut: t('shortcut.highlight'),
    palette: settings.colors.highlight,
    resetText: t('highlight.none'),
    fallbackBar: 'transparent',
    getCurrent: () => getEditor().getAttributes('highlight').color ?? null,
    onPick: (value) => chain().setHighlight({ color: value }).run(),
    onReset: () => chain().unsetHighlight().run(),
  });

  /* Alignment */
  const alignmentButtons = ALIGNMENTS.map((alignment) => ({
    alignment,
    button: createButton({
      icon: 'align' + alignment[0].toUpperCase() + alignment.slice(1),
      label: t(`toolbar.align${alignment[0].toUpperCase() + alignment.slice(1)}`),
      shortcut: t(`shortcut.align${alignment[0].toUpperCase() + alignment.slice(1)}`),
      toggle: true,
      onClick: () => chain().setTextAlign(alignment).run(),
    }),
  }));

  /* Line & paragraph spacing */
  const spacingControl = createSpacingControl(getEditor, chain);

  /* Lists */
  const bulletButton = createButton({
    icon: 'bulletList', label: t('toolbar.bulletList'), shortcut: t('shortcut.bulletList'),
    toggle: true, onClick: () => chain().toggleBulletList().run(),
  });
  const orderedButton = createButton({
    icon: 'orderedList', label: t('toolbar.orderedList'), shortcut: t('shortcut.orderedList'),
    toggle: true, onClick: () => chain().toggleOrderedList().run(),
  });

  /* Indent (feature 2): outside lists ±1 level on the paragraph, inside
     lists the buttons change the list level (Word semantics, core/indent.js). */
  const outdentButton = createButton({
    icon: 'indentDecrease', label: t('toolbar.indentDecrease'), shortcut: t('shortcut.indentDecrease'),
    onClick: () => chain().decreaseIndent().run(),
  });
  const indentButton = createButton({
    icon: 'indentIncrease', label: t('toolbar.indentIncrease'), shortcut: t('shortcut.indentIncrease'),
    onClick: () => chain().increaseIndent().run(),
  });

  /* Manual page break (phase 7c): Word's Ctrl+Enter, refused inside tables
     (the command guard also drives the disabled state below). */
  const pageBreakButton = createButton({
    icon: 'pageBreak', label: t('toolbar.pageBreak'), shortcut: t('shortcut.pageBreak'),
    onClick: () => chain().insertPageBreak().run(),
  });

  /* Insert: table */
  const tableControl = createTableControl(getEditor, chain);

  /* Find & replace */
  const searchButton = createButton({
    icon: 'search', label: t('toolbar.search'), shortcut: t('shortcut.find'),
    onClick: () => actions.openSearch?.(),
  });

  /* Images */
  const imageButton = createButton({
    icon: 'image', label: t('toolbar.image'),
    onClick: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', () => {
        if (input.files?.length) insertImageFiles(getEditor(), input.files);
      });
      input.click();
    },
  });

  const hasLeading = leadingElements.length > 0;
  if (hasLeading) section({ fixed: true, withSeparator: false }, ...leadingElements);
  section({ fixed: true, withSeparator: hasLeading }, undoButton, redoButton);
  section({}, paragraphSelect);
  section({}, fontSelect, sizeBox, sizeDecreaseButton, sizeIncreaseButton, clearFormatButton);
  section({}, boldButton, italicButton, underlineButton, strikeButton, subscriptButton, superscriptButton, linkButton);
  section({}, textColor.element, highlightColor.element);
  section({}, ...alignmentButtons.map((entry) => entry.button), spacingControl);
  section({}, bulletButton, orderedButton, outdentButton, indentButton);
  section({}, imageButton, pageBreakButton, tableControl.element);
  section({}, searchButton);

  const overflow = createOverflowControl();
  root.replaceChildren(...sections.map((entry) => entry.el), overflow.wrap);

  /* One-line layout (0.23.0, compact stage 0.24.0) ---------------------------
     The toolbar never wraps. When the normal size stops fitting, everything
     shrinks one notch (`toolbar--compact`) — only when even that is not
     enough do sections move, rightmost first, into the "⋯" panel. Controls
     are MOVED, not cloned: listeners, refresh() bindings and nested
     dropdowns keep working inside the panel. */

  let layoutFrame = null;
  const measure = () => {
    // Fresh every pass (a dozen rects): widths change with the language,
    // select contents and the compact stage.
    const rootStyle = getComputedStyle(root);
    const available =
      root.clientWidth -
      Number.parseFloat(rootStyle.paddingLeft) -
      Number.parseFloat(rootStyle.paddingRight);
    const widths = sections.map((entry) => entry.el.getBoundingClientRect().width);
    return { available, widths, total: widths.reduce((sum, width) => sum + width, 0) };
  };
  const relayout = () => {
    // Everything back into the bar in original order; the panel's content
    // set is about to change, so it closes first.
    overflow.close();
    for (const entry of sections) root.insertBefore(entry.el, overflow.wrap);

    // Stage 1: everything fits at the normal size.
    root.classList.remove('toolbar--compact');
    let metrics = measure();
    if (metrics.total <= metrics.available) {
      overflow.wrap.hidden = true;
      return;
    }

    // Stage 2: the compact notch buys roughly 15 % width — on typical
    // screens the full bar then stays in one line down to about half the
    // screen width before anything has to leave.
    root.classList.add('toolbar--compact');
    metrics = measure();
    if (metrics.total <= metrics.available) {
      overflow.wrap.hidden = true;
      return;
    }

    // Stage 3: still too narrow — reserve room for the ⋯ button, keep
    // sections from the left until the budget is spent. Fixed sections
    // (file menu, undo/redo) always stay in the bar.
    overflow.wrap.hidden = false;
    const budget = metrics.available - overflow.wrap.getBoundingClientRect().width;
    let used = 0;
    let firstCollapsed = sections.length;
    for (let index = 0; index < sections.length; index += 1) {
      used += metrics.widths[index];
      if (!sections[index].fixed && used > budget) {
        firstCollapsed = index;
        break;
      }
    }
    if (firstCollapsed === sections.length) {
      // Only fixed sections overflow (absurdly narrow window) — nothing to
      // collapse, the button would open an empty panel.
      overflow.wrap.hidden = true;
      return;
    }
    for (let index = firstCollapsed; index < sections.length; index += 1) {
      overflow.panel.append(sections[index].el);
    }
  };
  const scheduleLayout = () => {
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      relayout();
    });
  };
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(root);
  relayout(); // synchronous first pass — no one-frame overflow flash

  /* State sync ------------------------------------------------------------ */

  const refresh = () => {
    const editor = getEditor();
    if (!editor) return;

    undoButton.disabled = !editor.can().undo();
    redoButton.disabled = !editor.can().redo();

    const activeLevel = settings.editor.headingLevels.find((level) =>
      editor.isActive('heading', { level })
    );
    paragraphSelect.value = editor.isActive('blockquote')
      ? 'quote'
      : activeLevel
        ? `h${activeLevel}`
        : 'p';

    const textStyle = editor.getAttributes('textStyle');
    const seeded = pendingTextStyleAt(editor.state) ?? {};
    const shownFamily = textStyle.fontFamily ?? seeded.fontFamily;
    fontSelect.value = settings.editor.fonts.some((font) => font.css === shownFamily)
      ? shownFamily
      : docFontDefaults().fontFamily;
    const sizePt = Number.parseFloat(textStyle.fontSize ?? seeded.fontSize);
    const shownPt = Number.isFinite(sizePt) ? sizePt : docFontDefaults().fontSizePt;
    if (document.activeElement !== sizeInput) sizeInput.value = String(shownPt);
    sizeDecreaseButton.disabled = shownPt <= settings.editor.fontSizeMinPt;
    sizeIncreaseButton.disabled = shownPt >= settings.editor.fontSizeMaxPt;

    setActive(boldButton, editor.isActive('bold'));
    setActive(italicButton, editor.isActive('italic'));
    setActive(underlineButton, editor.isActive('underline'));
    setActive(strikeButton, editor.isActive('strike'));
    setActive(subscriptButton, editor.isActive('subscript'));
    setActive(superscriptButton, editor.isActive('superscript'));
    setActive(linkButton, editor.isActive('link'));

    // TextAlign keeps defaultAlignment null → treat "no attribute" as left.
    const currentAlignment =
      ALIGNMENTS.find((alignment) => editor.isActive({ textAlign: alignment })) ?? 'left';
    for (const { alignment, button } of alignmentButtons) {
      setActive(button, alignment === currentAlignment);
    }

    pageBreakButton.disabled = !editor.can().insertPageBreak();

    setActive(bulletButton, editor.isActive('bulletList'));
    setActive(orderedButton, editor.isActive('orderedList'));
    // can() dry-runs the per-node stepping (and sink/lift inside lists) —
    // the buttons grey out at level 0 / indentMaxLevels automatically.
    outdentButton.disabled = !editor.can().decreaseIndent();
    indentButton.disabled = !editor.can().increaseIndent();
    setActive(tableControl.button, editor.isActive('table'));

    textColor.refresh();
    highlightColor.refresh();
  };

  const offRefresh = appState.on('editor:transaction', refresh);
  // Feature 8: a default-typeface change must repaint the font controls for
  // unmarked text (select + size field show the document default).
  const offDocSettings = appState.on('change:docSettings', refresh);
  refresh();

  return {
    /** Detach from the event bus — the chrome is rebuilt on language switch. */
    destroy() {
      offRefresh();
      offDocSettings();
      resizeObserver.disconnect();
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      overflow.close();
    },
  };
}
