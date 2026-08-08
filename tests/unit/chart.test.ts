// A DrawingML chart part drawn as an SVG picture (import/chart.ts): series values,
// the file's own axis bounds, and the 1..n categories a chart without any gets.
import { describe, it, expect } from 'vitest';
import { chartDataUrl, odfChartDataUrl } from '../../src/lib/import/chart';

const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

const points = (vals: number[]) =>
  `<c:numCache><c:ptCount val="${vals.length}"/>` +
  vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('') + '</c:numCache>';

const chartXml = (plot: string, opts: { max?: string; cats?: string[] } = {}) =>
  `<c:chartSpace ${C} ${A}><c:chart>` +
  `<c:title><c:tx><c:rich><a:p><a:r><a:t>Phase Std</a:t></a:r></a:p></c:rich></c:tx></c:title>` +
  `<c:plotArea><${plot}><c:ser><c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr>` +
  (opts.cats ? `<c:cat><c:strCache><c:ptCount val="${opts.cats.length}"/>` +
    opts.cats.map((t, i) => `<c:pt idx="${i}"><c:v>${t}</c:v></c:pt>`).join('') + '</c:strCache></c:cat>' : '') +
  `<c:val><c:numRef>${points([1, 2, 3])}</c:numRef></c:val></c:ser></${plot}>` +
  `<c:catAx><c:title><c:tx><c:rich><a:p><a:r><a:t>interferogram</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx>` +
  `<c:valAx><c:scaling><c:orientation val="minMax"/>${opts.max ? `<c:max val="${opts.max}"/>` : ''}</c:scaling>` +
  `<c:majorGridlines/></c:valAx>` +
  `</c:plotArea></c:chart></c:chartSpace>`;

const svgOf = (xml: string, accents: string[] = []) => {
  const url = chartDataUrl(xml, 400, 300, accents);
  expect(url?.startsWith('data:image/svg+xml')).toBe(true);
  return decodeURIComponent(url!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
};

describe('a chart part', () => {
  it('draws its bars, title, axis title and the theme accent it names', () => {
    const svg = svgOf(chartXml('c:barChart'), ['#111111', '#22AA33']);
    expect(svg).toContain('Phase Std');
    expect(svg).toContain('interferogram');
    expect(svg).toContain('#22AA33');
    expect((svg.match(/<rect /g) ?? []).length).toBe(4); // one background + three bars
  });

  it('takes the value axis bound from the file, not from the data', () => {
    expect(svgOf(chartXml('c:barChart', { max: '10' }))).toContain('>10<');
    expect(svgOf(chartXml('c:barChart'))).not.toContain('>10<');
  });

  it('numbers the categories 1..n when the file names none, and keeps the ones it does', () => {
    const plain = svgOf(chartXml('c:barChart'));
    expect(plain).toContain('>1<');
    expect(plain).toContain('>3<');
    expect(svgOf(chartXml('c:barChart', { cats: ['Mo', 'Di', 'Mi'] }))).toContain('>Di<');
  });

  it('draws a line and a pie chart, and declines a plot it cannot draw', () => {
    expect(svgOf(chartXml('c:lineChart'))).toContain('<polyline');
    expect(svgOf(chartXml('c:pieChart'))).toContain('<path');
    expect(chartDataUrl(chartXml('c:surfaceChart'), 400, 300, [])).toBeNull();
    expect(chartDataUrl('not xml at all', 400, 300, [])).toBeNull();
  });
});


// ---- ODF charts: <chart:chart> plus the local table that holds its numbers ----

const NSDECL = 'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"'
  + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
  + ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
  + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
  + ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"'
  + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const row = (cells: string[]) => `<table:table-row>${cells.map((c) => c).join('')}</table:table-row>`;
const strCell = (s: string) => `<table:table-cell office:value-type="string"><text:p>${s}</text:p></table:table-cell>`;
const numCell = (v: number) => `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`;

const odfChart = (cls: string) =>
  `<office:document-content ${NSDECL}><office:automatic-styles>` +
  `<style:style style:name="ch6" style:family="chart"><style:chart-properties chart:maximum="4"/></style:style>` +
  `<style:style style:name="ch9" style:family="chart"><style:graphic-properties draw:fill-color="#22AA33"/></style:style>` +
  `</office:automatic-styles><office:body><office:chart>` +
  `<chart:chart chart:class="${cls}"><chart:title><text:p>Phase Std</text:p></chart:title>` +
  `<chart:plot-area>` +
  `<chart:axis chart:dimension="x"><chart:title><text:p>interferogram</text:p></chart:title>` +
  `<chart:categories table:cell-range-address="local-table.$A$2:.$A$4"/></chart:axis>` +
  `<chart:axis chart:dimension="y" chart:style-name="ch6"><chart:grid chart:class="major"/></chart:axis>` +
  `<chart:series chart:style-name="ch9" chart:values-cell-range-address="local-table.$B$2:.$B$4"` +
  ` chart:label-cell-address="local-table.$B$1"/>` +
  `</chart:plot-area>` +
  `<table:table table:name="local-table">` +
  row([strCell(''), strCell('Series1')]) +
  row([strCell('Mo'), numCell(1)]) + row([strCell('Di'), numCell(2)]) + row([strCell('Mi'), numCell(3)]) +
  `</table:table></chart:chart></office:chart></office:body></office:document-content>`;

const odfSvg = (cls: string) => {
  const doc = new DOMParser().parseFromString(odfChart(cls), 'application/xml');
  const url = odfChartDataUrl(doc, 400, 300);
  expect(url?.startsWith('data:image/svg+xml')).toBe(true);
  return decodeURIComponent(url!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
};

describe('an ODF chart object', () => {
  it('draws its series from the local table, in the file’s own colour', () => {
    const svg = odfSvg('chart:bar');
    expect(svg).toContain('Phase Std');
    expect(svg).toContain('interferogram');
    expect(svg).toContain('#22AA33');
    expect(svg).toContain('>Di<');
    expect((svg.match(/<rect /g) ?? []).length).toBe(4); // one background + three bars
  });

  it('takes the value axis bound from the axis style, and declines an unknown class', () => {
    expect(odfSvg('chart:bar')).toContain('>4<');
    const doc = new DOMParser().parseFromString(odfChart('chart:surface'), 'application/xml');
    expect(odfChartDataUrl(doc, 400, 300)).toBeNull();
  });
});
