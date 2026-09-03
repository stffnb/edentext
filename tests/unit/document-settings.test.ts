// Everything a save carries besides the document tree: the app hands the exporters
// nineteen arguments, and the corpus legs pass seven. This is the other twelve — set to
// non-default values and read back out of both formats.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { DEFAULT_NOTE_SETTINGS } from '../../src/lib/storage/noteSettings';

type N = any;

const zone = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const doc: N = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'body' }, { type: 'noteRef', attrs: { id: 'n1', kind: 'footnote', text: '1' } }] },
  { type: 'noteSection', content: [{ type: 'note', attrs: { id: 'n1', kind: 'footnote', label: null, text: '1' }, content: [{ type: 'text', text: 'the note' }] }] },
] };

const hf: N = {
  header: zone('HEAD'), footer: zone('FOOT'), pageCount: 1,
  headerFirst: zone('FIRSTHEAD'), footerFirst: zone('FIRSTFOOT'), differentFirstPage: true,
  headerEven: zone('EVENHEAD'), footerEven: zone('EVENFOOT'), differentOddEven: true,
  headerDistanceCm: 1.4, footerDistanceCm: 1.6,
  sections: [{
    header: zone('HEAD'), footer: zone('FOOT'), differentFirstPage: true,
    headerFirst: zone('FIRSTHEAD'), footerFirst: zone('FIRSTFOOT'), differentOddEven: true,
    headerEven: zone('EVENHEAD'), footerEven: zone('EVENFOOT'),
  }],
};
const margins = { top: 3, bottom: 3.5, left: 2.5, right: 1.5 };
const notes = { ...DEFAULT_NOTE_SETTINGS, footnote: { ...DEFAULT_NOTE_SETTINGS.footnote, numFormat: 'a' as const, startAt: 3, restart: 'page' as const } };
const props = { title: 'T', subject: 'S', author: 'A', keywords: 'K', description: 'D' };
const decor = { background: '#eeddcc', border: { widthPt: 1.5, color: '#123456', paddingCm: 0.3 },
  watermark: { text: 'DRAFT', font: 'Liberation Sans', color: '#c0c0c0', angle: 30, transparency: 40 } };
const lineNumbering = { on: true, interval: 3, distanceCm: 0.8, restart: 'page' as const, countEmpty: true };

const args = [margins, 'landscape', hf, { language: 'de', country: 'DE' }, 'letter', builtinStyleSheet(),
  1.11, 'max', true, notes, props, true, { format: 'i' as const, start: 7 }, decor, lineNumbering,
  true, true, false] as const;

// A zone's text alone: the upper-case letters of its serialized tree.
const zoneText = (z: N) => (z ? JSON.stringify(z).replace(/[^A-Z]/g, '') : null);

describe.each([['ODT', buildOdt, importOdt], ['DOCX', buildDocx, importDocx]] as const)(
  'a %s save carries the whole document, not only its tree', (name, build, read) => {
    const roundTrip = async () => read(await (build as N)(doc, ...args)) as N;

    it('keeps the page geometry', async () => {
      const r = await roundTrip();
      expect(r.margins).toEqual(margins);
      expect([r.orientation, r.format, r.rtl]).toEqual(['landscape', 'letter', true]);
    });

    it('keeps every header and footer zone', async () => {
      const r = await roundTrip();
      expect([zoneText(r.header), zoneText(r.footer)]).toEqual(['HEAD', 'FOOT']);
      expect([zoneText(r.headerFirst), zoneText(r.footerFirst)]).toEqual(['FIRSTHEAD', 'FIRSTFOOT']);
      expect([zoneText(r.headerEven), zoneText(r.footerEven)]).toEqual(['EVENHEAD', 'EVENFOOT']);
      expect([r.differentFirstPage, r.differentOddEven]).toEqual([true, true]);
      expect([r.headerDistanceCm, r.footerDistanceCm]).toEqual([1.4, 1.6]);
    });

    it('keeps the flow settings', async () => {
      const r = await roundTrip();
      expect(r.tabIntervalCm).toBe(1.11);
      expect([r.spacingModel, r.spacingAtPageStart]).toEqual(['max', false]);
      expect([r.hyphenate, r.recordChanges, r.foldMarks]).toEqual([true, true, true]);
      expect(r.pageNumbering).toEqual({ format: 'i', start: 7 });
      expect(r.lineNumbering).toEqual(lineNumbering);
    });

    it('keeps the page decoration', async () => {
      const r = await roundTrip();
      expect(r.decor.background).toBe('#eeddcc');
      expect(r.decor.watermark).toEqual(decor.watermark);
      expect(r.decor.border).toMatchObject({ widthPt: 1.5, color: '#123456' });
      // Word's w:pgBorders/@w:space counts whole points, so the padding lands nearby.
      expect(r.decor.border.paddingCm).toBeCloseTo(0.3, 1);
    });

    it('keeps the note configuration and the document properties', async () => {
      const r = await roundTrip();
      expect(r.notes.footnote).toMatchObject({ numFormat: 'a', startAt: 3, restart: 'page' });
      expect(r.props).toEqual(props);
    });

    // The configuration is the document's, not the notes' — set before the first note
    // exists, it still has to survive the save.
    it('keeps the note configuration of a document holding no note', async () => {
      const empty: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
      const r = read(await (build as N)(empty, ...args)) as N;
      expect(r.notes.footnote).toMatchObject({ numFormat: 'a', startAt: 3, restart: 'page' });
    });
  },
);
