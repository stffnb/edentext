// The chapter a page runs under (ODF text:chapter, probed from LibreOffice): the
// header shows the chapter in force at the page's top — a heading counts there only
// once it opens a page — while the footer shows the last one begun on the page.
// `number` is the heading's numbering label, `plain` its bare ordinals, where it has one.
export type ChapterStart = { page: number; level: number; text: string; atTop?: boolean; number?: string; plain?: string };
// ODF text:display: the heading's name, its number, or both.
export type ChapterDisplay = 'name' | 'number-and-name' | 'number' | 'plain-number';
export const CHAPTER_DISPLAYS: readonly ChapterDisplay[] = ['name', 'number-and-name', 'number', 'plain-number'];

export function chapterOn(
  starts: readonly ChapterStart[], page: number, level: number, zone: 'header' | 'footer',
  display: ChapterDisplay = 'name',
): string {
  let at: ChapterStart | null = null;
  for (const c of starts) {
    if (c.page > page || (zone === 'header' && c.page === page && !c.atTop)) continue;
    if (c.level <= level) at = c;
  }
  if (!at) return '';
  // A line break in the heading is a space in the running head, which stays one line.
  const name = at.text.replace(/\s*\n\s*/g, ' ');
  if (display === 'number') return at.number ?? '';
  if (display === 'plain-number') return at.plain ?? '';
  return display === 'number-and-name' && at.number ? `${at.number} ${name}` : name;
}
