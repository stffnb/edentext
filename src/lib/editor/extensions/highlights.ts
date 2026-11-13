import { Plugin, type EditorState } from '@tiptap/pm/state';
import type { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';

type SetOf = (state: EditorState) => DecorationSet | null | undefined;

// Marks that come and go without a document change are painted as CSS highlights: an
// element boundary inside or right after a word changes how Chromium and WebKit hyphenate
// and break its line, which pagination, measuring only on edits, would not see.
export const HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS;

// Paints `setOf`'s ranges into the highlight `name` (styled as ::highlight(name)) once a
// frame after any view update. A textblock whose node, squiggle offsets and DOM are all
// unchanged keeps its ranges: domAtPos walks from the root and costs ~15 ms per 1000 squiggles.
// Only top-level blocks from a screen above to two below the viewport are painted, repainted
// on scroll: Chromium re-reads every range of a highlight on a change (~50 ms a key at 60 000).
export function paintHighlight(view: EditorView, name: string, setOf: SetOf, priority = 0) {
  if (!HIGHLIGHTS) return { update() {}, destroy() {} };
  const highlight = CSS.highlights.get(name) ?? new Highlight();
  highlight.priority = priority;
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
    const set = view.isDestroyed ? null : setOf(view.state);
    const [from, to] = nearView(doc);
    let decos = set?.find(from, to) ?? [];
    // Footnotes stand on their own pages but hang from the note section at the end.
    const notes = doc.lastChild?.type.name === 'noteSection' ? doc.content.size - doc.lastChild.nodeSize : -1;
    if (set && notes >= to) decos = decos.concat(set.find(notes, doc.content.size));
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

// A plugin drawing `setOf`'s inline decorations as the highlight `name`, or as the
// decorations themselves where the browser has no CSS.highlights. A higher `priority`
// paints over a lower one where two highlights overlap.
export function highlightPlugin(name: string, setOf: SetOf, priority = 0): Plugin {
  return new Plugin({
    props: { decorations: (state) => (HIGHLIGHTS ? null : setOf(state)) },
    view: (view) => paintHighlight(view, name, setOf, priority),
  });
}
