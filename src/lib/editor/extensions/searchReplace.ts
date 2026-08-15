import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode, Schema } from '@tiptap/pm/model';
import { blockStyleName } from './paragraphStyle';
import type { StyleSheet } from '../../styles/styleSheet';

// Find & Replace: highlights all matches via decorations, navigates/replaces via commands.
// Pure editor feature — never touches the document model beyond the actual replacements.

// What a search asks of a match beyond its text, and what a replacement applies to it —
// both dialogs search and replace formatting on its own (LibreOffice's Format… and its
// Paragraph Styles box). With no search term the formatting *is* the search.
export type FormatSpec = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  style?: string;
  /** The three TextStyle attrs, the rest of what LibreOffice's Format… dialog sets. */
  font?: string;
  sizePt?: number;
  color?: string;
};

export const FORMAT_MARKS = ['bold', 'italic', 'underline'] as const;

const markNames = (f?: FormatSpec): string[] => FORMAT_MARKS.filter((m) => f?.[m]);

// The TextStyle attrs a spec asks for, in the attr names the mark carries them under.
function textStyleAttrs(f?: FormatSpec): Record<string, string> {
  const out: Record<string, string> = {};
  if (f?.font) out.fontFamily = f.font;
  if (f?.sizePt) out.fontSize = `${f.sizePt}pt`;
  if (f?.color) out.color = f.color;
  return out;
}

export const hasFormat = (f?: FormatSpec): boolean =>
  !!f && (!!f.style || markNames(f).length > 0 || Object.keys(textStyleAttrs(f)).length > 0);

const ptOf = (v: unknown): number | null => {
  const m = /^(-?[\d.]+)\s*(pt|px)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? (m[2] === 'px' ? (n * 72) / 96 : n) : null;
};

const sameColor = (a: unknown, b: string): boolean =>
  String(a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

// Whether one run carries everything the spec asks of it: the marks, and the TextStyle
// attrs compared by value rather than by string (12pt and 12.0pt are one size).
function runMatches(marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[], f: FormatSpec, wanted: string[]): boolean {
  if (!wanted.every((m) => marks.some((k) => k.type.name === m))) return false;
  const ts = marks.find((m) => m.type.name === 'textStyle')?.attrs ?? {};
  if (f.font && String(ts.fontFamily ?? '').toLowerCase() !== f.font.toLowerCase()) return false;
  if (f.sizePt) {
    const pt = ptOf(ts.fontSize);
    if (pt == null || Math.abs(pt - f.sizePt) > 0.01) return false;
  }
  if (f.color && !sameColor(ts.color, f.color)) return false;
  return true;
}

export interface SearchOptions {
  term: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  format?: FormatSpec;
}
// `groups` is the match's captures, so a regex replacement can expand $1…$9 (LibreOffice's
// syntax; Word has no such thing).
interface Match { from: number; to: number; groups: string[] }
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

export function buildSearchRegex(term: string, matchCase: boolean, wholeWord: boolean, useRegex = false): RegExp | null {
  if (!term) return null;
  // A user pattern is wrapped, not escaped — the whole-word guard then bounds it.
  let pat = useRegex ? (wholeWord ? `(?:${term})` : term) : escapeRegExp(term);
  if (wholeWord) pat = `\\b${pat}\\b`;
  try { return new RegExp(pat, matchCase ? 'g' : 'gi'); }
  catch { return null; }
}

// $1…$9 and $& in a replacement, filled from one match's captures. Anything the pattern
// did not capture expands to nothing, as it does in LibreOffice.
export function expandGroups(text: string, groups: string[]): string {
  return text.replace(/\$([1-9]|&)/g, (_, k: string) => (k === '&' ? groups[0] : groups[Number(k)]) ?? '');
}

// All [start, end) char ranges of a global regex in `text`, with each match's captures
// (skips zero-width matches).
export function regexRanges(text: string, re: RegExp): [number, number, string[]][] {
  const out: [number, number, string[]][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push([m.index, m.index + m[0].length, [...m]]);
  }
  return out;
}

// Matches within each textblock, mapped to doc positions. Matches span runs/marks but
// never block boundaries (each textblock is searched on its own concatenated text).
// A format narrows a text search to the runs carrying it; without a term, those runs —
// or, where only a style is asked for, the whole paragraph — are the matches.
function findMatches(doc: PmNode, re: RegExp | null, format?: FormatSpec): Match[] {
  const wanted = markNames(format);
  if (!re && !hasFormat(format)) return [];
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (format?.style && blockStyleName(node) !== format.style) return false;
    let text = '';
    const map: number[] = []; // map[i] = doc position of char i
    const ok: boolean[] = []; // ok[i] = char i carries every mark the search asks for
    node.forEach((child, offset) => {
      const marked = !format || runMatches(child.marks, format, wanted);
      if (child.isText) {
        const t = child.text ?? '';
        for (let k = 0; k < t.length; k++) { text += t[k]; map.push(pos + 1 + offset + k); ok.push(marked); }
      } else {
        text += '￿'; // inline atom (image/hardBreak): one non-matching slot
        map.push(pos + 1 + offset);
        ok.push(false);
      }
    });
    if (re) {
      for (const [s, e, groups] of regexRanges(text, re)) {
        if (ok.slice(s, e).some((v) => !v)) continue;
        matches.push({ from: map[s], to: map[e - 1] + 1, groups });
      }
    } else if (wanted.length || Object.keys(textStyleAttrs(format)).length) {
      for (let i = 0; i < ok.length; i++) {
        if (!ok[i]) continue;
        let j = i;
        while (j < ok.length && ok[j]) j++;
        matches.push({ from: map[i], to: map[j - 1] + 1, groups: [text.slice(i, j)] });
        i = j;
      }
    } else {
      // Style alone: the paragraph itself is the match, empty ones included.
      matches.push({ from: pos + 1, to: pos + 1 + node.content.size, groups: [text] });
    }
    return false;
  });
  return matches;
}

