import type { EditorView } from '@tiptap/pm/view';

// Elements drawn at a document position outside the editable DOM, so they take no part in
// line breaking. They live in the view's host, in its offset parent's unscaled coordinates,
// which the zoom transform scales along with the text.

/** Places `el` over the text at `pos` (a line-high box at its left edge); false when it cannot. */
export function placeAt(view: EditorView, el: HTMLElement, pos: number, side = -1): boolean {
  let at: { left: number; top: number; bottom: number };
  try { at = view.coordsAtPos(pos, side); } catch { return false; }
  if (!placeOver(view, el, { left: at.left, top: at.top, bottom: at.bottom })) return false;
  el.style.lineHeight = el.style.height;
  return true;
}

/** Places `el` over a client rect (its width only when given); false when it cannot. */
export function placeOver(view: EditorView, el: HTMLElement, at: { left: number; top: number; bottom: number; right?: number }): boolean {
  const host = view.dom.parentElement;
  if (!host || view.isDestroyed) return false;
  el.dataset.overlay = '';
  if (el.parentElement !== host) host.appendChild(el);
  const parent = (el.offsetParent as HTMLElement | null) ?? document.documentElement;
  const box = parent.getBoundingClientRect();
  const k = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
  el.style.position = 'absolute';
  el.style.left = `${(at.left - box.left) / k - parent.clientLeft}px`;
  el.style.top = `${(at.top - box.top) / k - parent.clientTop}px`;
  el.style.height = `${(at.bottom - at.top) / k}px`;
  if (at.right !== undefined) el.style.width = `${(at.right - at.left) / k}px`;
  return true;
}

/** The text nodes a range covers, each with the part of it inside the range. */
export function textsIn(range: AbstractRange): { node: Text; from: number; to: number }[] {
  const r = document.createRange();
  try {
    r.setStart(range.startContainer, range.startOffset);
    r.setEnd(range.endContainer, range.endOffset);
  } catch { return []; }
  const out: { node: Text; from: number; to: number }[] = [];
  const root = r.commonAncestorContainer;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n: Node | null = root.nodeType === Node.TEXT_NODE ? root : walk.nextNode(); n; n = walk.nextNode()) {
    if (!r.intersectsNode(n)) continue;
    const text = n as Text;
    const from = text === r.startContainer ? r.startOffset : 0;
    const to = text === r.endContainer ? r.endOffset : text.length;
    if (to > from) out.push({ node: text, from, to });
  }
  return out;
}

/** Covers the text of `range` with one element per line box from `make`, outside the editable DOM. */
export function coverRange(view: EditorView, range: AbstractRange, make: () => HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const r = document.createRange();
  for (const { node, from, to } of textsIn(range)) {
    r.setStart(node, from);
    r.setEnd(node, to);
    for (const rect of r.getClientRects()) {
      if (!rect.width) continue;
      const el = make();
      if (placeOver(view, el, rect)) out.push(el);
      else el.remove();
    }
  }
  return out;
}

// Scrolls `pos` to the middle of its scroller unless it is comfortably inside already,
// through a probe at the position: the text itself has no element of its own to scroll.
export function scrollPosIntoView(view: EditorView, pos: number): void {
  const probe = document.createElement('div');
  probe.style.cssText = 'width:1px;visibility:hidden;pointer-events:none';
  if (placeAt(view, probe, pos, 1)) {
    let port = probe.parentElement;
    while (port && port.scrollHeight <= port.clientHeight) port = port.parentElement;
    const box = probe.getBoundingClientRect();
    const within = port ? port.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
    const pad = Math.min(80, within.height / 4);
    if (box.top < within.top + pad || box.bottom > within.bottom - pad) probe.scrollIntoView({ block: 'center' });
  }
  probe.remove();
}
