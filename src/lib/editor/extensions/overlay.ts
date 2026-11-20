import type { EditorView } from '@tiptap/pm/view';

// Elements drawn at a document position outside the editable DOM, so they take no part in
// line breaking. They live in the view's host, in its offset parent's unscaled coordinates,
// which the zoom transform scales along with the text.

type Coords = { left: number; right: number; top: number; bottom: number };

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;

/** The caret's place at `offset` in a text node, from the character before or after it. */
export function caretBeside(node: Text, offset: number, before: boolean): Coords | null {
  if (before ? offset < 1 : offset >= node.length) return null;
  const range = document.createRange();
  range.setStart(node, before ? offset - 1 : offset);
  range.setEnd(node, before ? offset : offset + 1);
  const box = range.getBoundingClientRect();
  if (!box.height) return null;
  // It stands on the character's far side, far being the way that character runs.
  const char = range.toString();
  const rtl = /\p{N}/u.test(char) ? false : RTL_CHAR.test(char) ? true
    : /\p{L}/u.test(char) ? false : !!node.parentElement && getComputedStyle(node.parentElement).direction === 'rtl';
  const x = before !== rtl ? box.right : box.left;
  return { left: x, right: x, top: box.top, bottom: box.bottom };
}

/**
 * `view.coordsAtPos`, completed where WebKit has no rect: at the end of a text node of
 * right-to-left text in a right-to-left block it answers 0,0.
 */
export function coordsAt(view: EditorView, pos: number, side = 1): Coords {
  const at = view.coordsAtPos(pos, side);
  if (at.top || at.bottom || at.left || at.right) return at;
  for (const before of [true, false]) {
    const { node, offset } = view.domAtPos(pos, before ? -1 : 1);
    const beside = node instanceof Text ? caretBeside(node, offset, before) : null;
    if (beside) return beside;
  }
  return at;
}

/** Places `el` over the text at `pos` (a line-high box at its left edge); false when it cannot. */
export function placeAt(view: EditorView, el: HTMLElement, pos: number, side = -1): boolean {
  let at: { left: number; top: number; bottom: number };
  try { at = coordsAt(view, pos, side); } catch { return false; }
  if (!placeOver(view, el, { left: at.left, top: at.top, bottom: at.bottom })) return false;
  el.style.lineHeight = el.style.height;
  return true;
}

/** Gives `el` the font and colour (`--offer-color`) of the run before `pos`, flipped for RTL. */
export function matchRunFont(view: EditorView, el: HTMLElement, pos: number): void {
  const { node, offset } = view.domAtPos(pos, -1);
  const last = node.nodeType === 1 ? node.childNodes[offset - 1] ?? node : node;
  const run = last.nodeType === 1 ? last as Element : last.parentElement;
  if (!run) return;
  const cs = getComputedStyle(run);
  for (const p of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'letter-spacing', 'word-spacing']) {
    el.style.setProperty(p, cs.getPropertyValue(p));
  }
  el.style.setProperty('--offer-color', cs.color);
  el.style.translate = cs.direction === 'rtl' ? '-100%' : '';
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

// Focuses the view and keeps every scroller around it where it was: WebKit scrolls to the
// selection ProseMirror writes into a redrawn DOM, even a caret far outside the view.
export function focusInPlace(view: EditorView): void {
  const kept: [Element, number, number][] = [];
  for (let el = view.dom.parentElement; el; el = el.parentElement) kept.push([el, el.scrollTop, el.scrollLeft]);
  view.focus();
  for (const [el, top, left] of kept) {
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  }
}
