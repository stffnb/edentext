// The Navigator's own view settings, per browser like the other panes' layout:
// whether it is open, which side it docks on, its width, text size, tab and wrapping.
import { validLayout, type PaneLayout } from './panes.svelte';

export type NavigatorTab = 'headings' | 'pages' | 'bookmarks' | 'objects';
export type NavigatorSettings = PaneLayout & { open: boolean; wrap: boolean; tab: NavigatorTab };

const KEY = 'edentext-navigator';
export const NAVIGATOR_WIDTH = 240;
export const NAVIGATOR_TABS: NavigatorTab[] = ['headings', 'pages', 'bookmarks', 'objects'];
const DEFAULTS: NavigatorSettings = { open: false, side: 'right', size: 'medium', width: NAVIGATOR_WIDTH, wrap: false, tab: 'headings' };

function load(): NavigatorSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return {
      ...validLayout(raw, NAVIGATOR_WIDTH),
      open: raw.open === true,
      wrap: raw.wrap === true,
      tab: NAVIGATOR_TABS.includes(raw.tab) ? raw.tab : DEFAULTS.tab,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = $state(load());

export function navigatorSettings(): NavigatorSettings { return current; }

export function setNavigator(patch: Partial<NavigatorSettings>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* not kept */ }
}
