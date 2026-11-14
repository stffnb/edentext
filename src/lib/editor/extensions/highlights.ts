import { Plugin, type EditorState } from '@tiptap/pm/state';
import type { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { coverRange, textsIn } from './overlay';

type SetOf = (state: EditorState) => DecorationSet | null | undefined;

// Marks that come and go without a document change are painted as CSS highlights: an
// element boundary inside or right after a word changes how Chromium and WebKit hyphenate
// and break its line, which pagination, measuring only on edits, would not see.
export const HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS;

// WebKit draws every text line under a highlight in the highlight's colour and style (a
// struck word's line in the squiggle's red), so there a range over such text is an overlay.
const RESTYLES_LINES = HIGHLIGHTS && /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\//.test(navigator.userAgent);

const hasLines = (range: AbstractRange, root: Element) => textsIn(range).some(({ node }) => {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (getComputedStyle(el).textDecorationLine !== 'none') return true;
  }
  return false;
});

// Paints `setOf`'s ranges into the highlight `name` (styled as ::highlight(name)) once a
// frame after any view update. A textblock whose node, squiggle offsets and DOM are all
// unchanged keeps its ranges: domAtPos walks from the root and costs ~15 ms per 1000 squiggles.
// Only top-level blocks from a screen above to two below the viewport are painted: Chromium
// re-reads every range of a highlight on a change (~50 ms a key at 60 000). A scroll only
// adds, as WebKit repaints the whole document per change; a view update drops the rest.
export function paintHighlight(view: EditorView, name: string, setOf: SetOf, priority = 0) {
  if (!HIGHLIGHTS) return { update() {}, destroy() {} };
  const highlight = CSS.highlights.get(name) ?? new Highlight();
  highlight.priority = priority;
  CSS.highlights.set(name, highlight);
  type Block = { offsets: number[]; ranges: StaticRange[]; over: StaticRange[] };
  let blocks = new Map<PmNode, Block>();
  // A node twice in the document (shared on paste) is painted afresh each time, never cached.
  let loose: StaticRange[] = [];
  let looseOver: StaticRange[] = [];
  let covers: HTMLElement[] = [];
  let frame = 0;
  const drop = () => {
    for (const r of loose) highlight.delete(r);
    for (const b of blocks.values()) for (const r of b.ranges) highlight.delete(r);
  };
  const cover = () => {
    for (const el of covers) el.remove();
    covers = [];
    const make = () => {
      const el = document.createElement('div');
      el.className = 'pm-highlight-cover';
      el.dataset.highlight = name;
      return el;
    };
    for (const r of [...looseOver, ...[...blocks.values()].flatMap((b) => b.over)]) {
      covers.push(...coverRange(view, r, make));
    }
  };
  // The document span of the top-level blocks near the viewport, found by bisecting their rects.
  // A page-grid cell is the view's viewport: the view scrolls along with it, so the span
  // stays put while the grid scrolls instead of changing the highlight on every frame.
  const nearView = (doc: PmNode, above = 1, below = 2): [number, number] => {
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
    const first = bisect(0, (r) => r.bottom < top - above * h);
    const last = first < 0 ? -1 : bisect(first, (r) => r.top <= top + below * h);
    if (last < 0) return [0, doc.content.size];
    return [starts[first] ?? doc.content.size, starts[last] ?? doc.content.size];
  };
  // Set by anything but a scroll: a view update or a resize prunes and re-places the covers.
  // A scroll paints ahead in strides of screens, so most of its frames change nothing.
  let dirty = true;
  let covered: [number, number] = [0, 0];
  const paint = () => {
    frame = 0;
    const scrolled = !dirty;
    dirty = false;
    const { doc } = view.state;
    let [from, to] = nearView(doc);
    if (scrolled) {
      if (from >= covered[0] && to <= covered[1]) return;
      const wide = nearView(doc, 3, 6);
      covered = wide[0] <= covered[1] && wide[1] >= covered[0]
        ? [Math.min(wide[0], covered[0]), Math.max(wide[1], covered[1])] : wide;
      [from, to] = wide;
    } else covered = [from, to];
    const next = new Map<PmNode, Block>();
    const nextLoose: StaticRange[] = [];
    const nextLooseOver: StaticRange[] = [];
    const set = view.isDestroyed ? null : setOf(view.state);
    let changed = false;
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
        && [...old.ranges, ...old.over].every((r) => r.startContainer.isConnected && r.endContainer.isConnected)) {
        next.set(node, old);
        blocks.delete(node);
        continue;
      }
      changed = true;
      if (old) for (const r of old.ranges) highlight.delete(r);
      blocks.delete(node);
      const ranges: StaticRange[] = [], over: StaticRange[] = [];
      for (const d of inBlock) {
        const from = view.domAtPos(d.from), to = view.domAtPos(d.to);
        const r = new StaticRange({ startContainer: from.node, startOffset: from.offset, endContainer: to.node, endOffset: to.offset });
        if (RESTYLES_LINES && hasLines(r, view.dom)) over.push(r);
        else { highlight.add(r); ranges.push(r); }
      }
      if (next.has(node)) { nextLoose.push(...ranges); nextLooseOver.push(...over); }
      else next.set(node, { offsets, ranges, over });
    }
    if (scrolled) {
      for (const [node, b] of blocks) if (!next.has(node)) next.set(node, b);
      blocks.clear();
    }
    changed ||= blocks.size > 0 || loose.length > 0;
    drop();
    blocks = next;
    loose = nextLoose;
    looseOver = nextLooseOver;
    if (RESTYLES_LINES && changed) cover();
  };
  const scroll = () => { frame ||= requestAnimationFrame(paint); };
  const update = () => { dirty = true; scroll(); };
  window.addEventListener('scroll', scroll, { capture: true, passive: true });
  window.addEventListener('resize', update);
  update();
  return {
    update,
    destroy() {
      window.removeEventListener('scroll', scroll, { capture: true });
      window.removeEventListener('resize', update);
      cancelAnimationFrame(frame);
      drop();
      for (const el of covers) el.remove();
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
