import type { EditorView } from '@tiptap/pm/view';

// Elements drawn at a document position outside the editable DOM, so they take no part in
// line breaking. They live in the view's host, in its offset parent's unscaled coordinates,
// which the zoom transform scales along with the text.

/** Places `el` over the text at `pos` (a line-high box at its left edge); false when it cannot. */
export function placeAt(view: EditorView, el: HTMLElement, pos: number, side = -1): boolean {
  const host = view.dom.parentElement;
  if (!host || view.isDestroyed) return false;
  if (el.parentElement !== host) host.appendChild(el);
  let at: { left: number; top: number; bottom: number };
  try { at = view.coordsAtPos(pos, side); } catch { return false; }
  const parent = (el.offsetParent as HTMLElement | null) ?? document.documentElement;
  const box = parent.getBoundingClientRect();
  const k = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
  el.style.position = 'absolute';
  el.style.left = `${(at.left - box.left) / k - parent.clientLeft}px`;
  el.style.top = `${(at.top - box.top) / k - parent.clientTop}px`;
  el.style.height = el.style.lineHeight = `${(at.bottom - at.top) / k}px`;
  return true;
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
