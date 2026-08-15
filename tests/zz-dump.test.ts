import { it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
type N = any;
const cell = (t: string, formula?: string): N => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, ...(formula ? { formula } : {}) }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const doc: N = { type: 'doc', content: [
  { type: 'table', content: [
    { type: 'tableRow', content: [cell('2'), cell('3')] },
    { type: 'tableRow', content: [cell('5', 'SUM(ABOVE)'), cell('x')] },
  ] },
] };
it('dumps', async () => {
  const bytes = await buildOdt(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait');
  const xml = strFromU8(unzipSync(bytes)['content.xml']);
  console.log(xml.match(/<style:style[^>]*family="table-cell"[\s\S]*?<\/style:style>/g)?.join('\n'));
  console.log(xml.slice(xml.indexOf('<table:table '), xml.indexOf('</table:table>') + 14));
});
