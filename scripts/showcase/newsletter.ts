// A society newsletter: two-column articles, pictures with captions, a sidebar box, a
// schedule table and a treasurer's table with formulas. Sans-serif, A4.
// The photographs are NASA's (public domain): AS11-40-5875 and AS08-14-2383.
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import {
  T, P, H, BOLD, ITALIC, BR, UL, LI, SEQ, COLUMNS, IMAGE, HF, PAGE_NUMBER, picture, styledTable,
  type N, type Showcase,
} from './lib';

const NAVY = '#1F3A5F';
const WHITE = { type: 'textStyle', attrs: { color: '#FFFFFF' } };
const GREY = { type: 'textStyle', attrs: { color: '#5A6B7F' } };
const SMALL = { type: 'textStyle', attrs: { fontSize: '8pt' } };
const CAPTION = (n: number, text: string): N =>
  P({ styleName: 'Caption' }, T('Figure '), SEQ('figure', n), T(`: ${text}`));
// A navy band: the paragraph's own background, with borders of the same colour as padding.
const BAND = (extra: N): N => ({ backgroundColor: NAVY, borderTop: `6pt solid ${NAVY}`, borderBottom: `6pt solid ${NAVY}`,
  borderLeft: `8pt solid ${NAVY}`, borderRight: `8pt solid ${NAVY}`, borderPadding: 0, textAlign: 'left', ...extra });

