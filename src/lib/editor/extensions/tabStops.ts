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
export type TabStop = { pos: number; align: TabAlign };

const CODE: Record<TabAlign, string> = { left: 'l', center: 'c', right: 'r', decimal: 'd' };
const ALIGN: Record<string, TabAlign> = { l: 'left', c: 'center', r: 'right', d: 'decimal' };

// Canonical attr form: one '<cm><align code>' per stop, ';'-separated ('6c;12r;16d').
// Positions are cm from the left text margin — the origin Word and ODF share.
export function parseTabStops(value: unknown): TabStop[] {
  if (typeof value !== 'string' || !value) return [];
  const out: TabStop[] = [];
  for (const part of value.split(';')) {
    const m = /^(-?\d*\.?\d+)([lcrd])$/.exec(part.trim());
    if (m) out.push({ pos: parseFloat(m[1]), align: ALIGN[m[2]] });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export function formatTabStops(stops: TabStop[]): string | null {
  const byPos = new Map<number, TabAlign>();
  for (const s of stops) {
    const pos = Math.round(s.pos * 100) / 100;
    if (pos >= 0) byPos.set(pos, s.align);
  }
  const out = [...byPos.entries()].sort((a, b) => a[0] - b[0]).map(([pos, align]) => `${pos}${CODE[align]}`);
  return out.length ? out.join(';') : null;
}

// The stops of the block holding the cursor, plus the block's own indents (cm) —
// everything the ruler needs to draw and edit one paragraph.
export function activeTabStops(state: EditorState): { stops: TabStop[]; indent: number; indentFirst: number } | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (!node.isTextblock) continue;
    return {
      stops: parseTabStops(node.attrs.tabStops),
      indent: typeof node.attrs.indent === 'number' ? node.attrs.indent : 0,
      indentFirst: typeof node.attrs.indentFirst === 'number' ? node.attrs.indentFirst : 0,
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

type TabWidth = { pos: number; width: number };

function measure(view: EditorView): TabWidth[] {
  const dom = view.dom as HTMLElement;
  const tipRect = dom.getBoundingClientRect();
  const scale = dom.offsetHeight ? tipRect.height / dom.offsetHeight : 1;
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
        const segEnd = t + 1 < tabs.length ? tabs[t + 1] : blockEnd;
        const segStart = view.coordsAtPos(tabPos + 1, 1);
        const end = view.coordsAtPos(segEnd, -1);
        // A segment that wraps can't satisfy the alignment, so it falls back to left.
        if (segEnd > tabPos + 1 && Math.abs(end.top - start.top) < 1) {
          let back = (end.left - segStart.left) / scale;
          if (stop.align === 'center') back /= 2;
          if (stop.align === 'decimal') {
            const dec = decimalPos(node, pos, tabPos + 1, segEnd);
            back = dec == null ? back : (view.coordsAtPos(dec, -1).left - segStart.left) / scale;
          }
          width -= back;
        }
      }
      out.push({ pos: tabPos, width: Math.max(0, Math.round(width * 100) / 100) });
    }
    return false;
  });
  return out;
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
            const next = widths.map((w) => `${w.pos}:${w.width}`).join(',');
            if (next === key) return;
            key = next;
            const decos = widths.map((w) =>
              // margin-LEFT: the gap is the tab's own advance, so a caret placed after
              // the tab has to sit behind it. As margin-right it stayed at the old x
              // until the next keystroke moved it into the following text node.
              Decoration.inline(w.pos, w.pos + 1, { style: `tab-size:0;margin-left:${w.width}px` }),
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
