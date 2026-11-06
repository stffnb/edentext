import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform';
import { spellController } from '../../spell/controller';
import { codeForTag, westLang, type DocumentLanguage } from '../../storage/documentLanguage';
import { isPaginating } from './pageBreaks';
import { ASIAN_SCRIPT_RE } from '../../utils/script';
import { detectLanguage } from '../../spell/detect.svelte';

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

// The dictionary a node is checked against: its run's language, else its block's, else
// the document's (language.ts carries both as full tags). Only the western language
// counts: a dictionary checks the text outside East Asian script.
function codeOf(tag: unknown): DocumentLanguage | undefined {
  const west = westLang(tag);
  return west ? codeForTag(west) ?? undefined : undefined;
}

export function langOf(node: PmNode, blockLang: DocumentLanguage | undefined): DocumentLanguage | undefined {
  return codeOf(node.marks.find((m) => m.type.name === 'textStyle')?.attrs.lang) ?? blockLang;
}

export function blockLangOf(node: PmNode): DocumentLanguage | undefined {
  return codeOf(node.attrs.lang);
}

// What a textblock is checked in: its own language, else the one it is detected in.
export function checkLangOf(node: PmNode): DocumentLanguage | undefined {
  return blockLangOf(node) ?? detectLanguage(node);
}

