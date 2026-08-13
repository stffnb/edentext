import { describe, it, expect } from 'vitest';
import { noteLabel, noteLabels, type NoteRefInfo } from '../../src/lib/editor/extensions/notes';
import { clampNoteSettings, DEFAULT_NOTE_SETTINGS, type NoteSettings } from '../../src/lib/storage/noteSettings';

const REF = (id: string, kind: 'footnote' | 'endnote'): NoteRefInfo => ({ id, kind, pos: 0 });

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
