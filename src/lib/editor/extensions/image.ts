import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { dropCursor } from '@tiptap/pm/dropcursor';
import { cmToPx } from '../../storage/pageMargins';

// Inline, as-character image, or a floating text-wrapped frame (wrap = flow mode);
// width/height are doc px @96dpi, rotation CW degrees. Export → cm + ODF
// draw:transform/style:wrap. A floating image floats at its anchor; drag re-anchors it.

// 'inline' = as-character; 'left'/'right' = square wrap (text on the open side);
// 'topBottom' = no side wrap (text only above/below).
export type WrapMode = 'inline' | 'left' | 'right' | 'topBottom';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (attrs: { src: string; alt?: string; width?: number | null; height?: number | null; rotation?: number; wrap?: WrapMode }) => ReturnType;
      setImageWrap: (wrap: WrapMode) => ReturnType;
    };
  }
}

export const MIN_SIZE_PX = 24;

// Corners keep aspect; edges (n/s/e/w) change one dimension only.
// Shared with textBox.ts, whose node view uses the same handle set.
export const HANDLES: { k: string; x: -1 | 0 | 1; y: -1 | 0 | 1; aspect: boolean }[] = [
  { k: 'nw', x: -1, y: -1, aspect: true },
  { k: 'n', x: 0, y: -1, aspect: false },
  { k: 'ne', x: 1, y: -1, aspect: true },
  { k: 'e', x: 1, y: 0, aspect: false },
  { k: 'se', x: 1, y: 1, aspect: true },
  { k: 's', x: 0, y: 1, aspect: false },
  { k: 'sw', x: -1, y: 1, aspect: true },
  { k: 'w', x: -1, y: 0, aspect: false },
];

