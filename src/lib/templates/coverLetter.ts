import { t } from '../i18n/i18n.svelte';
import type { TemplateData, TemplateEntry } from './types';
import { BOLD, LINE_PT, MM_TO_PT, P, PLH, RETURN_SPACE_AFTER_PT, SMALL, T, dateField } from './builders';

// Job-application cover letter on the personal letter's window-envelope geometry:
// a five-line sender block, the 45mm address field, then the application body.

// 45mm target − 20mm margin − the five sender lines.
const RETURN_SPACE_BEFORE_PT = Math.round((45 - 20) * MM_TO_PT - 5 * LINE_PT);

function buildLetter(): TemplateData {
  const L = t().templates.letter;
  const C = t().templates.coverLetter;
  return {
    margins: { top: 2, bottom: 2, left: 2.5, right: 2 },
    foldMarks: true,
    content: {
      type: 'doc',
      content: [
        P(null, PLH(L.recipientName)),
        P(null, PLH(L.recipientStreet)),
        P(null, PLH(L.recipientCity)),
        P(null, PLH(C.phone)),
        P(null, PLH(C.email)),
        // The one-line return address opens the address field at 45mm from the top.
        // fontSize also shrinks the paragraph mark, so the line box is 8pt tall.
        P({ spaceBefore: RETURN_SPACE_BEFORE_PT, spaceAfter: RETURN_SPACE_AFTER_PT, fontSize: '8pt' }, PLH(L.returnAddress, SMALL)),
        P(null, PLH(L.recipientCompany)),
        P(null, PLH(L.recipientName)),
        P(null, PLH(L.recipientStreet)),
        P(null, PLH(L.recipientCity)),
        P(null),
        P({ textAlign: 'right' }, PLH(L.place), T(', '), dateField()),
        P(null),
        P(null),
        P(null, T(C.subject, BOLD), PLH(C.position, BOLD)),
        P(null, T(C.subjectRef), PLH(L.date)),
        P(null),
        P(null, PLH(L.salutation)),
        P(null),
        P(null, PLH(C.intro)),
        P(null),
        P(null, PLH(C.main)),
        P(null),
        P(null, PLH(C.final)),
        P(null),
        P(null, T(L.closing)),
        P(null),
        P(null),
        P(null),
        P(null, PLH(L.signature)),
        P(null),
        P(null, T(C.enclosuresLabel), PLH(C.enclosures)),
      ],
    },
  };
}

export const coverLetter: TemplateEntry = {
  id: 'coverLetter',
  name: () => t().templates.coverLetter.name,
  description: () => t().templates.coverLetter.description,
  build: buildLetter,
};
