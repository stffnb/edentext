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

// The number a page shows: counted from the nearest section at or above it that
// restarts numbering, else from the document's start. `starts[0]` is the document's;
// a section that counts on carries null.
export function printedPageNumber(
  page: number,
  section: number,
  starts: (number | null)[],
  firstPage: (index: number) => number,
): number {
  for (let i = Math.min(section, starts.length - 1); i > 0; i--) {
    const start = starts[i];
    if (start != null) return page - firstPage(i) + start;
  }
  return page - 1 + (starts[0] ?? 1);
}

// Mirrored margins and the left-page header follow the page *number*, not the sheet:
// probed, LibreOffice calls a page left when its number is even, so a document that
// restarts numbering on the wrong parity really does show two left pages in a row.
export const isLeftPage = (printed: number): boolean => printed % 2 === 0;

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