export function parsePx(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseCm(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The page text width, live from the vars the editor maintains (margins/orientation).
const COLUMN_WIDTH_CSS =
  'calc(var(--user-page-width) - var(--user-margin-left) - var(--user-margin-right))';

// An as-character image wider than the text column takes a line of its own and leaves an
// empty one above it. Fitting it to the column is where an image the file sizes to the
// column lands anyway, once its cm/EMU width is rounded to whole px (importers).
export function fitInlineImage(attrs: Record<string, unknown>, maxWidthPx: number): void {
  const w = attrs.width;
  if (typeof w !== 'number' || w <= maxWidthPx) return;
  if (typeof attrs.height === 'number') attrs.height = Math.max(1, Math.round((attrs.height * maxWidthPx) / w));
  attrs.width = maxWidthPx;
}

// A floating frame's margins from its wrapOffset: its left edge in the text column,
// measured against the live column vars an indented anchor cannot skew (a right float
// is placed from the far side). wrapOffsetY becomes a top margin — see the attr's note.
export function frameMargins(wrap: WrapMode, offsetCm: unknown, boxWidthPx: number, offsetYCm?: unknown): string {
  const near = typeof offsetCm === 'number' ? `${Math.round(cmToPx(offsetCm))}px` : null;
  if (wrap === 'topBottom') {
    const top = typeof offsetYCm === 'number' && offsetYCm > 0 ? `${Math.round(cmToPx(offsetYCm))}px` : '6px';
    return `${top} 0 6px ${near ?? '0'}`;
  }
  if (wrap === 'left') return `0 14px 6px ${near ?? '0'}`;
  const far = near == null ? '0' : `calc(${COLUMN_WIDTH_CSS} - ${near} - ${boxWidthPx}px)`;
  return `0 ${far} 6px 14px`;
}

// The page text height in px, capping how tall an image can be stretched. Read live
// from the :root vars the editor maintains (orientation/margins change them).
export function pageContentHeightPx(): number {
  const cs = getComputedStyle(document.documentElement);
  const h =
    parseFloat(cs.getPropertyValue('--user-page-height')) -
    parseFloat(cs.getPropertyValue('--user-margin-top')) -
    parseFloat(cs.getPropertyValue('--user-margin-bottom'));
  return h > 0 ? h : 4000;
}

export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      // px @96dpi and CW degrees; kept off the width/height attrs (rendered via
      // inline style / data-rotation) so one place drives the node view.
      width: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('width') ?? (el as HTMLElement).style.width),
        renderHTML: () => ({}),
      },
      height: {
        default: null,
        parseHTML: el => parsePx(el.getAttribute('height') ?? (el as HTMLElement).style.height),
        renderHTML: () => ({}),
      },
      rotation: {
        default: 0,
        parseHTML: el => parsePx((el as HTMLElement).getAttribute('data-rotation')) ?? 0,
        renderHTML: () => ({}),
      },
      wrap: {
        default: 'inline',
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap') ?? 'inline',
        renderHTML: () => ({}),
      },
      // Where a floating frame sits in the text column: cm from the column's left edge
      // to the frame's left edge (Word's posOffset, ODF svg:x). null = flush to its side.
      wrapOffset: {
        default: null,
        parseHTML: el => parseCm((el as HTMLElement).getAttribute('data-wrap-offset')),
        renderHTML: () => ({}),
      },
      // How far below its anchor paragraph the frame sits, in cm (Word's positionV
      // posOffset, ODF svg:y). Drawn as the float's top margin for `topBottom`, where no
      // text sits beside the frame; a side float would push away lines Word keeps.
      wrapOffsetY: {
        default: null,
        parseHTML: el => parseCm((el as HTMLElement).getAttribute('data-wrap-offset-y')),
        renderHTML: () => ({}),
      },
      // Which end of its band a `topBottom` frame is set against (Word's positionH align,
      // ODF's style:horizontal-pos). Set only where two frames share the band, so they
      // sit side by side; a lone one fills the band, which is what the wrap means.
      wrapAlign: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-wrap-align') || null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const w = node.attrs.width as number | null;
    const h = node.attrs.height as number | null;
    const rot = (node.attrs.rotation as number) || 0;
    const wrap = (node.attrs.wrap as WrapMode) || 'inline';
    const offset = node.attrs.wrapOffset as number | null;
    const offsetY = node.attrs.wrapOffsetY as number | null;
    const style = [
      w ? `width:${w}px` : '',
      h ? `height:${h}px` : '',
      rot ? `transform:rotate(${rot}deg)` : '',
    ].filter(Boolean).join(';');
    return ['img', mergeAttributes(HTMLAttributes, {
      ...(style ? { style } : {}),
      ...(rot ? { 'data-rotation': String(rot) } : {}),
      ...(wrap !== 'inline' ? { 'data-wrap': wrap } : {}),
      ...(offset != null ? { 'data-wrap-offset': String(offset) } : {}),
      ...(offsetY != null ? { 'data-wrap-offset-y': String(offsetY) } : {}),
      ...(node.attrs.wrapAlign ? { 'data-wrap-align': String(node.attrs.wrapAlign) } : {}),
    })];
  },

  addCommands() {
    return {
      setImage:
        attrs =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),

      // Set the wrap mode on the selected image.
      setImageWrap:
        (wrap: WrapMode) =>
        ({ state, dispatch }) => {
          const sel = state.selection;
          if (!(sel instanceof NodeSelection) || sel.node.type.name !== this.name) return false;
          // Picking a side means "put it there", so the imported offset goes with it.
          if (dispatch) dispatch(state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, wrap, wrapOffset: null, wrapOffsetY: null }));
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new ImageView(node as PMNode, editor, getPos as () => number);
  },

  // The drop cursor paints a caret where a dragged-in image *file* lands; moving an
  // existing image uses the node view's live re-anchor drag, not PM's native node move.
  addProseMirrorPlugins() {
    return [dropCursor({ color: '#3b82f6', width: 2 })];
  },
});

// Node view: a bounding-box wrapper (reserves the rotated footprint for text flow)
// holds a centered, rotated "rotor" with the <img>, eight resize handles (corners
// aspect-locked, edges single-axis) and a rotate grip — all rotating with the image.
class ImageView {
  dom: HTMLElement;
  private rotor: HTMLElement;
  private img: HTMLImageElement;
  private badge: HTMLElement;
  private node: PMNode;
  private editor: Editor;
  private getPos: () => number;

  constructor(node: PMNode, editor: Editor, getPos: () => number) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('span');
    this.dom.className = 'image-node';

    this.rotor = document.createElement('span');
    this.rotor.className = 'image-rotor';

