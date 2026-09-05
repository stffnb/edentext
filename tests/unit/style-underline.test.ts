// A run underlining differently from the style it sits under: both importers suppress a
// run that only repeats its style, and the shape and colour ride along with it.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';

const sheet = builtinStyleSheet();
sheet.paragraph['Unterstrichen'] = {
  name: 'Unterstrichen', parent: 'Standard', next: 'Standard', para: {}, text: { underline: true },
};

const doc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: { styleName: 'Unterstrichen' },
    content: [
      { type: 'text', text: 'rot', marks: [{ type: 'underline', attrs: { lineColor: '#FF0000' } }] },
      { type: 'text', text: 'wellig', marks: [{ type: 'underline', attrs: { lineStyle: 'wavy' } }] },
      { type: 'text', text: 'wie der Stil', marks: [{ type: 'underline' }] },
    ],
  }],
} as any;

const runs = (n: any) => n.content[0].content.map((c: any) => c.marks?.find((m: any) => m.type === 'underline')?.attrs ?? null);

describe.each([
  ['odt', async () => importOdt(await buildOdt(doc, undefined, undefined, undefined, undefined, undefined, sheet)).content],
  ['docx', async () => importDocx(await buildDocx(doc, undefined, undefined, undefined, undefined, undefined, sheet)).content],
] as const)('a run under an underlining style (%s)', (_fmt, read) => {
  it('keeps its own colour and shape, and drops what the style already draws', async () => {
    expect(runs(await read())).toEqual([{ lineColor: '#FF0000' }, { lineStyle: 'wavy' }, null]);
  });
});
