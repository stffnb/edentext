// The chapter a page runs under (ODF text:chapter, probed from LibreOffice): the
// header shows the chapter in force at the page's top — a heading counts there only
// once it opens a page — while the footer shows the last one begun on the page.
export type ChapterStart = { page: number; level: number; text: string; atTop?: boolean };

export function chapterOn(
  starts: readonly ChapterStart[], page: number, level: number, zone: 'header' | 'footer',
): string {
  let text = '';
  for (const c of starts) {
    if (c.page > page || (zone === 'header' && c.page === page && !c.atTop)) continue;
    if (c.level <= level) text = c.text;
  }
  return text;
}
