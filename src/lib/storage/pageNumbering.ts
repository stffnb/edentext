import type { NoteNumFormat } from './noteSettings';

// How the page-number field counts: Word's Insert ▸ Page Number ▸ Format Page Numbers,
// LibreOffice's page style ▸ Layout Settings. ODF keeps the format on the page layout
// (`style:num-format`) and the start on the first paragraph (`style:page-number`);
// Word keeps both in the section's `w:pgNumType`.

export type PageNumbering = { format: NoteNumFormat; start: number };

const KEY = 'edentext-page-numbering';

export const DEFAULT_PAGE_NUMBERING: PageNumbering = { format: '1', start: 1 };

// The five both word processors offer, in their own order.
export const PAGE_NUM_FORMATS: NoteNumFormat[] = ['1', 'i', 'I', 'a', 'A'];

export function clampPageStart(n: number): number {
  return Number.isFinite(n) ? Math.min(9999, Math.max(1, Math.round(n))) : 1;
}

export function loadPageNumbering(): PageNumbering {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PAGE_NUMBERING };
    const data = JSON.parse(raw) as Partial<PageNumbering>;
    return {
      format: PAGE_NUM_FORMATS.includes(data.format as NoteNumFormat) ? data.format as NoteNumFormat : '1',
      start: clampPageStart(Number(data.start)),
    };
  } catch {
    return { ...DEFAULT_PAGE_NUMBERING };
  }
}

export function savePageNumbering(value: PageNumbering): void {
  if (value.format === '1' && value.start === 1) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(value));
}
