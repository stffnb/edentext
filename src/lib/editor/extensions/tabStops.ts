import { Extension, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { FORCE_PAGE_RECALC, pageBreakKey } from './pageBreaks';
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

// A stop past the end of the line is drawn at the end of the line, as LibreOffice does:
// the Math Guide's footer style puts its right stop at 18cm in a 17cm column, and honoured
// literally that hangs the page number outside the page — or wraps the footer.
function clampStops(stops: TabStop[], widthCm: number): TabStop[] {
  if (!(widthCm > 0)) return stops;
  return stops.map((s) => (s.pos > widthCm ? { ...s, pos: widthCm } : s));
}

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
// Doc positions where a run of tabs has to start a new line.
type TabLayout = { widths: TabWidth[]; breaks: number[] };

// Where the pen lands after a tab standing at x (cm from the line start): the first stop
// right of it, else the next multiple of the default interval.
export function nextStopCm(x: number, stops: number[], interval: number): number {
  const custom = stops.find((s) => s > x + 0.01);
  if (custom != null) return custom;
  return Math.floor(x / interval + 1e-9) * interval + interval;
}

// A run of tabs wider than the line continues on the next one, as LibreOffice lays it
// out; Chromium instead hangs the leftover tabs and starts the next line at the margin.
// Walked from the pen BEFORE the run — the one thing a break of ours can't move — so the
// answer is the same whether or not the break is already in place.
function runBreaks(view: EditorView, blockEl: HTMLElement, tabs: number[], stops: TabStop[], scale: number, originX: number): number[] {
  // Only a run of two or more can outgrow a line, and reading the block's geometry
  // forces a reflow — so the ordinary single tab costs nothing here.
  const runs: [number, number][] = [];
  for (let i = 0; i < tabs.length; ) {
    let end = i + 1;
    while (end < tabs.length && tabs[end] === tabs[end - 1] + 1) end++;
    if (end - i > 1) runs.push([i, end]);
    i = end;
  }
  if (!runs.length) return [];

  const cs = getComputedStyle(blockEl);
  const interval = (parseFloat(cs.tabSize) || PX_PER_CM * 1.25) / PX_PER_CM;
  const lineCm = (blockEl.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')) / PX_PER_CM;
  if (!(interval > 0) || !(lineCm > 0)) return [];
  // Stops are measured from the text margin, the grid from the line start.
  const offsetCm = (blockEl.getBoundingClientRect().left - originX) / scale / PX_PER_CM
    + parseFloat(cs.paddingLeft || '0') / PX_PER_CM;
  const stopCms = stops.map((s) => s.pos - offsetCm);
  const out: number[] = [];

  for (const [i, end] of runs) {
    let x = (view.coordsAtPos(tabs[i], -1).left - originX) / scale / PX_PER_CM - offsetCm;
    for (let j = i; j < end; j++) {
      let next = nextStopCm(x, stopCms, interval);
      // Never before the run's own first tab: that pen is what the walk starts from, so
      // moving it would make the next pass decide differently.
      if (next > lineCm + 0.01 && j > i) {
        out.push(tabs[j]);
        x = 0;
        next = nextStopCm(0, stopCms, interval);
      }
      x = next;
    }
  }
  return out;
}

function measure(view: EditorView): TabLayout {
  const dom = view.dom as HTMLElement;
  const tipRect = dom.getBoundingClientRect();
  // From the width, not the height: offsetWidth/Height are rounded, and a one-line
  // header/footer zone is short enough for that rounding to be half a percent.
  const scale = dom.offsetWidth ? tipRect.width / dom.offsetWidth : 1;
  if (!scale) return { widths: [], breaks: [] };
  // x = 0 is the left text margin (.tiptap's padding edge), the origin of a stop.
  const originX = tipRect.left + parseFloat(getComputedStyle(dom).paddingLeft || '0') * scale;
  const out: TabWidth[] = [];
  const breaks: number[] = [];

  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const tabs = tabPositions(node, pos);
    if (!tabs.length) return false;
    const blockEl = view.nodeDOM(pos);
    const stops = blockEl instanceof HTMLElement
      ? clampStops(stopsOf(node), (blockEl.getBoundingClientRect().right - originX) / scale / PX_PER_CM - 0.03)
      : stopsOf(node);
    if (blockEl instanceof HTMLElement) breaks.push(...runBreaks(view, blockEl, tabs, stops, scale, originX));
    if (!stops.length) return false;
    const blockEnd = pos + node.nodeSize - 1;

    // Where the pen stands (cm from the text margin) after the tab before this one.
    // Carrying it along the line is what makes one pass self-consistent: read from the
    // DOM instead and every tab but the line's first measures the advance the *previous*
    // pass gave the one before it, so the layout takes another pass to settle — and on a
    // long document, where pagination keeps moving lines, it may never get a stable one.
    let pen: number | null = null;
    let lineTop = NaN;
    for (let t = 0; t < tabs.length; t++) {
      const tabPos = tabs[t];
      // Side -1 measures at the end of the content BEFORE the tab. A new line — a hard
      // break, or a wrap — starts the pen over at what the DOM shows there.
      const start = view.coordsAtPos(tabPos, -1);
      if (pen == null || Math.abs(start.top - lineTop) > 1) pen = (start.left - originX) / scale / PX_PER_CM;
      lineTop = start.top;
      // Custom stops replace the default grid to their left; past the last one the CSS
      // grid already does the right thing, so that tab stays undecorated — and the pen
      // has to be read off the DOM again at the next one.
      const stop = stops.find((s) => s.pos > (pen as number) + 0.01);
      if (!stop) { pen = null; continue; }
      let width = (stop.pos - pen) * PX_PER_CM;

      const segEnd = t + 1 < tabs.length ? tabs[t + 1] : blockEnd;
      const segCm = segEnd > tabPos + 1 ? rangeWidth(view, tabPos + 1, segEnd) / scale / PX_PER_CM : 0;
      if (stop.align !== 'left') {
        const alignEnd = stop.align === 'decimal'
          ? decimalPos(node, pos, tabPos + 1, segEnd) ?? segEnd
          : segEnd;
        let back = alignEnd > tabPos + 1 ? rangeWidth(view, tabPos + 1, alignEnd) / scale : 0;
        if (stop.align === 'center') back /= 2;
        width -= back;
      }
      out.push({ pos: tabPos, width: Math.max(0, Math.round(width * 100) / 100), leader: normalizeLeader(stop.leader) });
      // The segment sits behind a left stop, astride a centred one and ahead of the rest.
      pen = stop.align === 'left' ? stop.pos + segCm : stop.align === 'center' ? stop.pos + segCm / 2 : stop.pos;
    }
    return false;
  });
  return { widths: out, breaks };
}