export async function build(): Promise<Showcase> {
  const aldrin = await picture('aldrin.jpg');
  const earthrise = await picture('earthrise.jpg');

  const styles = builtinStyleSheet();
  styles.paragraph['Standard'].text = { fontFamily: 'Liberation Sans', fontSizePt: 10 };
  styles.paragraph['Standard'].para = { spaceAfter: 5, textAlign: 'justify' };
  styles.paragraph['Heading 2'].text = { fontSizePt: 12, color: NAVY };
  styles.paragraph['Heading 2'].para = { spaceBefore: 8, spaceAfter: 3 };

  const dates: N = { type: 'textBox', attrs: {
    width: 210, height: 236, fillColor: '#EEF3F8', strokeColor: NAVY, strokeWidthPt: 0.75,
    wrap: 'right', wrapDist: 0.4,
  }, content: [
    P({ spaceAfter: 4, textAlign: 'left' }, T('Dates this autumn', BOLD, { type: 'textStyle', attrs: { color: NAVY } })),
    UL(
      LI(P({ textAlign: 'left' }, T('12 September', BOLD), BR, T('Members’ evening, 7:30 pm'))),
      LI(P({ textAlign: 'left' }, T('26 September', BOLD), BR, T('Talk: “Back to the Moon”'))),
      LI(P({ textAlign: 'left' }, T('10 October', BOLD), BR, T('Public observing night, observatory'))),
      LI(P({ textAlign: 'left' }, T('7 November', BOLD), BR, T('Annual general meeting'))),
    ),
    P({ spaceBefore: 4, textAlign: 'left' }, T('Guests are welcome at every event.', ITALIC)),
  ] };

  const doc: N = { type: 'doc', content: [
    P(BAND({ styleName: 'Title', spaceAfter: 0, borderBottom: null }), T('Eden Astronomy Society', WHITE)),
    P(BAND({ spaceAfter: 10, borderTop: null }),
      T('NEWSLETTER  ·  ISSUE 3/2026  ·  SEPTEMBER 2026', WHITE, { type: 'textStyle', attrs: { fontSize: '9pt' } })),

    P({ spaceAfter: 8 }, T('Dear members and friends,', ITALIC), BR,
      T('the short nights are over, and with September our observing season begins. In this issue we look back at the solar eclipse of 12 August, invite you to a talk on the return to the Moon, and present the treasurer’s report for the first half of the year. Clear skies, the committee.', ITALIC)),

    COLUMNS(2, 0.8,
      H(2, T('Talk: Back to the Moon')),
      P(null, T('On 26 September Dr Miriam Falk of the city planetarium speaks about the Artemis missions and about what has changed in technology and ambition since Apollo. The talk starts at 7:30 pm in the society rooms; admission is free, and a donation towards the speaker’s travel is welcome.')),
      P({ textAlign: 'center', spaceAfter: 0 }, IMAGE(aldrin, 318, 329, { alt: 'Buzz Aldrin beside the flag' })),
      CAPTION(1, 'Edwin “Buzz” Aldrin beside the flag, Apollo 11, July 1969. Photo: NASA.'),
      P(null, T('For those who want to prepare: the society archive holds the original photographs of the landings in high resolution, along with maps of the landing sites. The 8-inch Newtonian shows the regions well on a waxing Moon, best two or three days after first quarter, when the terminator runs across the Sea of Tranquillity.')),

      H(2, T('Looking back: the eclipse in Spain')),
      P(null, T('Fourteen members travelled to northern Spain for the total solar eclipse on 12 August. After an overcast morning the sky cleared an hour before second contact, and the one minute and forty seconds of totality were seen in full from the high ground near Burgos. The corona showed three long streamers, and a prominence on the eastern limb was visible to the naked eye.')),
      P(null, T('The group’s photographs are on the members’ pages of the website. A slide show follows at the members’ evening in December.')),

      H(2, T('Picture of the month')),
      P({ textAlign: 'center', spaceAfter: 0 }, IMAGE(earthrise, 260, 260, { alt: 'Earthrise over the Moon' })),
      CAPTION(2, 'Earthrise, photographed from Apollo 8 on 24 December 1968. Photo: NASA.'),
      P(null, T('This month not a picture from the observatory but a historic one: the Earthrise that William Anders photographed in 1968 on the fourth orbit of the Moon. It fits the theme of the talk, and it is a reminder of why we look up in the first place.')),
    ),

    H(2, T('Observing nights this autumn')),
    P(null, T('Observing nights take place at the Oak Hill observatory whenever the sky is clear. Whether an evening goes ahead is decided by the leader by 5 pm; the announcement is then on the website and in the members’ group. Dress warmly and bring a red torch.')),
    styledTable('List Table Accent', [
      ['Date', 'Objects', 'Instrument', 'Led by'],
      ['19 September', 'Saturn, Neptune', '8-inch Newtonian', 'K. Brandt'],
      ['3 October', 'Andromeda Galaxy, the Double Cluster', 'Binoculars, refractor', 'S. Öztürk'],
      ['17 October', 'Moon (waxing), Jupiter', '8-inch Newtonian', 'K. Brandt'],
      ['31 October', 'Pleiades, Orion Nebula', 'Refractor', 'A. Lindgren'],
      ['14 November', 'Leonids, Uranus', 'Binoculars', 'S. Öztürk'],
    ], { widths: [110, 240, 170, 100] }),
    P({ spaceAfter: 2 }, T('')),
    P(null, T('For the Leonids on 14 November we meet at 11 pm; the meteors are most frequent after midnight. Members bringing their own telescope will find power sockets on the east side of the observatory.')),

    H(2, T('Treasurer’s report, first half of 2026')),
    P(null, dates, T('The society is on a sound footing. Subscriptions cover the running costs; the telescope service was a one-off expense met from the reserve. The totals in the table are computed from the individual items.')),
    styledTable('Financial', [
      ['Item', 'Income (€)', 'Expenditure (€)'],
      ['Subscriptions', '2450.00', ''],
      ['Donations', '380.00', ''],
      ['Talks and events', '215.50', ''],
      ['Telescope service', '', '640.00'],
      ['Rent, society rooms', '', '900.00'],
      ['Insurance', '', '210.00'],
      ['Total', '3045.50', '1750.00'],
      ['Balance', '1295.50', ''],
    ], { widths: [200, 120, 120], numeric: [1, 2], cellFormat: 'dec2',
      formulas: { B8: '=SUM(B2:B7)', C8: '=SUM(C2:C7)', B9: '=B8-C8' } }),
    P({ spaceAfter: 2 }, T('')),
    P(null, T('The full report will be available at the annual general meeting on 7 November. The treasurer is happy to answer questions by e-mail beforehand.')),

    P({ spaceBefore: 14, borderTop: '0.5pt solid #5A6B7F', borderPadding: 4 },
      T('Imprint: ', BOLD, GREY, SMALL),
      T('Eden Astronomy Society, Oak Hill Observatory. Edited by the committee. Published four times a year. Contributions for the next issue to the editors by 15 November.', GREY, SMALL)),
  ] };

  const footer = HF({ tabStops: '18r' }, T('Eden Astronomy Society  ·  Newsletter 3/2026', GREY, SMALL),
    T('\tPage ', GREY, SMALL), PAGE_NUMBER);

  return {
    name: 'newsletter', doc, styles,
    margins: { top: 1.5, bottom: 1.5, left: 1.5, right: 1.5 },
    hf: { header: null, footer, pageCount: 2, headerDistanceCm: 0.8, footerDistanceCm: 0.8 },
    language: { language: 'en', country: 'GB' },
    hyphenate: true,
    props: { title: 'Newsletter 3/2026', subject: 'Eden Astronomy Society', author: 'The committee', keywords: 'astronomy, society', description: '' },
    shots: [
      { file: 'newsletter', page: 1, tab: 'layout' },
      { file: 'newsletter-tables', page: 2, tab: 'tableLayout', caret: '.tiptap table td' },
    ],
  };
}
