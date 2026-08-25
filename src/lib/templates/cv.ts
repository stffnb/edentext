import { t } from '../i18n/i18n.svelte';
import type { TemplateData, TemplateEntry } from './types';
import { BOLD, H, P, PLH, T, dateField } from './builders';

// Tabular CV: period column left, station right at a 4.5cm tab; the sections use
// the built-in heading styles, so they land in the outline and a TOC.
const COL = '4.5l';

function buildCv(): TemplateData {
  const L = t().templates.letter;
  const V = t().templates.cv;
  const entry = (role: string, where: string) =>
    P({ tabStops: COL }, PLH(V.period), T('\t'), PLH(role, BOLD), T(', '), PLH(where));
  return {
    margins: { top: 2, bottom: 2, left: 2, right: 2 },
    content: {
      type: 'doc',
      content: [
        H(1, PLH(L.recipientName)),
        P(null, PLH(L.recipientStreet), T(' · '), PLH(L.recipientCity), T(' · '), PLH(V.phone), T(' · '), PLH(V.email)),
        P(null),
        H(2, T(V.experience)),
        entry(V.role, V.employer),
        P({ indent: 4.5 }, PLH(V.roleDetail)),
        P(null),
        entry(V.role, V.employer),
        P({ indent: 4.5 }, PLH(V.roleDetail)),
        H(2, T(V.education)),
        entry(V.degree, V.school),
        P(null),
        entry(V.degree, V.school),
        H(2, T(V.skills)),
        P({ tabStops: COL }, T(V.languages), T('\t'), PLH(V.languagesValue)),
        P({ tabStops: COL }, T(V.it), T('\t'), PLH(V.itValue)),
        P(null),
        P(null),
        P(null, PLH(L.place), T(', '), dateField()),
        P(null),
        P(null),
        P(null),
        P(null, PLH(L.signature)),
      ],
    },
  };
}

export const cv: TemplateEntry = {
  id: 'cv',
  name: () => t().templates.cv.name,
  description: () => t().templates.cv.description,
  build: buildCv,
};
