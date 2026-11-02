// The Navigator's own view settings, per browser like the AI pane's side and width:
// whether it is open, which side it docks on, its width, text size, tab and wrapping.

export type NavigatorSide = 'left' | 'right';
export type NavigatorSize = 'small' | 'medium' | 'large';
export type NavigatorTab = 'headings' | 'bookmarks' | 'objects';
export type NavigatorSettings = { open: boolean; side: NavigatorSide; size: NavigatorSize; width: number; wrap: boolean; tab: NavigatorTab };

const KEY = 'edentext-navigator';
export const NAVIGATOR_WIDTH = 240;
export const NAVIGATOR_SIZES: NavigatorSize[] = ['small', 'medium', 'large'];
export const NAVIGATOR_TABS: NavigatorTab[] = ['headings', 'bookmarks', 'objects'];
const DEFAULTS: NavigatorSettings = { open: false, side: 'right', size: 'medium', width: NAVIGATOR_WIDTH, wrap: false, tab: 'headings' };

function load(): NavigatorSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return {
      open: raw.open === true,
      side: raw.side === 'left' ? 'left' : 'right',
      size: NAVIGATOR_SIZES.includes(raw.size) ? raw.size : DEFAULTS.size,
      width: Number.isFinite(raw.width) ? raw.width : DEFAULTS.width,
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