// A replacement's own formatting, applied over the range it landed in.
function applyFormat(tr: Transaction, schema: Schema, from: number, to: number, fmt: FormatSpec, sheet: StyleSheet): void {
  for (const name of markNames(fmt)) {
    const type = schema.marks[name];
    if (type) tr.addMark(from, to, type.create());
  }
  // TextStyle carries font, size and colour together, and a mark of one type replaces
  // the mark of that type whole — so each run's own attrs are the base of the new one.
  const patch = textStyleAttrs(fmt);
  const ts = schema.marks.textStyle;
  if (ts && Object.keys(patch).length) {
    const runs: { from: number; to: number; attrs: Record<string, unknown> }[] = [];
    tr.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      runs.push({
        from: Math.max(pos, from),
        to: Math.min(pos + node.nodeSize, to),
        attrs: { ...(node.marks.find((m) => m.type === ts)?.attrs ?? {}), ...patch },
      });
      return false;
    });
    for (const run of runs) if (run.to > run.from) tr.addMark(run.from, run.to, ts.create(run.attrs));
  }
  if (!fmt.style) return;
  // A heading style also switches the node type, as setParagraphStyle does; anything
  // else turns a heading back into a paragraph.
  const level = sheet.paragraph[fmt.style]?.outlineLevel;
  const type = level && schema.nodes.heading ? schema.nodes.heading : schema.nodes.paragraph;
  const blocks: { pos: number; node: PmNode }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === 'paragraph' || node.type.name === 'heading') blocks.push({ pos, node });
    return false;
  });
  for (const b of blocks) {
    tr.setNodeMarkup(b.pos, type, { ...b.node.attrs, styleName: fmt.style, ...(level ? { level } : {}) });
  }
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

const EMPTY: SearchState = { term: '', matchCase: false, wholeWord: false, useRegex: false, format: {}, matches: [], current: -1, deco: DecorationSet.empty };

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

// One match rewritten in `tr`, returning the position the replacement ends at. An empty
// replacement text with a format keeps the text: that is how both dialogs reformat a
// document without retyping it.
function replaceOne(
  tr: Transaction,
  state: EditorState,
  m: Match,
  text: string,
  useRegex: boolean,
  format: FormatSpec | undefined,
  sheet: StyleSheet,
): number {
  const out = useRegex ? expandGroups(text, m.groups) : text;
  let to = m.to;
  if (out || !hasFormat(format)) {
    // Marks of the first matched char (resolving at m.from would read the
    // boundary before the match, i.e. the preceding run's formatting).
    const marks = state.doc.resolve(Math.min(m.from + 1, m.to)).marks();
    if (out) tr.replaceWith(m.from, m.to, state.schema.text(out, marks));
    else tr.delete(m.from, m.to);
    to = m.from + out.length;
  }
  if (format) applyFormat(tr, state.schema, m.from, to, format, sheet);
  return to;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearch: (opts: SearchOptions) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      scrollToCurrent: () => ReturnType;
      replaceCurrent: (text: string, format?: FormatSpec) => ReturnType;
      replaceAll: (text: string, format?: FormatSpec) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

export const SearchReplace = Extension.create<{ sheet: () => StyleSheet }>({
  name: 'searchReplace',

  addOptions() {
    return { sheet: () => ({ paragraph: {}, character: {}, table: {} }) };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, old: SearchState, _oldState: EditorState, newState: EditorState): SearchState {
            const set = tr.getMeta(SET_SEARCH) as SearchOptions | undefined;
            if (set) {
              const matches = findMatches(newState.doc, buildSearchRegex(set.term, set.matchCase, set.wholeWord, set.useRegex), set.format);
              const current = pickCurrent(matches, newState.selection.from);
              return { ...set, matches, current, deco: buildDeco(newState.doc, matches, current) };
            }
            const cur = tr.getMeta(SET_CURRENT) as number | undefined;
            if (cur !== undefined) return { ...old, current: cur, deco: buildDeco(newState.doc, old.matches, cur) };
            if (tr.docChanged && (old.term || hasFormat(old.format))) {
              const matches = findMatches(newState.doc, buildSearchRegex(old.term, old.matchCase, old.wholeWord, old.useRegex), old.format);
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
      replaceCurrent: (text: string, format?: FormatSpec) => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s || s.current < 0 || !s.matches.length) return false;
        const m = s.matches[s.current];
        if (dispatch) {
          const tr = state.tr;
          const end = replaceOne(tr, state, m, text, s.useRegex, format, this.options.sheet());
          // Land the cursor after the replacement so the recompute picks the next match.
          tr.setSelection(TextSelection.create(tr.doc, end));
          tr.scrollIntoView();
          dispatch(tr);
        }
        return true;
      },
      replaceAll: (text: string, format?: FormatSpec) => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s || !s.matches.length) return false;
        if (dispatch) {
          const tr = state.tr;
          // Reverse order so earlier positions stay valid as we splice.
          for (let i = s.matches.length - 1; i >= 0; i--) {
            replaceOne(tr, state, s.matches[i], text, s.useRegex, format, this.options.sheet());
          }
          dispatch(tr);
        }
        return true;
      },
      clearSearch: () => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (dispatch) dispatch(state.tr.setMeta(SET_SEARCH, { term: '', matchCase: s?.matchCase ?? false, wholeWord: s?.wholeWord ?? false, useRegex: s?.useRegex ?? false }));
        return true;
      },
    };
  },
});
