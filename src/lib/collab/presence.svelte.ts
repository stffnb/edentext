import type { Awareness } from 'y-protocols/awareness';

// Going to someone's caret and following it (docs/architecture/collab.md). Both only read
// the awareness that arrives anyway and scroll this view: nothing is sent, and this
// client's own selection stays. A held header or footer is marked on the page it was
// opened on (`HeaderFooterLayer`), which stands in for the caret the zone takes away.

let shared: Awareness | null = null;
let followed = $state<number | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Where someone is: in the body, in a zone, or nowhere a view can go. */
export function whereIs(id: number): 'caret' | 'zone' | null {
  const s = shared?.getStates().get(id);
  return typeof s?.zone === 'string' ? 'zone' : s?.cursor ? 'caret' : null;
}

function target(id: number): HTMLElement | null {
  const where = whereIs(id);
  return where === 'zone' ? document.querySelector(`[data-zone-peer="${id}"]`)
    : where === 'caret' ? document.querySelector(`.tiptap-host .ProseMirror-yjs-cursor[data-client="${id}"]`) : null;
}

/** Scrolls `el` a third of the way down the page view, unless `gently` and it shows already. */
function reveal(el: HTMLElement, gently: boolean): void {
  const scroller = document.querySelector('.tiptap-host .tiptap')?.closest('.editor');
  if (!scroller) return;
  const at = el.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const inY = at.top >= box.top + 40 && at.bottom <= box.bottom - 40;
  const inX = at.left >= box.left + 20 && at.right <= box.right - 20;
  if (gently && inY && inX) return;
  // Glides over a short way; a long one jumps, so the view never trails the caret. The
  // goal is absolute: Firefox adds a scrollBy to the end of a glide still under way.
  const top = inY && gently ? 0 : at.top - (box.top + box.height / 3);
  const smooth = Math.abs(top) < 2 * box.height && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollTo({
    top: scroller.scrollTop + top,
    left: scroller.scrollLeft + (inX ? 0 : at.left - (box.left + box.width / 3)),
    behavior: smooth ? 'smooth' : 'auto',
  });
}

/** Brings someone's caret or zone into view and marks it a moment; false when there is none. */
export function jumpTo(id: number): boolean {
  const el = target(id);
  if (!el) return false;
  reveal(el, false);
  document.querySelectorAll('.collab-flash').forEach((e) => e.classList.remove('collab-flash'));
  el.classList.add('collab-flash');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('collab-flash'), 1600);
  return true;
}

export function following(): number | null {
  return followed;
}

/** Keeps `id`'s caret in view until this user scrolls, clicks or types, or they leave. */
export function follow(id: number | null): void {
  followed = id;
  if (id !== null) jumpTo(id);
}

// Input from this user ends following; the people row itself toggles it.
function own(e: Event): void {
  if (followed === null || (e.target instanceof Element && e.target.closest('.collab-people'))) return;
  followed = null;
}
const INPUT = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

function moved({ updated, removed }: { updated: number[]; removed: number[] }): void {
  const id = followed;
  if (id === null) return;
  if (removed.includes(id) || !shared?.getStates().has(id)) { followed = null; return; }
  // The caret is drawn once the cursor plugin has taken the change.
  if (updated.includes(id)) setTimeout(() => { const el = followed === id && target(id); if (el) reveal(el, true); }, 30);
}

/** Follows a session's awareness, or stops with null. */
export function bindPresence(awareness: Awareness | null): void {
  shared?.off('change', moved);
  if (shared && !awareness) for (const k of INPUT) removeEventListener(k, own, true);
  if (!shared && awareness) for (const k of INPUT) addEventListener(k, own, { capture: true, passive: true });
  shared = awareness;
  followed = null;
  awareness?.on('change', moved);
}
