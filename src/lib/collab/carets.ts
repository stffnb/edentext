import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';

// The others' carets and selections, drawn beside the text instead of in it: an element
// inside a word splits its text, and the browser then hyphenates and breaks that word
// differently, so a caret moved lines. Carets sit in a layer after the view, measured each
// frame the view or its size changed; selections are CSS highlights over the text.

export const caretsKey = new PluginKey('collabCarets');

export interface Mark { id: number; anchor: number; head: number }
type Look = (id: number) => { name: string; color: string };

/** Where each other writer's caret and selection are in `state`, from their awareness. */
function marksIn(state: EditorState, awareness: Awareness): Mark[] {
  const y = ySyncPluginKey.getState(state);
  if (!y?.binding || y.binding.invalidContentError || y.snapshot || y.prevSnapshot || !y.binding.mapping.size) return [];
  const max = Math.max(state.doc.content.size - 1, 0);
  const at = (rel: unknown) => {
    try {
      const pos = relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromJSON(rel), y.binding.mapping);
      return pos === null ? null : Math.min(pos, max);
    } catch { return null; }
  };
  const out: Mark[] = [];
  awareness.getStates().forEach((s, id) => {
    if (id === y.doc.clientID || !s?.cursor || !s.user) return;
    const anchor = at(s.cursor.anchor), head = at(s.cursor.head);
    if (anchor !== null && head !== null) out.push({ id, anchor, head });
  });
  return out;
}

const highlights = (): HighlightRegistry | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null);
let views = 0;

/** Draws the carets and selections of `awareness` in every view of the editor. */
export function caretsPlugin(awareness: Awareness, look: Look): Plugin {
  return new Plugin({
    key: caretsKey,
    view(view: EditorView) {
      const tag = `collab-${++views}-`;
      const layer = document.createElement('div');
      layer.className = 'collab-carets';
      const sheet = layer.appendChild(document.createElement('style'));
      const carets = new Map<number, HTMLElement>();
      let named = new Set<string>();
      let frame = 0;
      const draw = () => {
        frame = 0;
        if (view.isDestroyed) return;
        const host = view.dom.parentElement;
        if (!host) return;
        if (layer.parentElement !== host || layer.previousElementSibling !== view.dom) view.dom.after(layer);
        const marks = marksIn(view.state, awareness);
        const origin = layer.getBoundingClientRect();
        const scale = view.dom.offsetWidth ? view.dom.getBoundingClientRect().width / view.dom.offsetWidth : 1;
        const reg = highlights();
        const rules: string[] = [];
        const seen = new Set<number>(), shown = new Set<string>();
        for (const m of marks) {
          const who = look(m.id);
          let el = carets.get(m.id);
          if (!el) {
            el = document.createElement('span');
            el.className = 'ProseMirror-yjs-cursor';
            el.dataset.client = String(m.id);
            el.append(document.createElement('div'));
            layer.append(el);
            carets.set(m.id, el);
          }
          const label = el.firstElementChild as HTMLElement;
          if (label.textContent !== who.name) label.textContent = who.name;
          el.style.borderColor = label.style.backgroundColor = who.color;
          let c: { left: number; top: number; bottom: number } | null = null;
          try { c = view.coordsAtPos(m.head); } catch { /* not drawn yet */ }
          el.hidden = !c;
          if (c) {
            el.style.left = `${(c.left - origin.left) / scale}px`;
            el.style.top = `${(c.top - origin.top) / scale}px`;
            el.style.height = `${(c.bottom - c.top) / scale}px`;
          }
          seen.add(m.id);
          if (!reg || m.anchor === m.head) continue;
          const range = document.createRange();
          try {
            const from = view.domAtPos(Math.min(m.anchor, m.head)), to = view.domAtPos(Math.max(m.anchor, m.head));
            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);
          } catch { continue; }
          reg.set(tag + m.id, new Highlight(range));
          shown.add(tag + m.id);
          rules.push(`::highlight(${tag}${m.id}) { background-color: ${who.color}70; }`);
        }
        for (const [id, el] of carets) if (!seen.has(id)) { el.remove(); carets.delete(id); }
        for (const name of named) if (!shown.has(name)) reg?.delete(name);
        named = shown;
        const css = rules.length ? `@media screen {\n${rules.join('\n')}\n}` : '';
        if (sheet.textContent !== css) sheet.textContent = css;
      };
      const later = () => { frame ||= requestAnimationFrame(draw); };
      const sized = new ResizeObserver(later);
      sized.observe(view.dom);
      awareness.on('change', later);
      later();
      return {
        update: later,
        destroy() {
          cancelAnimationFrame(frame);
          sized.disconnect();
          awareness.off('change', later);
          for (const name of named) highlights()?.delete(name);
          layer.remove();
        },
      };
    },
  });
}
