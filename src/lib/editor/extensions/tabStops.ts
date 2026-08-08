import { Extension, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { FORCE_PAGE_RECALC } from './pageBreaks';
import { PX_PER_CM } from '../../storage/pageMargins';

// Per-paragraph tab stops. CSS only has the fixed `tab-size` grid, so a tab that
// resolves to a stop is measured and given the exact advance as an inline margin.

export type TabAlign = 'left' | 'center' | 'right' | 'decimal';
export type TabStop = { pos: number; align: TabAlign; leader?: string | null };

const CODE: Record<TabAlign, string> = { left: 'l', center: 'c', right: 'r', decimal: 'd' };
const ALIGN: Record<string, TabAlign> = { l: 'left', c: 'center', r: 'right', d: 'decimal' };

// The fill characters a stop may repeat across its gap. Anything else a file names is
// dropped rather than approximated, so the gap simply stays blank.
export const LEADER_CHARS = ['.', '-', '_', '·'] as const;

export function normalizeLeader(ch: unknown): string | null {
  return typeof ch === 'string' && (LEADER_CHARS as readonly string[]).includes(ch) ? ch : null;
}

// Canonical attr form: one '<cm><align code><leader?>' per stop, ';'-separated
// ('6c;12r.;16d'). Positions are cm from the left text margin — Word's origin and ODF's.
export function parseTabStops(value: unknown): TabStop[] {
  if (typeof value !== 'string' || !value) return [];
  const out: TabStop[] = [];
  for (const part of value.split(';')) {
    const m = /^(-?\d*\.?\d+)([lcrd])(\S)?$/.exec(part.trim());
    if (m) out.push({ pos: parseFloat(m[1]), align: ALIGN[m[2]], leader: normalizeLeader(m[3]) });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export function formatTabStops(stops: TabStop[]): string | null {
  const byPos = new Map<number, TabStop>();
  for (const s of stops) {
    const pos = Math.round(s.pos * 100) / 100;
    if (pos >= 0) byPos.set(pos, { ...s, pos });
  }
  const out = [...byPos.values()].sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.pos}${CODE[s.align]}${normalizeLeader(s.leader) ?? ''}`);
  return out.length ? out.join(';') : null;
}

export type BlockRuler = { stops: TabStop[]; indent: number; indentRight: number; indentFirst: number };

// The stops of the block holding the cursor, plus the block's own indents (cm) —
// everything the ruler needs to draw and edit one paragraph.
export function activeTabStops(state: EditorState): BlockRuler | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (!node.isTextblock) continue;
    const cm = (v: unknown) => (typeof v === 'number' ? v : 0);
    return {
      stops: parseTabStops(node.attrs.tabStops),
      indent: cm(node.attrs.indent),
      indentRight: cm(node.attrs.indentRight),
      indentFirst: cm(node.attrs.indentFirst),
    };
  }
  return null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tabStops: {
      setTabStops: (stops: TabStop[]) => ReturnType;
    };
  }
}

const tabStopsKey = new PluginKey<DecorationSet>('tabStops');

// A tab's advance is decided per line, so a block only needs measuring when it has
// stops of its own; a hanging indent implies one at the text position.
function stopsOf(node: PmNode): TabStop[] {
  const stops = parseTabStops(node.attrs.tabStops);
  const first = typeof node.attrs.indentFirst === 'number' ? node.attrs.indentFirst : 0;
  if (first < 0) {
    const indent = typeof node.attrs.indent === 'number' ? node.attrs.indent : 0;
    stops.push({ pos: indent, align: 'left' });
    stops.sort((a, b) => a.pos - b.pos);
  }
  return stops;
}

// Doc positions of every tab character in a textblock.
function tabPositions(node: PmNode, blockPos: number): number[] {
  const out: number[] = [];
  node.forEach((child, offset) => {
    const text = child.isText ? child.text ?? '' : '';
    for (let i = text.indexOf('\t'); i >= 0; i = text.indexOf('\t', i + 1)) {
      out.push(blockPos + 1 + offset + i);
    }
  });
  return out;
}

type TabWidth = { pos: number; width: number; leader: string | null };

function measure(view: EditorView): TabWidth[] {
  const dom = view.dom as HTMLElement;
  const tipRect = dom.getBoundingClientRect();
  // From the width, not the height: offsetWidth/Height are rounded, and a one-line
  // header/footer zone is short enough for that rounding to be half a percent.
  const scale = dom.offsetWidth ? tipRect.width / dom.offsetWidth : 1;
  if (!scale) return [];
  // x = 0 is the left text margin (.tiptap's padding edge), the origin of a stop.
  const originX = tipRect.left + parseFloat(getComputedStyle(dom).paddingLeft || '0') * scale;
  const out: TabWidth[] = [];

  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const stops = stopsOf(node);
    if (!stops.length) return false;
    const tabs = tabPositions(node, pos);
    const blockEnd = pos + node.nodeSize - 1;

    for (let t = 0; t < tabs.length; t++) {
      const tabPos = tabs[t];
      // Side -1 measures at the end of the content BEFORE the tab, outside the tab's
      // own span — so the margin this pass applies can't contaminate the next one's
      // reading of where the pen stands.
      const start = view.coordsAtPos(tabPos, -1);
      const xCm = (start.left - originX) / scale / PX_PER_CM;
      // Custom stops replace the default grid to their left; past the last one the
      // CSS grid already does the right thing, so that tab stays undecorated.
      const stop = stops.find((s) => s.pos > xCm + 0.01);
      if (!stop) continue;
      let width = (stop.pos - xCm) * PX_PER_CM;

      if (stop.align !== 'left') {
        let segEnd = t + 1 < tabs.length ? tabs[t + 1] : blockEnd;
        if (stop.align === 'decimal') segEnd = decimalPos(node, pos, tabPos + 1, segEnd) ?? segEnd;
        let back = segEnd > tabPos + 1 ? rangeWidth(view, tabPos + 1, segEnd) / scale : 0;
        if (stop.align === 'center') back /= 2;
        width -= back;
      }
      out.push({ pos: tabPos, width: Math.max(0, Math.round(width * 100) / 100), leader: normalizeLeader(stop.leader) });
    }
    return false;
  });
  return out;
}

// Natural width of a doc range: the sum of its client rects, so a segment pushed onto
// the next line still reads its own width. Measuring its span end-to-end instead would
// feed a wrapped line back in, and the alignment could never recover.
function rangeWidth(view: EditorView, from: number, to: number): number {
  // Biased outwards, or the range swallows the tab's own span at either end.
  const a = view.domAtPos(from, 1);
  const b = view.domAtPos(to, -1);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  let width = 0;
  for (const rect of Array.from(range.getClientRects())) width += rect.width;
  return width;
}

// Position of the segment's decimal separator ('.' or ',' — the attr carries no
// style:char, so both locales' separators are accepted).
function decimalPos(node: PmNode, blockPos: number, from: number, to: number): number | null {
  let found: number | null = null;
  node.forEach((child, offset) => {
    if (found != null || !child.isText) return;
    const base = blockPos + 1 + offset;
    const text = child.text ?? '';
    for (let i = 0; i < text.length; i++) {
      const at = base + i;
      if (at < from || at >= to) continue;
      if (text[i] === '.' || text[i] === ',') { found = at; return; }
    }
  });
  return found;
}

// A tab's own span, so it can carry an advance. Idempotent: the pass re-runs on every
// zoom or content change.
function wrapZoneTabs(para: HTMLElement): HTMLElement[] {
  const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? '').includes('\t') && !(n.parentElement as HTMLElement)?.dataset.zoneTab) found.push(n as Text);
  }
  for (const text of found) {
    let node: Text | null = text;
    while (node) {
      const at: number = (node.textContent ?? '').indexOf('\t');
      if (at < 0) break;
      const tab: Text = at ? node.splitText(at) : node;
      node = tab.length > 1 ? tab.splitText(1) : null;
      const span = document.createElement('span');
      span.dataset.zoneTab = '';
      tab.replaceWith(span);
      span.append(tab);
    }
  }
  return Array.from(para.querySelectorAll<HTMLElement>('span[data-zone-tab]'));
}

// An inactive header/footer zone is generateHTML output no ProseMirror plugin reaches,
// so its tabs are measured straight on the DOM — same rule, left to right, each advance
// applied before the next is read.
export function layOutZoneTabs(zone: HTMLElement): void {
  const para = zone.querySelector<HTMLElement>('[data-tab-stops]');
  const stops = para ? parseTabStops(para.getAttribute('data-tab-stops')) : [];
  if (!para || !stops.length) return;
  const tabs = wrapZoneTabs(para);
  for (const t of tabs) {
    t.className = '';
    t.removeAttribute('data-leader');
    t.style.cssText = 'tab-size:0';
  }
  const rect = para.getBoundingClientRect();
  const scale = para.offsetWidth ? rect.width / para.offsetWidth : 1;
  if (!scale) return;
  const originX = rect.left + parseFloat(getComputedStyle(para).paddingLeft || '0') * scale;

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const xCm = (tab.getBoundingClientRect().left - originX) / scale / PX_PER_CM;
    const stop = stops.find((s) => s.pos > xCm + 0.01);
    if (!stop) continue;
    let width = (stop.pos - xCm) * PX_PER_CM;
    // A decimal stop takes the whole segment back, i.e. behaves as right — a zone is one
    // paragraph of running text, where a separator to align on is not a case that arises.
    if (stop.align !== 'left') {
      const range = document.createRange();
      range.setStartAfter(tab);
      if (i + 1 < tabs.length) range.setEndBefore(tabs[i + 1]);
      else range.setEnd(para, para.childNodes.length);
      let seg = 0;
      for (const rect of Array.from(range.getClientRects())) seg += rect.width;
      width -= (stop.align === 'center' ? seg / 2 : seg) / scale;
    }
    width = Math.max(0, Math.round(width * 100) / 100);
    tab.style.marginLeft = `${width}px`;
    const leader = normalizeLeader(stop.leader);
    if (leader) {
      tab.className = 'tab-leader';
      tab.dataset.leader = leader;
      tab.style.setProperty('--leader-w', `${width}px`);
    }
  }
}

export const TabStops = Extension.create({
  name: 'tabStops',

  addOptions() {
    return { types: ['paragraph', 'heading'] as string[] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          tabStops: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-tab-stops') || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              (attributes.tabStops ? { 'data-tab-stops': String(attributes.tabStops) } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const types = this.options.types as string[];
    return {
      setTabStops: (stops: TabStop[]) => ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection;
        const value = formatTabStops(stops);
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!types.includes(node.type.name)) return;
          if ((node.attrs.tabStops ?? null) === value) return;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, tabStops: value });
          changed = true;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    };
  },

  addProseMirrorPlugins() {
    let rafId: number | null = null;
    let key = '';
    // Each pass measures the layout the previous one produced, so a tab whose x moved
    // needs one more pass to settle (a stop can also rewrap the line). Bounded against
    // a two-layout ping-pong; reset per external change.
    let passes = 0;
    const MAX_PASSES = 6;
    // Layout changes (margins, orientation, zoom, styles) arrive as FORCE_PAGE_RECALC;
    // counted here because a transaction is gone by the time `update` runs. Our own
    // dispatch returns above the counter, so it can't re-trigger itself.
    let forced = 0;
    let seenForced = 0;

    return [
      new Plugin<DecorationSet>({
        key: tabStopsKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const next = tr.getMeta(tabStopsKey) as DecorationSet | undefined;
            if (next) return next;
            if (tr.getMeta(FORCE_PAGE_RECALC)) forced++;
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return tabStopsKey.getState(state);
          },
        },
        view(view) {
          const calculate = () => {
            rafId = null;
            let widths: TabWidth[] = [];
            // coordsAtPos throws on a position the browser hasn't rendered yet; the
            // next change re-runs the pass anyway.
            try { widths = measure(view); } catch { return; }
            const next = widths.map((w) => `${w.pos}:${w.width}:${w.leader ?? ''}`).join(',');
            if (next === key) return;
            key = next;
            const decos = widths.map((w) =>
              // margin-LEFT: the gap is the tab's own advance, so a caret placed after
              // the tab has to sit behind it. As margin-right it stayed at the old x
              // until the next keystroke moved it into the following text node.
              Decoration.inline(w.pos, w.pos + 1, w.leader
                // The fill is a ::before clipped to the gap (editor.css), so the leader
                // stays out of the document's text.
                ? { style: `tab-size:0;margin-left:${w.width}px;--leader-w:${w.width}px`, class: 'tab-leader', 'data-leader': w.leader }
                : { style: `tab-size:0;margin-left:${w.width}px` }),
            );
            // The advances change line breaking, so pagination has to re-measure.
            view.dispatch(view.state.tr
              .setMeta(tabStopsKey, DecorationSet.create(view.state.doc, decos))
              .setMeta(FORCE_PAGE_RECALC, true)
              .setMeta('addToHistory', false));
            if (passes < MAX_PASSES) { passes++; schedule(); }
          };

          const schedule = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(calculate);
          };

          schedule();

          return {
            update(_v, prev) {
              if (prev.doc === view.state.doc && forced === seenForced) return;
              seenForced = forced;
              passes = 0;
              schedule();
            },
            destroy() {
              if (rafId !== null) cancelAnimationFrame(rafId);
            },
          };
        },
      }),
    ];
  },
});
