// A DrawingML chart part drawn as an SVG picture (import/chart.ts): series values,
// the file's own axis bounds, and the 1..n categories a chart without any gets.
import { describe, it, expect } from 'vitest';
import { chartDataUrl } from '../../src/lib/import/chart';

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

