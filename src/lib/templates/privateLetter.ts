import { t } from '../i18n/i18n.svelte';
import { toDateValue, DEFAULT_DATE_FORMAT } from '../utils/dateTime';
import type { TemplateData, TemplateEntry } from './types';

// Personal letter on the DIN 5008 window-envelope geometry: same 45mm address field
// and fold marks as Form B, but no info block — just a right-aligned place/date line.

// Sender block height in pt; the space that lands the return-address line at 45mm.
const LINE_PT = 12 * 1.15;
const MM_TO_PT = 72 / 25.4;
// 45mm target − 20mm margin − the three sender-address lines.
const RETURN_SPACE_BEFORE_PT = Math.round((45 - 20) * MM_TO_PT - 3 * LINE_PT);
// The return-address zone is 5mm tall; its 8pt line fills ~3.25mm of it.
const RETURN_SPACE_AFTER_PT = Math.round((5 * MM_TO_PT - 8 * 1.15) * 10) / 10;

type N = Record<string, unknown>;
const T = (text: string, ...marks: N[]): N => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const PLH = (text: string, ...marks: N[]): N => ({ type: 'placeholderField', attrs: { text }, ...(marks.length ? { marks } : {}) });
const P = (attrs: N | null, ...content: N[]): N => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
const SMALL = { type: 'textStyle', attrs: { fontSize: '8pt' } };
const BOLD = { type: 'bold' };

function buildLetter(): TemplateData {
  const L = t().templates.letter;
  const date: N = { type: 'dateTimeField', attrs: { kind: 'date', format: DEFAULT_DATE_FORMAT, fixed: true, value: toDateValue(new Date()) } };
  return {
    margins: { top: 2, bottom: 2, left: 2.5, right: 2 },
    foldMarks: true,
    content: {
      type: 'doc',
      content: [
        P(null, PLH(L.recipientName)),
        P(null, PLH(L.recipientStreet)),
        P(null, PLH(L.recipientCity)),
        // The one-line return address opens the address field at 45mm from the top.
        // fontSize also shrinks the paragraph mark, so the line box is 8pt tall.
        P({ spaceBefore: RETURN_SPACE_BEFORE_PT, spaceAfter: RETURN_SPACE_AFTER_PT, fontSize: '8pt' }, PLH(L.returnAddress, SMALL)),
        P(null, PLH(L.recipientName)),
        P(null, PLH(L.recipientStreet)),
        P(null, PLH(L.recipientCity)),
        P(null),
        P({ textAlign: 'right' }, PLH(L.place), T(', '), date),
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

export const privateLetter: TemplateEntry = {
  id: 'privateLetter',
  name: () => t().templates.privateLetter.name,
  description: () => t().templates.privateLetter.description,
  build: buildLetter,
};
