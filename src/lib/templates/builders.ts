import { toDateValue, DEFAULT_DATE_FORMAT } from '../utils/dateTime';
import { headingStyleName } from '../styles/styleSheet';

// Loose editor-JSON node builders shared by the template modules.
export type N = Record<string, unknown>;

export const T = (text: string, ...marks: N[]): N =>
  ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
export const PLH = (text: string, ...marks: N[]): N =>
  ({ type: 'placeholderField', attrs: { text }, ...(marks.length ? { marks } : {}) });
export const P = (attrs: N | null, ...content: N[]): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
export const H = (level: number, ...content: N[]): N =>
  ({ type: 'heading', attrs: { level, styleName: headingStyleName(level) }, content });

// Table cells carry proportional column weights (percent × 100, see tableColumnResize).
export const TBL = (attrs: N | null, ...rows: N[]): N =>
  ({ type: 'table', ...(attrs ? { attrs } : {}), content: rows });
export const ROW = (...cells: N[]): N => ({ type: 'tableRow', content: cells });
export const TC = (attrs: N | null, ...content: N[]): N =>
  ({ type: 'tableCell', ...(attrs ? { attrs } : {}), content });
export const THC = (attrs: N | null, ...content: N[]): N =>
  ({ type: 'tableHeader', ...(attrs ? { attrs } : {}), content });

export const SMALL = { type: 'textStyle', attrs: { fontSize: '8pt' } };
export const BOLD = { type: 'bold' };

// 12pt body at Liberation Serif's natural ~1.15em line height.
export const LINE_PT = 12 * 1.15;
export const MM_TO_PT = 72 / 25.4;
// The return-address zone is 5mm tall; its 8pt line fills ~3.25mm of it.
export const RETURN_SPACE_AFTER_PT = Math.round((5 * MM_TO_PT - 8 * 1.15) * 10) / 10;

export const dateField = (): N =>
  ({ type: 'dateTimeField', attrs: { kind: 'date', format: DEFAULT_DATE_FORMAT, fixed: true, value: toDateValue(new Date()) } });
