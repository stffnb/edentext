// The font picker's list: a few always-shown faces, the recently used ones, and
// whatever detection finds installed. Shared state, so every picker agrees.

import { detectInstalledFonts, queryLocalFontsIfAllowed, supportsLocalFontAccess } from '../../utils/fontDetect';

export const WEB_SAFE_FONTS: readonly string[] = [
  'Liberation Serif', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New',
];
const WEB_SAFE_SET = new Set<string>(WEB_SAFE_FONTS);

const RECENT_KEY = 'odf-editor-recent-fonts';
const MAX_RECENT = 5;

let recents = $state<string[]>(load());
let detected = $state<string[]>([]);
let allInstalled = $state<string[] | null>(null);
let detectionRan = false;

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch { return []; }
}

export function recentFonts(): string[] {
  return recents;
}

export function noteFontUse(font: string): void {
  recents = [font, ...recents.filter((f) => f !== font)].slice(0, MAX_RECENT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recents)); } catch { /* quota or disabled */ }
}

// Everything installed that isn't already listed above, alphabetical.
export function otherFonts(): string[] {
  const recentSet = new Set(recents);
  return (allInstalled ?? detected)
    .filter((f) => !WEB_SAFE_SET.has(f) && !recentSet.has(f))
    .sort((a, b) => a.localeCompare(b));
}

export function canListAllFonts(): boolean {
  return supportsLocalFontAccess() && allInstalled === null;
}

export async function ensureDetection(): Promise<void> {
  if (detectionRan) return;
  detectionRan = true;
  detected = await detectInstalledFonts();
}

// The Local Font Access API, which needs a user gesture and a permission grant.
export async function listAllFonts(): Promise<void> {
  const list = await queryLocalFontsIfAllowed();
  if (list && list.length > 0) allInstalled = list;
}