    this.img = document.createElement('img');
    this.img.src = (node.attrs.src as string) ?? '';
    this.img.alt = (node.attrs.alt as string) ?? '';
    // Pasted/HTML images may arrive without dimensions; adopt their natural size
    // (capped to the text column) so every image is explicitly sized.
    this.img.onload = () => this.adoptNaturalSize();
    // Dragging an image live re-anchors it to the text position under the cursor so the
    // surrounding text reflows in real time — inline and floating alike.
    this.img.addEventListener('mousedown', e => this.startReposition(e as MouseEvent));
    this.rotor.appendChild(this.img);

    for (const cfg of HANDLES) {
      const h = document.createElement('span');
      h.className = `image-resize-handle image-resize-${cfg.k}`;
      h.addEventListener('mousedown', e => this.startResize(e as MouseEvent, cfg));
      this.rotor.appendChild(h);
    }
    const rot = document.createElement('span');
    rot.className = 'image-rotate-handle';
    rot.addEventListener('mousedown', e => this.startRotate(e as MouseEvent));
    this.rotor.appendChild(rot);

    this.dom.appendChild(this.rotor);

    // Live "Width … × Height …" readout shown while resizing (on the axis-aligned
    // wrapper so it stays upright even when the image is rotated).
    this.badge = document.createElement('span');
    this.badge.className = 'image-size-badge';
    this.dom.appendChild(this.badge);

