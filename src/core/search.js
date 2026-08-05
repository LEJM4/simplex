// src/core/search.js
// ---------------------------------------------------------------------------
// Find & replace as a Tiptap extension around one ProseMirror plugin.
//
// Matching walks every textblock and builds a segment map (string offset →
// document position) so matches survive mark boundaries ("Wo**rt**" finds
// "Wort") while hard breaks act as unmatchable placeholders. All matches get
// an inline decoration; the active one an extra class. The document position
// math lives in findMatches(), exported for tests.
//
// Commands: setSearch, clearSearch, findNext, findPrevious,
// replaceCurrent, replaceAll. The panel UI (ui/searchPanel.js) reads the
// plugin state via `searchKey.getState(editor.state)` for the match counter.
// ---------------------------------------------------------------------------

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const searchKey = new PluginKey('sw-search');

/** All matches of `query` as { from, to } document ranges. */
export function findMatches(doc, query, caseSensitive = false) {
  const matches = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    // Segment map: which string offsets correspond to which doc positions.
    // Non-text inline nodes (hard breaks) become an object-replacement char
    // that can never match, so no match crosses them.
    let text = '';
    const segments = [];
    node.content.forEach((child, offset) => {
      if (child.isText) {
        segments.push({
          from: text.length,
          to: text.length + child.text.length,
          pos: pos + 1 + offset,
        });
        text += child.text;
      } else {
        text += '\uFFFC';
      }
    });

    const toPos = (index) => {
      for (const segment of segments) {
        if (index >= segment.from && index <= segment.to) {
          return segment.pos + (index - segment.from);
        }
      }
      return null;
    };

    const haystack = caseSensitive ? text : text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const from = toPos(index);
      const to = toPos(index + needle.length);
      if (from !== null && to !== null) matches.push({ from, to });
      index = haystack.indexOf(needle, index + 1);
    }
    return false; // inline content handled above — do not descend further
  });

  return matches;
}

function buildDecorations(doc, matches, active) {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === active ? 'search-match search-match-active' : 'search-match',
      })
    )
  );
}

export const Search = Extension.create({
  name: 'swSearch',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: () => ({
            query: '',
            caseSensitive: false,
            matches: [],
            active: -1,
            decorations: DecorationSet.empty,
          }),
          apply(tr, previous, _oldState, newState) {
            const meta = tr.getMeta(searchKey);
            if (!meta && !(tr.docChanged && previous.query)) return previous;

            const next = { ...previous, ...(meta ?? {}) };
            const queryChanged =
              meta &&
              (meta.query !== undefined || meta.caseSensitive !== undefined);
            if (queryChanged) next.active = meta.active ?? -1;

            if (queryChanged || tr.docChanged) {
              next.matches = findMatches(newState.doc, next.query, next.caseSensitive);
              if (next.active >= next.matches.length) next.active = -1;
            }
            next.decorations = buildDecorations(newState.doc, next.matches, next.active);
            return next;
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state).decorations;
          },
        },
      }),
    ];
  },

  addCommands() {
    const selectMatch = (index) => ({ state, tr, dispatch }) => {
      const pluginState = searchKey.getState(state);
      const match = pluginState.matches[index];
      if (!match) return false;
      if (dispatch) {
        tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
        tr.setMeta(searchKey, { active: index });
        tr.scrollIntoView();
        dispatch(tr);
      }
      return true;
    };

    return {
      setSearch:
        ({ query, caseSensitive = false }) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query, caseSensitive, active: -1 }));
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { query: '', active: -1 }));
          return true;
        },

      findNext:
        () =>
        ({ state, ...rest }) => {
          const pluginState = searchKey.getState(state);
          if (pluginState.matches.length === 0) return false;
          const from = state.selection.to;
          let index = pluginState.matches.findIndex((match) => match.from >= from);
          if (index === -1) index = 0; // wrap around
          return selectMatch(index)({ state, ...rest });
        },

      findPrevious:
        () =>
        ({ state, ...rest }) => {
          const pluginState = searchKey.getState(state);
          if (pluginState.matches.length === 0) return false;
          const to = state.selection.from;
          let index = -1;
          for (let i = pluginState.matches.length - 1; i >= 0; i -= 1) {
            if (pluginState.matches[i].to <= to) { index = i; break; }
          }
          if (index === -1) index = pluginState.matches.length - 1; // wrap
          return selectMatch(index)({ state, ...rest });
        },

      /** Replace the ACTIVE match (UI navigates first, then replaces). */
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const pluginState = searchKey.getState(state);
          const match = pluginState.matches[pluginState.active];
          if (!match) return false;
          if (dispatch) {
            tr.insertText(replacement, match.from, match.to);
            tr.setMeta(searchKey, { active: -1 });
            dispatch(tr);
          }
          return true;
        },

      /** Replace every match in one transaction (one undo step). */
      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const pluginState = searchKey.getState(state);
          if (pluginState.matches.length === 0) return false;
          if (dispatch) {
            for (let i = pluginState.matches.length - 1; i >= 0; i -= 1) {
              const match = pluginState.matches[i];
              tr.insertText(replacement, match.from, match.to);
            }
            tr.setMeta(searchKey, { active: -1 });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
