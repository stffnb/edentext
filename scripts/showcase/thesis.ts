// A master's thesis: numbered chapters, contents, footnotes, formulas, a figure and
// tables with captions, cross-references, citations with a bibliography, an index and a
// running header. `review` adds tracked changes, comments and a DRAFT watermark.
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import {
  T, P, H, BOLD, ITALIC, OL, LI, FORMULA, SEQ, CITE, IDX, FOOTNOTE, NOTE, INDEX, IMAGE, HF,
  PAGE_NUMBER, svgDataUrl, styledTable, type N, type Showcase,
} from './lib';

const CHART = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="260" viewBox="0 0 560 260" font-family="Liberation Sans, Arial, sans-serif" font-size="12">
<rect width="560" height="260" fill="#fff"/>
<g stroke="#bbb" stroke-width="1"><line x1="200" y1="20" x2="200" y2="215"/><line x1="200" y1="215" x2="540" y2="215"/></g>
<g stroke="#e4e4e4" stroke-dasharray="3 3"><line x1="268" y1="20" x2="268" y2="215"/><line x1="336" y1="20" x2="336" y2="215"/><line x1="404" y1="20" x2="404" y2="215"/><line x1="472" y1="20" x2="472" y2="215"/><line x1="540" y1="20" x2="540" y2="215"/></g>
<g fill="#666" text-anchor="middle"><text x="200" y="232">0</text><text x="268" y="232">20</text><text x="336" y="232">40</text><text x="404" y="232">60</text><text x="472" y="232">80</text><text x="540" y="232">100</text><text x="370" y="252">Page breaks on the reference line (%)</text></g>
<g fill="#9fb6d1"><rect x="200" y="32" width="233" height="26"/><rect x="200" y="78" width="269" height="26"/></g>
<g fill="#3f6a9c"><rect x="200" y="124" width="311" height="26"/><rect x="200" y="170" width="327" height="26"/></g>
<g fill="#222" text-anchor="end"><text x="190" y="49">Greedy</text><text x="190" y="95">Greedy + widow/orphan</text><text x="190" y="141">Cost model</text><text x="190" y="187">Cost model + keeps</text></g>
<g fill="#222"><text x="438" y="49">68.4</text><text x="474" y="95">79.1</text><text x="516" y="141">91.6</text><text x="532" y="187">96.2</text></g>
</svg>`);

const AUTHOR = 'Nora Weiland';
const REVIEWER = 'Prof. Halvorsen';
const BOOKMARK = (name: string) => ({ type: 'bookmark', attrs: { name } });
const REF = (name: string, format: 'text' | 'page', text: string): N =>
  ({ type: 'crossRef', attrs: { name, format, text } });
const FRONT = (text: string): N => P({ styleName: 'Front Matter Heading', breakBefore: 'page' }, T(text));
const CAP = (category: 'figure' | 'table', n: number, text: string, bookmark?: string): N =>
  P({ styleName: 'Caption', textAlign: 'center' },
    T(category === 'figure' ? 'Figure ' : 'Table ', ...(bookmark ? [BOOKMARK(bookmark)] : [])), SEQ(category, n), T(`: ${text}`));

const KNUTH = () => CITE('Knuth1981', 'article', { author: 'Knuth, D. E., & Plass, M. F.', title: 'Breaking paragraphs into lines', year: '1981', publisher: 'Software: Practice and Experience, 11(11), 1119–1184' });
const PLASS = () => CITE('Plass1981', 'phdthesis', { author: 'Plass, M. F.', title: 'Optimal pagination techniques for automatic typesetting systems', year: '1981', publisher: 'Stanford University' });
const BRINGHURST = () => CITE('Bringhurst2004', 'book', { author: 'Bringhurst, R.', title: 'The elements of typographic style (3rd ed.)', year: '2004', publisher: 'Hartley & Marks' });
const BKW = () => CITE('Brueggemann2003', 'inproceedings', { author: 'Brüggemann-Klein, A., Klein, R., & Wohlfeil, S.', title: 'On the pagination of complex documents', year: '2003', publisher: 'Computer Science in Perspective, LNCS 2598, 49–68. Springer' });
const MITTELBACH = () => CITE('Mittelbach2016', 'inproceedings', { author: 'Mittelbach, F.', title: 'A general framework for globally optimized pagination', year: '2016', publisher: 'Proceedings of the ACM Symposium on Document Engineering, 11–20. ACM' });
const ODF = () => CITE('OASIS2021', 'techreport', { author: 'OASIS', title: 'Open Document Format for Office Applications (OpenDocument) Version 1.3', year: '2021', publisher: 'OASIS Standard' });
const CSS = () => CITE('W3C2018', 'techreport', { author: 'W3C', title: 'CSS Fragmentation Module Level 3', year: '2018', publisher: 'W3C Candidate Recommendation' });

export function build(review = false): Showcase {
  const styles = builtinStyleSheet();
  styles.paragraph['Standard'].para = { textAlign: 'justify', lineHeight: '1.15', spaceAfter: 6 };
  styles.paragraph['Front Matter Heading'] = { name: 'Front Matter Heading', parent: 'Heading 1', next: 'Standard',
    para: { spaceAfter: 12 }, text: {} };
  styles.paragraph['Heading 1'].para = { spaceBefore: 0, spaceAfter: 18 };
  styles.paragraph['Heading 1'].text = { fontSizePt: 22 };
  styles.outline = [
    { format: '1', prefix: '', suffix: '  ', displayLevels: 1, start: 1 },
    { format: '1', prefix: '', suffix: '  ', displayLevels: 2, start: 1 },
    { format: '1', prefix: '', suffix: '  ', displayLevels: 3, start: 1 },
  ];

  const stamp = (n: number) => `2026-08-${String(10 + n).padStart(2, '0')}T14:${String(n).padStart(2, '0')}:00`;
  // The reviewer's marks: only the review variant carries them, the clean one reads on.
  const ins = (text: string, n: number): N => review
    ? T(text, { type: 'insertion', attrs: { id: `ins${n}`, author: REVIEWER, date: stamp(n) } }) : T(text);
  const del = (text: string, n: number): N[] => review
    ? [T(text, { type: 'deletion', attrs: { id: `del${n}`, author: REVIEWER, date: stamp(n) } })] : [];
  const commented = (text: string, n: number, note: string, reply?: string): N => review
    ? T(text, { type: 'comment', attrs: { id: `c${n}`, author: REVIEWER, date: stamp(n), text: note, resolved: false,
      replies: reply ? [{ author: AUTHOR, date: stamp(n + 10), text: reply }] : [] } })
    : T(text);

  const chapter = (title: string, bookmark?: string): N =>
    ({ type: 'heading', attrs: { level: 1, breakBefore: 'page' }, content: [T(title, ...(bookmark ? [BOOKMARK(bookmark)] : []))] });

  const doc: N = { type: 'doc', content: [
    P({ styleName: 'Title', spaceBefore: 150 }, T('Widow and Orphan Control in Browser-Based Word Processing')),
    P({ styleName: 'Subtitle', spaceBefore: 12, spaceAfter: 90 }, T('A Cost Model for Page Breaks in DOM-Rendered Documents')),
    P({ textAlign: 'center', spaceAfter: 30 }, T("Master's Thesis", ITALIC)),
    P({ textAlign: 'center', spaceAfter: 0 }, T('submitted by')),
    P({ textAlign: 'center', spaceAfter: 30 }, T(AUTHOR, BOLD)),
    P({ textAlign: 'center', spaceAfter: 0 }, T('Department of Computer Science')),
    P({ textAlign: 'center', spaceAfter: 0 }, T('Eden Institute of Technology')),
    P({ textAlign: 'center', spaceBefore: 30, spaceAfter: 0 }, T('Supervisor: Prof. Dr. Ingrid Halvorsen')),
    P({ textAlign: 'center', spaceAfter: 0 }, T('Second examiner: Dr. Tomasz Wiśniewski')),
    P({ textAlign: 'center', spaceBefore: 30 }, T('September 2026')),

    FRONT('Abstract'),
    P(null, T('Word processors that run in the browser lay their pages out with the CSS engine of the host, which knows lines and boxes but not pages. Page breaks are therefore computed by the application, and the typographic rules that desktop word processors have applied for decades, keeping the first and last lines of a paragraph together with their neighbours and keeping a heading with the text it introduces, have to be reimplemented on top of measured geometry. This thesis formulates page breaking as a cost minimisation over the measured line boxes of a document and evaluates it against the pagination of a desktop reference implementation. On a corpus of 71 documents the cost model places 96.2 percent of all page breaks on the same line as the reference, against 68.4 percent for the greedy strategy most browser editors use, and removes every widow and orphan the greedy strategy produces. The model runs incrementally, so a document of several hundred pages re-paginates within the frame budget of an interactive editor.')),
    P(null, T('Keywords: ', BOLD), T('pagination, widows and orphans, cost model, dynamic programming, word processing, CSS fragmentation')),

    FRONT('Contents'),
    INDEX('toc', '', { maxLevel: 2 }),

    chapter('Introduction'),
    H(2, T('Motivation')),
    P(null, T('A page break that leaves a single line of a paragraph at the bottom of a page, an '), T('orphan'), IDX('orphan'), T(', or carries a single line over to the top of the next page, a '), T('widow'), IDX('widow'), T(', has been considered a fault of typesetting since the days of hand composition '), BRINGHURST(), T('. Desktop word processors avoid both by default, and their users have come to expect it without knowing the rule. Word processors that run in the browser have mostly not: the layout engine they build on, CSS, has no concept of a page in its continuous-media mode, and the paged mode that does exist is meant for print, not for an editor that re-lays out its text on every keystroke.'), FOOTNOTE('f1', 1)),
    P(null, commented('This thesis asks how the pagination quality of desktop word processors can be reached in the browser, and at what cost in running time.', 1, 'State the two research questions here in one sentence, then expand in 1.2.', 'Done, see the revised sentence below.'), T(' The line-breaking problem was solved by Knuth and Plass with a dynamic programme over the possible break points of a paragraph '), KNUTH(), T(', and Plass extended the same idea to pages '), PLASS(), T('. The pagination of complex documents with floating figures and footnotes has since been studied both as an optimisation problem '), BKW(), T(' and as a general framework for globally optimised pagination '), MITTELBACH(), T('. What none of this work considers is the situation of a browser-based editor: the line boxes are not computed by the application but measured from a layout it does not control, and they change while the user types.')),
    P(null, ...del('This work presents a way to do this. ', 2), ins('This thesis adapts the cost-based formulation to that situation. ', 3), T('The document is measured after every change, and the measured lines are the input to a cost model whose minimum is found incrementally, so that only the pages after the edit are recomputed.')),
    H(2, T('Research Questions')),
    P(null, T('The work is organised around three questions.')),
    OL(
      LI(P(null, T('RQ1 ', BOLD), T('How closely can a cost-based pagination over measured line boxes reproduce the page breaks of a desktop reference implementation?'))),
      LI(P(null, T('RQ2 ', BOLD), T('Which share of widows, orphans and separated headings does each strategy leave in a realistic corpus?'))),
      LI(P(null, T('RQ3 ', BOLD), T('Can the model be evaluated incrementally within the frame budget of an interactive editor, for documents of several hundred pages?'))),
    ),
    H(2, T('Structure of this Thesis')),
    P(null, T('Chapter 2 introduces the typographic rules and the way the two desktop reference implementations and the CSS fragmentation model apply them. Chapter 3 defines the cost model and describes the corpus and the measurement procedure. Chapter 4 reports the results for the three research questions, Chapter 5 discusses them and their threats to validity, and Chapter 6 concludes.')),

    chapter('Background'),
    H(2, T('Widows, Orphans and Keeps')),
    P(null, T('The vocabulary is older than the software. An '), T('orphan', ITALIC), T(' is the first line of a paragraph left alone at the foot of a page; a '), T('widow', ITALIC), T(' is the last line of a paragraph carried alone to the head of the next '), BRINGHURST(), T('. Both are avoided by moving one more line across the break, which shortens the page by a line. Word processors expose this as '), T('widow control', ITALIC), IDX('widow control'), T(' and count a minimum of two lines on either side; the setting can be raised per paragraph or switched off.')),
    P(null, T('Two further rules concern the relation between paragraphs rather than the lines within one. '), T('Keep with next', ITALIC), IDX('keep with next'), T(' binds a paragraph to the one that follows, so that a heading never ends a page; '), T('keep lines together', ITALIC), IDX('keep lines together'), T(' forbids any break inside a paragraph. A caption is kept with its figure the same way. These keeps can conflict with each other and with the page height: a long chain of kept paragraphs cannot be honoured on one page, and every implementation has to decide which keep to give up first.')),
    H(2, T('Pagination in Desktop Word Processors')),
    P(null, T('Both desktop reference implementations paginate greedily in the flow direction, filling a page with lines until the next line does not fit, and then apply the keeps backwards from the break: if the break would separate a heading from its text, or leave an orphan, the break moves up. The rules are applied in a fixed order, and the result is documented well enough that a file format can carry it. The OpenDocument format stores widow and orphan minimums and both keeps as paragraph properties '), ODF(), T(', and a document saved by one implementation is expected to break on the same lines in the other.'), FOOTNOTE('f2', 2)),
    P(null, T('The consequence for this work is that the reference is not a single algorithm but an observed behaviour, and that the observed behaviour can be captured as a set of page break positions per document. This is what the measurement in Section 3.3 compares against.')),
    H(2, T('Layout in the Browser')),
    P(null, T('CSS fragmentation '), CSS(), T(' defines how a box is split across fragmentainers, which include pages in print. The specification carries the same vocabulary as the word processors: '), T('orphans', ITALIC), T(' and '), T('widows', ITALIC), T(' are properties, '), T('break-after: avoid', { type: 'charStyle', attrs: { name: 'Source Text' } }), T(' expresses keep with next, and '), T('break-inside: avoid', { type: 'charStyle', attrs: { name: 'Source Text' } }), T(' keeps lines together. In continuous media, however, none of this applies: a document rendered into a scrolling page is one fragmentainer of unbounded height, and the browser never breaks it.')),
    P(null, T('A browser-based editor that shows pages therefore has two options. It can render every page into its own box and move content between the boxes, which turns every edit into a re-render of the affected pages; or it can render the document as one flow and draw the page boundaries over it, moving blocks down with spacers where a break has to fall. The second option keeps the editing surface intact and is the one this work assumes. Its pagination is then a placement of spacers, and the question is where.')),

    chapter('Method'),
    H(2, T('A Cost Model for Page Breaks', 'cost-model')),
    P(null, T('Let the document be a sequence of line boxes '), FORMULA('l_1, \\ldots, l_n'), T(' with measured heights '), FORMULA('h_i'), T(', grouped into paragraphs, and let '), FORMULA('H'), T(' be the height of the text area of a page. A pagination is a sequence of break positions '), FORMULA('b_1 < b_2 < \\cdots < b_m'), T(', and the '), FORMULA('k'), T('-th page holds the lines from '), FORMULA('b_{k-1}'), T(' up to '), FORMULA('b_k'), T('. Its cost sums the faults it produces and the space it wastes:')),
    P({ textAlign: 'center' }, FORMULA('C(b) = \\sum_{k=1}^{m} \\left( \\alpha\\, w_k + \\beta\\, o_k + \\gamma\\, s_k \\right) + \\lambda \\sum_{k=1}^{m} \\left( 1 - \\frac{f_k}{H} \\right)^{2}', true)),
    P(null, T('where '), FORMULA('w_k, o_k, s_k \\in \\{0, 1\\}'), T(' record whether page '), FORMULA('k'), T(' ends with a widow, an orphan or a separated heading, '), FORMULA('f_k'), T(' is the height of the lines it holds, and '), FORMULA('\\alpha, \\beta, \\gamma, \\lambda'), T(' weight the terms. A keep the user has set explicitly is not weighted but forbidden: a break inside a paragraph marked to keep its lines together, or after one marked to keep with the next, is excluded from the candidate set.')),
    P(null, T('The minimum is found by dynamic programming over the break positions, in the manner of Knuth and Plass '), KNUTH(), T('. With '), FORMULA('c(i, j)'), T(' the cost of a page holding the lines '), FORMULA('i+1'), T(' to '), FORMULA('j'), T(', the optimal cost of paginating the first '), FORMULA('j'), T(' lines is')),
    P({ textAlign: 'center' }, FORMULA('C^{*}(j) = \\min_{i < j} \\left( C^{*}(i) + c(i, j) \\right), \\quad C^{*}(0) = 0', true)),
    P(null, T('and only the '), FORMULA('i'), T(' whose lines fit on one page need to be considered, so each step examines at most a page of lines. An edit invalidates the measured heights of the lines it touches and every '), FORMULA('C^{*}(j)'), T(' after them; the recurrence is re-evaluated from the first invalidated line, and stops as soon as it reproduces a break the previous solution already had, because from there on the two solutions coincide.')),
    H(2, T('The Corpus')),
    P(null, T('The corpus consists of 71 documents in four categories, collected from public archives and from the author’s own institution, and covering the kinds of text a word processor is used for. '), T('Table 1 on page '), REF('tab-corpus', 'page', '7'), T(' lists them. Every document was saved from each reference implementation and its page breaks were recorded, so that each strategy can be compared against both.')),
    styledTable('Academic', [
      ['Category', 'Documents', 'Pages', 'Mean pages'],
      ['Theses and dissertations', '12', '1480', '123.3'],
      ['Reports and papers', '20', '640', '32.0'],
      ['Letters and forms', '35', '52', '1.5'],
      ['Books', '4', '1210', '302.5'],
      ['Total', '71', '3382', '47.6'],
    ], { widths: [260, 120, 120, 120], numeric: [1, 2, 3], cellFormat: 'dec2',
      formulas: { B6: '=SUM(B2:B5)', C6: '=SUM(C2:C5)', D6: '=C6/B6' } }),
    CAP('table', 1, 'The corpus by category. The totals are computed in the table.', 'tab-corpus'),
    H(2, T('Measurement')),
    P(null, T('For every document and every strategy, the set of lines on which a page ends is compared with the set recorded from the reference. A break counts as '), T('on the reference line', ITALIC), T(' if both sets contain it. The share of such breaks is the '), T('agreement', ITALIC), IDX('agreement'), T(' of the strategy; widows, orphans and separated headings are counted from the strategy’s own breaks, independently of the reference. Running time is the wall-clock time of one re-pagination after a single character is inserted on the first page, measured in the browser with a warm cache and reported as the median of 20 runs.')),
    P(null, T('Four strategies are compared: the greedy fill that most browser editors implement, greedy fill with widow and orphan control applied backwards from the break, the cost model of Section 3.1 with the faults weighted but no explicit keeps, and the cost model with the keeps of the document honoured as hard constraints.')),

    chapter('Results'),
    H(2, T('Break Agreement')),
    P(null, T('Figure 1 on page '), REF('fig-agreement', 'page', '8'), T(' shows the agreement of the four strategies with the reference over the whole corpus. The greedy strategy agrees on roughly two breaks in three; the disagreements are almost all one line early or late, caused by a widow or orphan the reference avoided. Adding widow and orphan control closes about a third of the gap. The cost model without keeps reaches 91.6 percent, and honouring the keeps raises it to 96.2 percent. The remaining differences are concentrated in the books, where the reference implementations disagree with each other as often as the model disagrees with either.')),
    P({ textAlign: 'center', spaceAfter: 0 }, IMAGE(CHART, 480, 223, { alt: 'Agreement per strategy' })),
    CAP('figure', 1, 'Agreement of each strategy with the reference pagination, over 3,382 pages.', 'fig-agreement'),
    H(2, T('Widow and Orphan Rates')),
    P(null, T('Table 2 counts the faults each strategy leaves. The greedy strategy produces a widow or orphan on about one page in nine, which matches the rate of paragraphs whose last line happens to fall near a page boundary. Both variants of the cost model remove them entirely; the model with keeps also removes every separated heading, while the model without keeps still leaves 14, all of them headings followed by a figure whose caption did not fit.')),
    styledTable('Academic', [
      ['Strategy', 'Widows', 'Orphans', 'Separated headings', 'Agreement (%)'],
      ['Greedy', '214', '167', '96', '68.4'],
      ['Greedy + widow/orphan', '0', '0', '96', '79.1'],
      ['Cost model', '0', '0', '14', '91.6'],
      ['Cost model + keeps', '0', '0', '0', '96.2'],
    ], { widths: [200, 90, 90, 150, 110], numeric: [1, 2, 3, 4] }),
    CAP('table', 2, 'Faults left by each strategy in the corpus, and its agreement with the reference.'),
    H(2, T('Running Time')),
    P(null, T('The incremental evaluation re-paginates the longest document of the corpus, a book of 412 pages, in a median of 6.8 milliseconds after an edit on its first page, of which 5.1 milliseconds are spent measuring line boxes. A full re-pagination of the same document takes 182 milliseconds. The measured cost grows with the number of pages after the edit until the recurrence reproduces a previous break, which in the corpus happens within three pages in 94 percent of the edits.')),

    chapter('Discussion'),
    P(null, T('The results answer the three questions in the affirmative, with two qualifications. The first is that the reference is itself not unique: the two desktop implementations disagree on 3.1 percent of the breaks in the corpus, mostly in the books, so an agreement above 97 percent with one of them is not attainable without lowering the agreement with the other. The second is that the cost model reproduces the rules of the reference, not its exceptions; a document that relies on a particular implementation giving up a keep in a particular order will paginate differently.')),
    H(2, T('Threats to Validity')),
    P(null, T('The corpus is biased towards academic writing, where headings and captions are frequent and the keeps matter most; a corpus of letters alone would show smaller differences between the strategies. The running times were measured in one browser engine on one machine, and the measurement of line boxes, which dominates them, is the part most dependent on the engine. The reference page breaks were recorded once per implementation and version; a later version may break differently.')),
    H(2, T('Limitations')),
    P(null, T('The model treats footnotes as part of the line that references them and reserves their height on the same page, which is what both references do for short notes but not for notes that themselves span pages. Floating figures are placed before pagination and not moved by it. Neither limitation affected the corpus, which contains no footnote longer than a page and no float that the references moved.')),

    chapter('Conclusion and Future Work'),
    P(null, T('Page breaking in a browser-based editor can be formulated as a cost minimisation over measured line boxes and solved incrementally, and doing so brings its pagination within a few percent of the desktop reference implementations while removing every widow and orphan. The remaining disagreement is largely disagreement between the references themselves. Future work should extend the model to footnotes that span pages and to floats that pagination may move, and should validate the running times across engines. The model as defined in '), REF('cost-model', 'text', 'A Cost Model for Page Breaks'), T(', page '), REF('cost-model', 'page', '6'), T(', is implemented in the editor that produced this document.')),

    INDEX('bibliography', 'Bibliography', { citationStyle: 'apa' }),
    INDEX('alphabetical', 'Index'),

    { type: 'noteSection', content: [
      NOTE('f1', T('CSS paged media exists for printing; the browsers that implement it re-lay out the whole document for every page, which is what an interactive editor cannot afford.')),
      NOTE('f2', T('Both implementations honour widow and orphan minimums of two lines by default; the corpus documents keep that default.')),
    ] },
  ] };

  // Chapter and page number on every page but the title page.
  const header = HF({ tabStops: '16r' },
    { type: 'chapterField', attrs: { level: 1, text: 'Introduction' } },
    T('\t'), PAGE_NUMBER);

  return {
    name: review ? 'thesis-review' : 'thesis', doc, styles,
    margins: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
    hf: { header, footer: null, headerFirst: null, footerFirst: null, differentFirstPage: true,
      pageCount: 12, headerDistanceCm: 1.5, footerDistanceCm: 1.5 },
    language: { language: 'en', country: 'US' },
    hyphenate: true,
    props: { title: 'Widow and Orphan Control in Browser-Based Word Processing', subject: "Master's Thesis",
      author: AUTHOR, keywords: 'pagination, widows, orphans, cost model', description: '' },
    decor: review ? { background: null, border: null,
      watermark: { text: 'DRAFT', font: 'Liberation Sans', color: '#C8C8C8', angle: 45, transparency: 60 } } : undefined,
    shots: review
      ? [{ file: 'thesis-review', at: 'Introduction', markup: true }]
      : [
        { file: 'thesis', at: 'Method' },
        { file: 'thesis-dark', at: 'Method', theme: 'dark' },
        { file: 'thesis-contents', at: 'Contents' },
        { file: 'thesis-overview', page: 1, zoom: 50, columns: 2 },
      ],
  };
}
