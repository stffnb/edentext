import { describe, it, expect } from 'vitest';
import { noteLabel, noteLabels, type NoteRefInfo } from '../../src/lib/editor/extensions/notes';
import { clampNoteSettings, DEFAULT_NOTE_SETTINGS, type NoteSettings } from '../../src/lib/storage/noteSettings';

const REF = (id: string, kind: 'footnote' | 'endnote', chapter = 0): NoteRefInfo =>
  ({ id, kind, pos: 0, chapter });

const withFootnote = (over: Partial<NoteSettings['footnote']>): NoteSettings =>
  ({ ...DEFAULT_NOTE_SETTINGS, footnote: { ...DEFAULT_NOTE_SETTINGS.footnote, ...over } });

describe('note numbering', () => {
  it('follows LibreOffice by default: footnotes arabic, endnotes lower roman', () => {
    const s = DEFAULT_NOTE_SETTINGS;
    expect([0, 1, 2].map((i) => noteLabel(i, 'footnote', s))).toEqual(['1', '2', '3']);
    expect([0, 1, 2].map((i) => noteLabel(i, 'endnote', s))).toEqual(['i', 'ii', 'iii']);
  });

  it('renders all five ODF formats', () => {
    const at = (f: NoteSettings['footnote']['numFormat']) =>
      [0, 1, 2].map((i) => noteLabel(i, 'footnote', withFootnote({ numFormat: f })));
    expect(at('1')).toEqual(['1', '2', '3']);
    expect(at('a')).toEqual(['a', 'b', 'c']);
    expect(at('A')).toEqual(['A', 'B', 'C']);
    expect(at('i')).toEqual(['i', 'ii', 'iii']);
    expect(at('I')).toEqual(['I', 'II', 'III']);
  });

  it('counts from the start value and wraps the number in prefix/suffix', () => {
    const s = withFootnote({ startAt: 4, prefix: '[', suffix: ']' });
    expect([0, 1].map((i) => noteLabel(i, 'footnote', s))).toEqual(['[4]', '[5]']);
  });

  it('keeps a note the file numbered by hand', () => {
    expect(noteLabel(0, 'footnote', DEFAULT_NOTE_SETTINGS, '*')).toBe('*');
  });

  it('counts the two classes separately, in anchor order', () => {
    const refs = [REF('a', 'footnote'), REF('b', 'endnote'), REF('c', 'footnote'), REF('d', 'endnote')];
    const labels = noteLabels(refs, DEFAULT_NOTE_SETTINGS);
    expect([...labels.values()]).toEqual(['1', 'i', '2', 'ii']);
  });

  // LibreOffice, probed: the count starts over on each page / at each chapter.
  it('restarts per page, from the page each anchor landed on', () => {
    const refs = [REF('a', 'footnote'), REF('b', 'footnote'), REF('c', 'footnote')];
    const pages = new Map([['a', 1], ['b', 2], ['c', 2]]);
    const labels = noteLabels(refs, withFootnote({ restart: 'page' }), pages);
    expect([...labels.values()]).toEqual(['1', '1', '2']);
  });

  it('leaves an endnote document-wide: LibreOffice offers no per-page count for one', () => {
    const refs = [REF('a', 'endnote'), REF('b', 'endnote')];
    const s: NoteSettings = { ...DEFAULT_NOTE_SETTINGS, endnote: { ...DEFAULT_NOTE_SETTINGS.endnote, restart: 'page' } };
    expect([...noteLabels(refs, s, new Map()).values()]).toEqual(['i', 'ii']);
  });

  it('restarts per chapter, off the anchor’s own chapter', () => {
    const refs = [REF('a', 'footnote', 1), REF('b', 'footnote', 1), REF('c', 'footnote', 2)];
    expect([...noteLabels(refs, withFootnote({ restart: 'chapter' })).values()]).toEqual(['1', '2', '1']);
  });
});

describe('note settings', () => {
  it('falls back to the defaults for anything a stored value gets wrong', () => {
    const s = clampNoteSettings({ footnote: { numFormat: 'z', startAt: -3, restart: 'nonsense' }, separator: { relWidthPercent: 500 } });
    expect(s.footnote.numFormat).toBe('1');
    expect(s.footnote.startAt).toBe(1);
    expect(s.footnote.restart).toBe('document');
    expect(s.separator.relWidthPercent).toBe(100);
  });

  it('keeps values that are in range', () => {
    const s = clampNoteSettings({ ...DEFAULT_NOTE_SETTINGS, footnote: { ...DEFAULT_NOTE_SETTINGS.footnote, numFormat: 'I', startAt: 7, restart: 'page' } });
    expect(s.footnote).toMatchObject({ numFormat: 'I', startAt: 7, restart: 'page' });
  });

  it('survives a garbage payload whole', () => {
    expect(clampNoteSettings(null)).toEqual(DEFAULT_NOTE_SETTINGS);
    expect(clampNoteSettings('nope')).toEqual(DEFAULT_NOTE_SETTINGS);
  });
});
