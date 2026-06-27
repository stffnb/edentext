import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';

// Find & Replace: highlights all matches via decorations, navigates/replaces via commands.
// Pure editor feature — never touches the document model beyond the actual replacements.

export interface SearchOptions { term: string; matchCase: boolean; wholeWord: boolean; }
interface Match { from: number; to: number; }
interface SearchState extends SearchOptions {
  matches: Match[];
  current: number; // index into matches, or -1
  deco: DecorationSet;
}

export const searchKey = new PluginKey<SearchState>('searchReplace');
const SET_SEARCH = 'searchReplace/setSearch';
const SET_CURRENT = 'searchReplace/setCurrent';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSearchRegex(term: string, matchCase: boolean, wholeWord: boolean): RegExp | null {
  if (!term) return null;
  let pat = escapeRegExp(term);
  if (wholeWord) pat = `\\b${pat}\\b`;
  try { return new RegExp(pat, matchCase ? 'g' : 'gi'); }
  catch { return null; }
}

// All [start, end) char ranges of a global regex in `text` (skips zero-width matches).
export function regexRanges(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Matches within each textblock, mapped to doc positions. Matches span runs/marks but
// never block boundaries (each textblock is searched on its own concatenated text).
function findMatches(doc: PmNode, re: RegExp | null): Match[] {
  if (!re) return [];
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = []; // map[i] = doc position of char i
    node.forEach((child, offset) => {
      if (child.isText) {
        const t = child.text ?? '';
        for (let k = 0; k < t.length; k++) { text += t[k]; map.push(pos + 1 + offset + k); }
      } else {
        text += '￿'; // inline atom (image/hardBreak): one non-matching slot
        map.push(pos + 1 + offset);
      }
    });
    for (const [s, e] of regexRanges(text, re)) matches.push({ from: map[s], to: map[e - 1] + 1 });
    return false;
  });
  return matches;
}

function buildDeco(doc: PmNode, matches: Match[], current: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'search-match search-match-current' : 'search-match' }),
  ));
}

// First match at/after the cursor (wraps to the first match), or -1 when none.
function pickCurrent(matches: Match[], selFrom: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex(m => m.from >= selFrom);
  return i === -1 ? 0 : i;
}

const EMPTY: SearchState = { term: '', matchCase: false, wholeWord: false, matches: [], current: -1, deco: DecorationSet.empty };

// Match count + current index for the toolbar UI (FindReplaceBar.svelte).
export function getSearchState(state: EditorState): { count: number; current: number; term: string } {
  const s = searchKey.getState(state);
  return { count: s?.matches.length ?? 0, current: s?.current ?? -1, term: s?.term ?? '' };
}

function moveCurrent(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: 1 | -1): boolean {
  const s = searchKey.getState(state);
  if (!s || !s.matches.length) return false;
  const n = s.matches.length;
  const idx = s.current < 0 ? (dir > 0 ? 0 : n - 1) : (s.current + dir + n) % n;
  const m = s.matches[idx];
  if (dispatch) {
    const tr = state.tr.setMeta(SET_CURRENT, idx);
    tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
    tr.scrollIntoView();
    dispatch(tr);
  }
  return true;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (opts: SearchOptions) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      scrollToCurrent: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, old: SearchState, _oldState: EditorState, newState: EditorState): SearchState {
            const set = tr.getMeta(SET_SEARCH) as SearchOptions | undefined;
            if (set) {
              const matches = findMatches(newState.doc, buildSearchRegex(set.term, set.matchCase, set.wholeWord));
              const current = pickCurrent(matches, newState.selection.from);
              return { ...set, matches, current, deco: buildDeco(newState.doc, matches, current) };
            }
            const cur = tr.getMeta(SET_CURRENT) as number | undefined;
            if (cur !== undefined) return { ...old, current: cur, deco: buildDeco(newState.doc, old.matches, cur) };
            if (tr.docChanged && old.term) {
              const matches = findMatches(newState.doc, buildSearchRegex(old.term, old.matchCase, old.wholeWord));
              const current = pickCurrent(matches, newState.selection.from);
              return { ...old, matches, current, deco: buildDeco(newState.doc, matches, current) };
            }
            return old;
          },
        },
        props: {
          decorations(state) { return searchKey.getState(state)?.deco; },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearch: (opts: SearchOptions) => ({ state, dispatch }) => {
        if (dispatch) dispatch(state.tr.setMeta(SET_SEARCH, opts));
        return true;
      },
      findNext: () => ({ state, dispatch }) => moveCurrent(state, dispatch, 1),
      findPrevious: () => ({ state, dispatch }) => moveCurrent(state, dispatch, -1),
      scrollToCurrent: () => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s || s.current < 0) return false;
        const m = s.matches[s.current];
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView());
        return true;
      },
      replaceCurrent: (text: string) => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s || s.current < 0 || !s.matches.length) return false;
        const m = s.matches[s.current];
        if (dispatch) {
          // Marks of the first matched char (resolving at m.from would read the
          // boundary before the match, i.e. the preceding run's formatting).
          const marks = state.doc.resolve(m.from + 1).marks();
          const tr = state.tr;
          if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
          else tr.delete(m.from, m.to);
          // Land the cursor after the replacement so the recompute picks the next match.
          tr.setSelection(TextSelection.create(tr.doc, m.from + text.length));
          tr.scrollIntoView();
          dispatch(tr);
        }
        return true;
      },
      replaceAll: (text: string) => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s || !s.matches.length) return false;
        if (dispatch) {
          const tr = state.tr;
          // Reverse order so earlier positions stay valid as we splice.
          for (let i = s.matches.length - 1; i >= 0; i--) {
            const m = s.matches[i];
            const marks = state.doc.resolve(m.from + 1).marks();
            if (text) tr.replaceWith(m.from, m.to, state.schema.text(text, marks));
            else tr.delete(m.from, m.to);
          }
          dispatch(tr);
        }
        return true;
      },
      clearSearch: () => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (dispatch) dispatch(state.tr.setMeta(SET_SEARCH, { term: '', matchCase: s?.matchCase ?? false, wholeWord: s?.wholeWord ?? false }));
        return true;
      },
    };
  },
});
