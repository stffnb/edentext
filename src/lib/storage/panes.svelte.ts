// The docked panes' layout, per browser: the side each docks on, its width and text
// size. The reviewing panes keep theirs here; the navigator keeps it with its own settings.

import { uiRtl } from '../i18n/i18n.svelte';

export type PaneSide = 'left' | 'right';
export type PaneSize = 'small' | 'medium' | 'large';
/** `side` is a physical side once chosen; unset, the pane follows the interface (`dockSide`). */
export type PaneLayout = { side?: PaneSide; size: PaneSize; width: number };
export type ReviewPane = 'comments' | 'revisions';

export const PANE_SIZES: PaneSize[] = ['small', 'medium', 'large'];
export const REVIEW_PANE_WIDTH = 260;

const KEY = 'edentext-panes';

/** The side a pane docks on: the one chosen, else the interface's end side. */
export function dockSide(chosen: unknown): PaneSide {
  return chosen === 'left' || chosen === 'right' ? chosen : uiRtl() ? 'left' : 'right';
}

/** A stored layout with every field checked, the defaults filling what is missing or wrong. */
export function validLayout(raw: unknown, width: number): PaneLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    side: r.side === 'left' || r.side === 'right' ? r.side : undefined,
    size: PANE_SIZES.includes(r.size as PaneSize) ? (r.size as PaneSize) : 'medium',
    width: typeof r.width === 'number' && Number.isFinite(r.width) ? r.width : width,
  };
}

function load(): Record<ReviewPane, PaneLayout> {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* defaults */ }
  return {
    comments: validLayout(raw.comments, REVIEW_PANE_WIDTH),
    revisions: validLayout(raw.revisions, REVIEW_PANE_WIDTH),
  };
}

let current = $state(load());

export function paneLayout(pane: ReviewPane): PaneLayout { return current[pane]; }

export function setPaneLayout(pane: ReviewPane, patch: Partial<PaneLayout>): void {
  current = { ...current, [pane]: { ...current[pane], ...patch } };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* not kept */ }
}

/** A pane's width kept between its minimum and half the window. */
export function clampPaneWidth(w: number, min: number): number {
  return Math.round(Math.min(Math.max(min, window.innerWidth * 0.5), Math.max(min, w)));
}
