import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { spellController } from '../../spell/controller';
import { isPaginating } from './pageBreaks';

export type Range = { from: number; to: number };
// dirty: what the edits since the last check touched, in the current document's positions.
type SpellState = { set: DecorationSet; dirty: Range[] };

const spellCheckKey = new PluginKey<SpellState>('spellCheck');

// 'all' checks the whole document (a new language or dictionary), 'dirty' the edited blocks.
const RECHECK_META = 'spellCheck/recheck';
type RecheckMode = 'all' | 'dirty';

// Re-check after the user pauses, so large docs stay responsive while typing.
const DEBOUNCE_MS = 400;

// A word is a letter run with internal apostrophes/hyphens only (don't,
// well-known) — never leading/trailing separators, so the checked token is
// exactly the highlighted range.
const WORD_RE = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;

// The misspelled words under `node`, whose content starts at `base` in the document.
function wordDecos(node: PmNode, base: number, decos: Decoration[]): void {
  node.descendants((child, pos) => {
    if (!child.isText) return;
    const text = child.text ?? '';
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const word = m[0];
      if (word.length < 2 || spellController.check(word)) continue;
      const from = base + pos + m.index;
      decos.push(Decoration.inline(from, from + word.length, { class: 'pm-spell-error' }));
    }
  });
}

function buildDecorations(doc: PmNode): DecorationSet {
  if (!spellController.isEnabled()) return DecorationSet.empty;
  const decos: Decoration[] = [];
  wordDecos(doc, 0, decos);
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

// Only the textblocks the dirty ranges touch are checked again: a word never crosses a
// block, and building the whole set walks every block for every squiggle (seconds on a
// long document), while add/remove of one block's few walks the blocks once.
function recheckBlocks(doc: PmNode, set: DecorationSet, dirty: Range[]): DecorationSet {
  if (!spellController.isEnabled()) return DecorationSet.empty;
  const blocks = new Map<number, PmNode>();
  for (const { from, to } of dirty) {
    if (from === to) {
      // A deletion leaves a point; nodesBetween finds nothing at a point.
      const $pos = doc.resolve(from);
      if ($pos.parent.isTextblock) blocks.set($pos.before(), $pos.parent);
      continue;
    }
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      blocks.set(pos, node);
      return false;
    });
  }
  const stale: Decoration[] = [];
  const decos: Decoration[] = [];
  for (const [pos, node] of blocks) {
    stale.push(...set.find(pos + 1, pos + node.nodeSize - 1));
    wordDecos(node, pos + 1, decos);
  }
  return set.remove(stale).add(doc, decos);
}

// What a transaction touched, in its final document's positions.
export function changedRanges(tr: Transaction): Range[] {
  const out: Range[] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => out.push({ from: rest.map(from, -1), to: rest.map(to, 1) }));
  });
  return out;
}

// The misspelled-word range covering `pos`, if any — used by the context menu.
export function spellErrorAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const set = spellCheckKey.getState(state)?.set;
  if (!set) return null;
  const found = set.find(pos, pos);
  return found.length ? { from: found[0].from, to: found[0].to } : null;
}

// The word covering `pos`, right or wrong — what the thesaurus looks up. Leaf nodes
// are one character wide here, so the text offsets stay the document's.
export function wordRangeAt(state: EditorState, pos: number): { from: number; to: number; word: string } | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const start = $pos.start();
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '￼');
  const offset = pos - start;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > offset) break;
    if (offset <= m.index + m[0].length) return { from: start + m.index, to: start + m.index + m[0].length, word: m[0] };
  }
  return null;
}

export const SpellCheck = Extension.create({
  name: 'spellCheck',

  addProseMirrorPlugins() {
    return [
      new Plugin<SpellState>({
        key: spellCheckKey,
        state: {
          init: () => ({ set: DecorationSet.empty, dirty: [] }),
          apply(tr: Transaction, old: SpellState, _oldState: EditorState, newState: EditorState) {
            const mode = tr.getMeta(RECHECK_META) as RecheckMode | undefined;
            if (mode === 'all') return { set: buildDecorations(newState.doc), dirty: [] };
            let { set, dirty } = old;
            if (tr.docChanged) {
              // Squiggles and dirty ranges stay glued to the text until the next check.
              set = set.map(tr.mapping, tr.doc);
              dirty = dirty
                .map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }))
                .concat(changedRanges(tr));
            }
            if (mode === 'dirty' && dirty.length) return { set: recheckBlocks(newState.doc, set, dirty), dirty: [] };
            return set === old.set && dirty === old.dirty ? old : { set, dirty };
          },
        },
        props: {
          decorations(state) {
            return spellCheckKey.getState(state)?.set;
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const recheck = (mode: RecheckMode) => {
            editorView.dispatch(editorView.state.tr.setMeta(RECHECK_META, mode));
          };
          const scheduleRecheck = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              recheck('dirty');
            }, DEBOUNCE_MS);
          };

          // The whole document is read in idle time: it costs half a second on a
          // 460-page one, and an opened file has it queued behind its own layout.
          const whenIdle = typeof requestIdleCallback === 'function'
            ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
            : (cb: () => void) => setTimeout(cb, 0);
          // A pagination pass redraws the view, so a check landing next to one pays for
          // that redraw too: it waits for the passes to stop instead.
          let allQueued = false;
          const recheckAll = () => {
            if (allQueued) return;
            allQueued = true;
            whenIdle(() => {
              allQueued = false;
              if (editorView.isDestroyed) return;
              if (isPaginating(editorView)) recheckAll();
              else recheck('all');
            });
          };

          // Language / personal-dictionary / ignore changes re-check the document.
          const unsubscribe = spellController.subscribe(recheckAll);
          // Initial pass in case the checker is already loaded at mount.
          recheckAll();

          return {
            update(view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) scheduleRecheck();
            },
            destroy() {
              if (timer !== undefined) clearTimeout(timer);
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