// Natural width of a doc range: the extent of each line it covers, added up — so a
// segment pushed onto the next line still reads its own width. Not the sum of the rects:
// a range crossing an inline element yields one for the element's box and one for the
// text inside it, and adding those counts the text twice.
function rangeWidth(view: EditorView, from: number, to: number): number {
  // Biased outwards, or the range swallows the tab's own span at either end.
  const a = view.domAtPos(from, 1);
  const b = view.domAtPos(to, -1);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const rows = new Map<number, { left: number; right: number }>();
  for (const rect of Array.from(range.getClientRects())) {
    if (!rect.width) continue;
    const key = Math.round(rect.top);
    const row = rows.get(key);
    if (row) { row.left = Math.min(row.left, rect.left); row.right = Math.max(row.right, rect.right); }
    else rows.set(key, { left: rect.left, right: rect.right });
  }
  let width = 0;
  for (const row of rows.values()) width += row.right - row.left;
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
    // hasAttribute, not dataset: the marker's value is '', which reads as falsy — and a
    // tab wrapped again on every pass nests a span per pass, each with its own advance.
    if ((n.textContent ?? '').includes('\t') && !n.parentElement?.hasAttribute('data-zone-tab')) found.push(n as Text);
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
  if (!para || !parseTabStops(para.getAttribute('data-tab-stops')).length) return;
  const tabs = wrapZoneTabs(para);
  for (const t of tabs) {
    t.className = '';
    t.removeAttribute('data-leader');
    t.style.cssText = 'tab-size:0';
  }
  // Measured with wrapping off: a segment that has already wrapped reads short by the
  // space its break swallowed, so the advance computed from it keeps it wrapped — the
  // Math Guide's footer stayed two lines over three pixels.
  const wrapping = para.style.whiteSpace;
  para.style.whiteSpace = 'pre';
  const rect = para.getBoundingClientRect();
  const scale = para.offsetWidth ? rect.width / para.offsetWidth : 1;
  const cs = getComputedStyle(para);
  const padLeft = parseFloat(cs.paddingLeft || '0');
  // The line's own width, not clientWidth: that is rounded up to whole px, and half a
  // pixel of it is enough to wrap the run a right-aligned stop puts at the very end.
  // One px of slack: a run ending exactly on the boundary wraps, and a stop a pixel
  // short of it is a pixel nobody sees.
  const lineCm = (rect.width / (scale || 1) - padLeft - parseFloat(cs.paddingRight || '0') - 1) / PX_PER_CM;
  const stops = clampStops(parseTabStops(para.getAttribute('data-tab-stops')), lineCm);
  if (!scale) { para.style.whiteSpace = wrapping; return; }
  const originX = rect.left + padLeft * scale;

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
      // The extent, not the sum: a range crossing inline elements yields a rect for the
      // element's box as well as for the text inside it.
      const boxes = Array.from(range.getClientRects()).filter((r) => r.width);
      const seg = boxes.length
        ? Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left))
        : 0;
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
  para.style.whiteSpace = wrapping;
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
            // A pagination placement change moves lines, so the advances measured before
            // it are stale — and pagination settles over many frames on a long document,
            // long after two passes of ours have agreed on the layout of the moment.
            if (tr.getMeta(FORCE_PAGE_RECALC) || tr.getMeta(pageBreakKey)) forced++;
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
            let layout: TabLayout = { widths: [], breaks: [] };
            // coordsAtPos throws on a position the browser hasn't rendered yet; the
            // next change re-runs the pass anyway.
            try { layout = measure(view); } catch { return; }
            const { widths, breaks } = layout;
            const next = widths.map((w) => `${w.pos}:${w.width}:${w.leader ?? ''}`).join(',') + `|${breaks.join(',')}`;
            if (next === key) return;
            key = next;
            const decos: Decoration[] = widths.map((w) =>
              // margin-LEFT: the gap is the tab's own advance, so a caret placed after
              // the tab has to sit behind it. As margin-right it stayed at the old x
              // until the next keystroke moved it into the following text node.
              Decoration.inline(w.pos, w.pos + 1, w.leader
                // The fill is a ::before clipped to the gap (editor.css), so the leader
                // stays out of the document's text.
                ? { style: `tab-size:0;margin-left:${w.width}px;--leader-w:${w.width}px`, class: 'tab-leader', 'data-leader': w.leader }
                : { style: `tab-size:0;margin-left:${w.width}px` }),
            );
            // The tabs the line can't hold move to the next one, where the grid starts
            // over — which is what CSS does after a <br> anyway.
            for (const at of breaks) {
              decos.push(Decoration.widget(at, () => document.createElement('br'), { side: -1, key: 'tab-wrap' }));
            }
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
