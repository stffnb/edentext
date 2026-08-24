import { t } from '../i18n/i18n.svelte';
import { toDateValue, DEFAULT_DATE_FORMAT } from '../utils/dateTime';
import type { TemplateData, TemplateEntry } from './types';

// DIN 5008 Form B business letter. All vertical positions are paragraph rhythm from a
// 20mm top margin at 12pt single spacing (one line ≈ 4.87mm — Liberation Serif's
// natural line height is ~1.15em); the mm targets below are the norm's.

// Letterhead line height in pt; the space that lands the return-address line at 45mm.
const LINE_PT = 12 * 1.15;
const MM_TO_PT = 72 / 25.4;
// 45mm target − 20mm margin − one letterhead line.
const RETURN_SPACE_BEFORE_PT = Math.round((45 - 20) * MM_TO_PT - LINE_PT);
// The return-address zone is 5mm tall; its 8pt line fills ~3.25mm of it.
const RETURN_SPACE_AFTER_PT = Math.round((5 * MM_TO_PT - 8 * 1.15) * 10) / 10;
// Info block at 125mm from the paper edge = 10cm from the 25mm text margin.
const INFO_TAB = '10l';

type N = Record<string, unknown>;
const T = (text: string, ...marks: N[]): N => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const PLH = (text: string, ...marks: N[]): N => ({ type: 'placeholderField', attrs: { text }, ...(marks.length ? { marks } : {}) });
const P = (attrs: N | null, ...content: N[]): N => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
const SMALL = { type: 'textStyle', attrs: { fontSize: '8pt' } };
const BOLD = { type: 'bold' };

function buildLetter(): TemplateData {
  const L = t().templates.letter;
  // An info line with no address half indents to the column instead of leading with
  // a tab (a tab with nothing before it stays on the default grid).
  const addressRow = (attrs: N | null, addr: N[], info: N[]): N =>
    addr.length
      ? P({ ...(attrs ?? {}), tabStops: INFO_TAB }, ...addr, T('\t'), ...info)
      : P({ ...(attrs ?? {}), indent: 10 }, ...info);
  const date: N = { type: 'dateTimeField', attrs: { kind: 'date', format: DEFAULT_DATE_FORMAT, fixed: true, value: toDateValue(new Date()) } };
  return {
    margins: { top: 2, bottom: 2, left: 2.5, right: 2 },
    foldMarks: true,
    content: {
      type: 'doc',
      content: [
        P(null, PLH(L.companyName, BOLD)),
        // The one-line return address opens the address field at 45mm from the top.
        // fontSize also shrinks the paragraph mark, so the line box is 8pt tall.
        P({ spaceBefore: RETURN_SPACE_BEFORE_PT, spaceAfter: RETURN_SPACE_AFTER_PT, fontSize: '8pt' }, PLH(L.returnAddress, SMALL)),
        addressRow(null, [PLH(L.recipientCompany)], [T(L.yourRef), PLH(L.reference)]),
        addressRow(null, [PLH(L.recipientName)], [T(L.yourMessage), PLH(L.date)]),
        addressRow(null, [PLH(L.recipientStreet)], [T(L.ourRef), PLH(L.reference)]),
        addressRow(null, [PLH(L.recipientCity)], [T(L.phone), PLH(L.phoneNumber)]),
        addressRow(null, [], [T(L.email), PLH(L.emailAddress)]),
        addressRow(null, [], [T(L.dateLabel), date]),
        P(null),
        P(null),
        P(null, PLH(L.subject, BOLD)),
        P(null),
        P(null, PLH(L.salutation)),
        P(null),
        P(null, PLH(L.bodyText)),
        P(null),
        P(null, T(L.closing)),
        P(null),
        P(null),
        P(null),
        P(null, PLH(L.signature)),
      ],
    },
  };
}

export const din5008b: TemplateEntry = {
  id: 'din5008b',
  name: () => t().templates.din5008b.name,
  description: () => t().templates.din5008b.description,
  build: buildLetter,
};