// The misspelled words under `node`, whose content starts at `base` in the document.
// A block's language holds for its own text only, never for the blocks after it.
function wordDecos(node: PmNode, base: number, decos: Decoration[], outerLang?: DocumentLanguage): void {
  let blockLang = outerLang;
  node.descendants((child, pos) => {
    if (child.isTextblock) blockLang = checkLangOf(child) ?? outerLang;
    if (!child.isText || child.marks.some((m) => m.type.name === 'deletion')) return;
    const text = child.text ?? '';
    const code = langOf(child, blockLang);
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const word = m[0];
      // East Asian script is in the asian language, which no dictionary here checks.
      if (word.length < 2 || ASIAN_SCRIPT_RE.test(word) || spellController.check(word, code)) continue;
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
    wordDecos(node, pos + 1, decos, checkLangOf(node));
  }
  return set.remove(stale).add(doc, decos);
}

// What a transaction touched, in its final document's positions: one span around all of
// it, carried through the maps once, since mapping each change through every later map is
// quadratic in steps (seconds for a format change across a long document).
export function changedRanges(tr: Transaction): Range[] {
  let lo = Infinity, hi = -Infinity;
  tr.mapping.maps.forEach((map, i) => {
    if (lo <= hi) { lo = map.map(lo, -1); hi = map.map(hi, 1); }
    map.forEach((_oldFrom, _oldTo, from, to) => { lo = Math.min(lo, from); hi = Math.max(hi, to); });
    // A mark step moves nothing, so its map is empty, yet a run's language may have changed.
    const step = tr.steps[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) { lo = Math.min(lo, step.from); hi = Math.max(hi, step.to); }
  });
  return lo <= hi ? [{ from: lo, to: hi }] : [];
}

// Squiggles are painted as CSS highlights, not inline decorations: Chromium's hyphenating
// line breaker pulls back one word too many where a word ends an element and its space
// sits outside it, and a decoration span around every flagged word is exactly that.
export const HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS;

// Paints `setOf`'s ranges into the highlight `name` (styled as ::highlight(name)) once a
// frame after any view update. A textblock whose node, squiggle offsets and DOM are all
// unchanged keeps its ranges: domAtPos walks from the root and costs ~15 ms per 1000 squiggles.
// Only top-level blocks from a screen above to two below the viewport are painted, repainted
// on scroll: Chromium re-reads every range of a highlight on a change (~50 ms a key at 60 000).
export function paintHighlight(view: EditorView, name: string, setOf: (state: EditorState) => DecorationSet | undefined) {
  if (!HIGHLIGHTS) return { update() {}, destroy() {} };
  const highlight = CSS.highlights.get(name) ?? new Highlight();
  CSS.highlights.set(name, highlight);
  type Block = { offsets: number[]; ranges: StaticRange[] };
  let blocks = new Map<PmNode, Block>();
  // A node twice in the document (shared on paste) is painted afresh each time, never cached.
  let loose: StaticRange[] = [];
  let frame = 0;
  const drop = () => {
    for (const r of loose) highlight.delete(r);
    for (const b of blocks.values()) for (const r of b.ranges) highlight.delete(r);
  };
  // The document span of the top-level blocks near the viewport, found by bisecting their rects.
  // A page-grid cell is the view's viewport: the view scrolls along with it, so the span
  // stays put while the grid scrolls instead of changing the highlight on every frame.
  const nearView = (doc: PmNode): [number, number] => {
    const starts: number[] = [];
    doc.forEach((_, offset) => starts.push(offset));
    const cell = (view.dom as HTMLElement).closest('.page-cell')?.getBoundingClientRect();
    const top = cell?.top ?? 0, h = cell?.height ?? window.innerHeight;
    const rect = (i: number) => (view.nodeDOM(starts[i]) as Element | null)?.getBoundingClientRect?.();
    const bisect = (lo: number, before: (r: DOMRect) => boolean) => {
      for (let hi = starts.length; lo < hi;) {
        const mid = (lo + hi) >> 1, r = rect(mid);
        if (!r) return -1;
        if (before(r)) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    const first = bisect(0, (r) => r.bottom < top - h);
    const last = first < 0 ? -1 : bisect(first, (r) => r.top <= top + 2 * h);
    if (last < 0) return [0, doc.content.size];
    return [starts[first] ?? doc.content.size, starts[last] ?? doc.content.size];
  };
  const paint = () => {
    frame = 0;
    const next = new Map<PmNode, Block>();
    const nextLoose: StaticRange[] = [];
    const { doc } = view.state;
    const decos = view.isDestroyed ? [] : setOf(view.state)?.find(...nearView(doc)) ?? [];
    for (let i = 0; i < decos.length;) {
      const $from = doc.resolve(decos[i].from);
      const node = $from.parent, start = $from.start(), end = $from.end();
      const offsets: number[] = [];
      const inBlock: Decoration[] = [];
      for (; i < decos.length && decos[i].from <= end; i++) {
        inBlock.push(decos[i]);
        offsets.push(decos[i].from - start, decos[i].to - start);
      }
      const old = blocks.get(node);
      if (old && !next.has(node) && old.offsets.join() === offsets.join()
        && old.ranges.every((r) => r.startContainer.isConnected && r.endContainer.isConnected)) {
        next.set(node, old);
        blocks.delete(node);
        continue;
      }
      const ranges = inBlock.map((d) => {
        const from = view.domAtPos(d.from), to = view.domAtPos(d.to);
        const r = new StaticRange({ startContainer: from.node, startOffset: from.offset, endContainer: to.node, endOffset: to.offset });
        highlight.add(r);
        return r;
      });
      if (next.has(node)) nextLoose.push(...ranges);
      else next.set(node, { offsets, ranges });
    }
    drop();
    blocks = next;
    loose = nextLoose;
  };
  const update = () => { frame ||= requestAnimationFrame(paint); };
  window.addEventListener('scroll', update, { capture: true, passive: true });
  window.addEventListener('resize', update);
  update();
  return {
    update,
    destroy() {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
      drop();
    },
  };
}

// The misspelled-word range covering `pos`, if any — used by the context menu.
export function spellErrorAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const set = spellCheckKey.getState(state)?.set;
  if (!set) return null;
  const found = set.find(pos, pos);
  return found.length ? { from: found[0].from, to: found[0].to } : null;
}

// The dictionary in force at `pos` — the run's language, else the block's, else the
// document's. Used by the context menu and the grammar check.
export function spellLangAt(state: EditorState, pos: number): DocumentLanguage | undefined {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return undefined;
  const node = $pos.nodeAfter ?? $pos.nodeBefore;
  return (node ? codeOf(node.marks.find((m) => m.type.name === 'textStyle')?.attrs.lang) : undefined)
    ?? checkLangOf($pos.parent);
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
            return HIGHLIGHTS ? null : spellCheckKey.getState(state)?.set;
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
          const painter = paintHighlight(editorView, 'spell-error', (s) => spellCheckKey.getState(s)?.set);

          return {
            update(view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) scheduleRecheck();
              painter.update();
            },
            destroy() {
              painter.destroy();
              if (timer !== undefined) clearTimeout(timer);
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