    this.applyLayout(this.attrW(), this.attrH(), this.attrRot());
    this.applyWrap();
    // The frame is not in the document yet, so a sunk one has nothing to measure against.
    requestAnimationFrame(() => this.sinkToOffset());
  }

  private showBadge(w: number, h: number): void {
    const cm = (px: number) => ((px * 2.54) / 96).toFixed(2);
    this.badge.textContent = `Width ${cm(w)} cm × Height ${cm(h)} cm`;
    this.badge.style.display = 'block';
  }

  private attrW(): number | null { const w = this.node.attrs.width; return typeof w === 'number' ? w : null; }
  private attrH(): number | null { const h = this.node.attrs.height; return typeof h === 'number' ? h : null; }
  private attrRot(): number { return (this.node.attrs.rotation as number) || 0; }
  private attrWrap(): WrapMode { const w = this.node.attrs.wrap; return w === 'left' || w === 'right' || w === 'topBottom' ? w : 'inline'; }
  // The wrapper's reserved (rotated) width, which applyLayout has just written.
  private boxWidth(): number { return parseFloat(this.dom.style.width) || this.attrW() || 0; }

  // Size the rotor to w×h, rotate it about its centre, and grow the axis-aligned
  // wrapper to the rotated bounding box so the line reserves the right space.
  private applyLayout(w: number | null, h: number | null, deg: number): void {
    if (w && h) {
      this.rotor.style.width = `${w}px`;
      this.rotor.style.height = `${h}px`;
      const rad = (deg * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      this.dom.style.width = `${bw}px`;
      this.dom.style.height = `${bh}px`;
    } else {
      this.rotor.style.width = '';
      this.rotor.style.height = '';
      this.dom.style.width = '';
      this.dom.style.height = '';
    }
    this.rotor.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
  }

  // Float the wrapper per wrap mode so text flows beside it at its anchor paragraph
  // (left/right) or only above/below it (topBottom). The live re-anchor drag keeps it
  // where the text is.
  private applyWrap(): void {
    const d = this.dom;
    const wrap = this.attrWrap();
    // Mirrors renderHTML's data-wrap, so one selector reaches a floating frame in the
    // live view and in generated static HTML alike.
    if (wrap === 'inline') delete d.dataset.wrap; else d.dataset.wrap = wrap;
    d.style.float = '';
    d.style.display = '';
    d.style.clear = '';
    d.style.margin = '';
    const a = this.node.attrs;
    if (wrap === 'left' || wrap === 'right') {
      d.style.float = wrap;
      d.style.margin = frameMargins(wrap, a.wrapOffset, this.boxWidth());
    } else if (wrap === 'topBottom' && (a.wrapAlign === 'left' || a.wrapAlign === 'right')) {
      // Sharing its band with the frame set against the other end (the importers only
      // keep wrapAlign for such a pair): each floats to its own side, so both fit.
      d.style.float = a.wrapAlign;
      d.style.clear = a.wrapAlign;
      d.style.margin = frameMargins(wrap, null, 0, a.wrapOffsetY);
      this.sinkToOffset();
    } else if (wrap === 'topBottom') {
      // A full-width float (not display:block — which on an inline atom node view
      // disrupts ProseMirror's view + page-break spacer widgets): text can only flow
      // above/below it. applyLayout reset the width to the box; widen to the column here.
      d.style.float = 'left';
      d.style.clear = 'both';
      d.style.width = '100%';
      d.style.margin = frameMargins(wrap, null, 0, a.wrapOffsetY);
      this.sinkToOffset();
    }
    // The wrapper spans the column, so the picture's own x is the rotor's place in it
    // (the rotor is centred by CSS); every other mode positions the wrapper itself.
    const x = wrap === 'topBottom' && !a.wrapAlign ? a.wrapOffset : null;
    this.rotor.style.left = typeof x === 'number'
      ? `${Math.round(cmToPx(x)) + (parseFloat(this.rotor.style.width) || 0) / 2}px` : '';
  }

  // The offset counts from the anchor paragraph's top. Where text precedes the frame
  // (the importers sink one behind the text — a full-width float pushes every following
  // line under itself) the lines already cover part of it, so the rest is measured.
  private sinkToOffset(): void {
    const y = this.node.attrs.wrapOffsetY;
    const p = this.dom.parentElement;
    if (typeof y !== 'number' || y <= 0 || !p || !this.dom.previousSibling) return;
    this.dom.style.marginTop = '0px';
    const box = p.getBoundingClientRect();
    const scale = box.width / p.offsetWidth || 1;
    const above = (this.dom.getBoundingClientRect().top - box.top) / scale;
    const gap = clamp(Math.round(cmToPx(y) - above), 6, pageContentHeightPx());
    this.dom.style.marginTop = `${gap}px`;
  }

  // Drag an image to re-anchor it live to the text position under the cursor (text
  // reflows in real time, throttled): a float re-anchors on a line change, an inline
  // image to the exact character. One undo step (later moves are addToHistory:false).
  private startReposition(event: MouseEvent): void {
    if (!this.editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    const view = this.editor.view;
    const origPos = this.getPos();
    if (typeof origPos !== 'number') return;
    const win = this.dom.ownerDocument.defaultView ?? window;

    let curPos = origPos;
    let firstMove = true;
    let moved = false;
    let raf = 0;
    let lastX = event.clientX;
    let lastY = event.clientY;

    const lineTop = (pos: number): number | null => {
      try { return view.coordsAtPos(pos).top; } catch { return null; }
    };

    // Re-anchor the image at the exact text position under the cursor (so it follows
    // line by line, not paragraph by paragraph), but only when the cursor's line differs
    // from the image's current line — a float won't move within a line, so skip churn.
    const step = (): void => {
      raf = 0;
      const found = view.posAtCoords({ left: lastX, top: lastY });
      if (!found) return;
      const target = found.pos;
      if (target === curPos || target === curPos + 1) return;
      const $t = view.state.doc.resolve(target);
      if (!$t.parent.isTextblock) return;
      // A float can't move within a line — skip re-anchoring until the cursor's line
      // changes; an inline image follows the cursor to the exact position.
      if (this.attrWrap() !== 'inline') {
        const curY = lineTop(curPos);
        const tgtY = lineTop(target);
        if (curY != null && tgtY != null && Math.abs(curY - tgtY) < 6) return;
      }
      const node = view.state.doc.nodeAt(curPos);
      if (!node || node.type.name !== 'image') return;
      try {
        const tr = view.state.tr;
        tr.delete(curPos, curPos + node.nodeSize);
        const ip = tr.mapping.map(target);
        tr.insert(ip, node);
        tr.setSelection(NodeSelection.create(tr.doc, ip));
        if (!firstMove) tr.setMeta('addToHistory', false);
        view.dispatch(tr);
        curPos = ip;
        firstMove = false;
        moved = true;
      } catch { /* target can't hold an inline image — ignore */ }
    };

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      lastX = e.clientX;
      lastY = e.clientY;
      if (!raf) raf = win.requestAnimationFrame(step);
    };
    const finish = (): void => {
      if (raf) win.cancelAnimationFrame(raf);
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      // A plain click (no move) just selects the image so its toolbar/handles show.
      if (!moved && typeof this.getPos() === 'number') {
        const pos = this.getPos();
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      }
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  private adoptNaturalSize(): void {
    if (this.attrW() != null && this.attrH() != null) return;
    const nw = this.img.naturalWidth;
    const nh = this.img.naturalHeight;
    if (!nw || !nh) return;
    const maxW = this.boxMaxWidth();
    let w = nw;
    let h = nh;
    if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
    this.commit({ width: Math.round(w), height: Math.round(h) });
  }

  // Largest width an image may take: the containing cell, else the page text column.
  private boxMaxWidth(): number {
    const box = (this.dom.closest('td,th') ?? this.dom.closest('.tiptap')) as HTMLElement | null;
    if (!box) return 10000;
    const cs = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    return Math.max(MIN_SIZE_PX, w || 10000);
  }

  private commit(attrs: Record<string, unknown>): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs }));
  }

  private startResize(event: MouseEvent, cfg: typeof HANDLES[number]): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const startW = this.rotor.offsetWidth;
    const startH = this.rotor.offsetHeight;
    if (!startW || !startH) return;
    const aspect = startW / startH;
    const deg = this.attrRot();
    const th = (deg * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    // The wrapper is axis-aligned, so its scaled/unscaled width ratio is the zoom.
    const zoom = this.dom.getBoundingClientRect().width / this.dom.offsetWidth || 1;
    const maxW = this.boxMaxWidth();
    const maxH = pageContentHeightPx();
    const sx = event.clientX;
    const sy = event.clientY;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastW = startW;
    let lastH = startH;
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      // Un-rotate the screen delta onto the image's own axes so handles track the
      // pointer at any rotation.
      const dx = (e.clientX - sx) / zoom;
      const dy = (e.clientY - sy) / zoom;
      const lx = dx * cosT + dy * sinT;
      const ly = -dx * sinT + dy * cosT;
      if (cfg.aspect) {
        let w = clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW);
        let h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        lastW = Math.round(w);
        lastH = Math.round(h);
      } else {
        if (cfg.x) lastW = Math.round(clamp(startW + cfg.x * lx, MIN_SIZE_PX, maxW));
        if (cfg.y) lastH = Math.round(clamp(startH + cfg.y * ly, MIN_SIZE_PX, maxH));
      }
      moved = true;
      this.applyLayout(lastW, lastH, deg);
      this.applyWrap();
      this.showBadge(lastW, lastH);
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      this.badge.style.display = 'none';
      if (moved) this.commit({ width: lastW, height: lastH });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  private startRotate(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.editor.isEditable) return;

    const w = this.rotor.offsetWidth;
    const h = this.rotor.offsetHeight;
    const rect = this.dom.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const win = this.dom.ownerDocument.defaultView ?? window;
    let lastDeg = this.attrRot();
    let moved = false;

    const move = (e: MouseEvent): void => {
      if (!e.buttons) { finish(); return; }
      // Handle sits above centre, so 0° is straight up; Shift snaps to 15°.
      let ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      lastDeg = ((Math.round(ang) % 360) + 360) % 360;
      moved = true;
      this.applyLayout(w, h, lastDeg);
      this.applyWrap();
    };
    const finish = (): void => {
      win.removeEventListener('mousemove', move);
      win.removeEventListener('mouseup', finish);
      if (moved) this.commit({ rotation: lastDeg });
    };
    win.addEventListener('mousemove', move);
    win.addEventListener('mouseup', finish);
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const src = (node.attrs.src as string) ?? '';
    if (this.img.getAttribute('src') !== src) this.img.src = src;
    this.img.alt = (node.attrs.alt as string) ?? '';
    this.applyLayout(this.attrW(), this.attrH(), this.attrRot());
    this.applyWrap();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('image-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('image-selected');
  }

  ignoreMutation(): boolean {
    return true;
  }

  // Keep ProseMirror out of all mouse handling on the image: startReposition owns the
  // drag (live re-anchor) for inline and floating images alike, and the resize/rotate
  // handles own theirs. Non-mouse events (keyboard, etc.) pass through to PM.
  stopEvent(event: Event): boolean {
    return event.type.startsWith('mouse');
  }
}
