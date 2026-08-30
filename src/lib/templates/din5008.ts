import { t } from '../i18n/i18n.svelte';
import type { TemplateData, TemplateEntry } from './types';
import { BOLD, LINE_PT, MM_TO_PT, P, PLH, RETURN_SPACE_AFTER_PT, SMALL, T, dateField, type N } from './builders';

// The two DIN 5008 business-letter forms, differing only in where the address field
// opens: Form A at 27mm (a one-line letterhead), Form B at 45mm (a full one). Vertical
// positions are paragraph rhythm from a 20mm top margin at 12pt (one line ≈ 4.87mm).

// Info block at 125mm from the paper edge = 10cm from the 25mm text margin.
const INFO_TAB = '10l';

function buildLetter(headMm: number): TemplateData {
  const L = t().templates.letter;
  // The address field's mm target − the 20mm margin − one letterhead line.
  const returnSpaceBefore = Math.round((headMm - 20) * MM_TO_PT - LINE_PT);
  // An info line with no address half indents to the column instead of leading with
  // a tab (a tab with nothing before it stays on the default grid).
  const addressRow = (attrs: N | null, addr: N[], info: N[]): N =>
    addr.length
      ? P({ ...(attrs ?? {}), tabStops: INFO_TAB }, ...addr, T('\t'), ...info)
      : P({ ...(attrs ?? {}), indent: 10 }, ...info);
  return {
    margins: { top: 2, bottom: 2, left: 2.5, right: 2 },
    foldMarks: true,
    content: {
      type: 'doc',
      content: [
        P(null, PLH(L.companyName, BOLD)),
        // The one-line return address opens the address field at its mm target.
        // fontSize also shrinks the paragraph mark, so the line box is 8pt tall.
        P({ spaceBefore: returnSpaceBefore, spaceAfter: RETURN_SPACE_AFTER_PT, fontSize: '8pt' }, PLH(L.returnAddress, SMALL)),
        // Two notation lines above the address (DIN's Zusatz- und Vermerkzone, filled
        // bottom-up), sharing their rows with the top of the info block.
        addressRow(null, [], [T(L.yourRef), PLH(L.reference)]),
        addressRow(null, [PLH(L.remark)], [T(L.yourMessage), PLH(L.date)]),
        addressRow(null, [PLH(L.recipientCompany)], [T(L.ourRef), PLH(L.reference)]),
        addressRow(null, [PLH(L.recipientName)], [T(L.phone), PLH(L.phoneNumber)]),
        addressRow(null, [PLH(L.recipientStreet)], [T(L.email), PLH(L.emailAddress)]),
        addressRow(null, [PLH(L.recipientCity)], [T(L.dateLabel), dateField()]),
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
  build: () => buildLetter(45),
};

export const din5008a: TemplateEntry = {
  id: 'din5008a',
  name: () => t().templates.din5008a.name,
  description: () => t().templates.din5008a.description,
  build: () => buildLetter(27),
};
