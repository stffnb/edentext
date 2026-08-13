import type { OrderedTypeDef } from '../utils/orderedListTypes';

const KEY = 'odf-editor-notes';

// How footnotes and endnotes are numbered and where they sit. Every default here was
// read out of a document LibreOffice saved (docs/architecture/notes.md) — an
// editor-only default would land in every imported file as direct formatting.

export type NoteKind = 'footnote' | 'endnote';
export type NoteNumFormat = OrderedTypeDef['numFormat'];
// Where the count starts over. 'chapter' is ODF's own third value; nothing restarts
// it yet, so it round-trips without changing the numbering.
export type NoteRestart = 'document' | 'page' | 'chapter';
// A footnote sits at the foot of its page or is collected with the endnotes at the
// end of the document (LibreOffice's "Collect at end of document").
export type NotePosition = 'page' | 'document';

export type NoteClassSettings = {
  numFormat: NoteNumFormat;
  // The number of the *first* note. ODF stores it 0-based (text:start-value).
  startAt: number;
  restart: NoteRestart;
  position: NotePosition;
  prefix: string;
  suffix: string;
  citationStyle: string;
  bodyStyle: string;
};

export type NoteSeparator = {
  relWidthPercent: number;
  weightPt: number;
  spaceAboveCm: number;
  spaceBelowCm: number;
  align: 'left' | 'center' | 'right';
  color: string;
};

export type NoteSettings = {
  footnote: NoteClassSettings;
  endnote: NoteClassSettings;
  separator: NoteSeparator;
};

// LibreOffice numbers footnotes arabic and document-wide, endnotes lower roman.
export const DEFAULT_NOTE_SETTINGS: NoteSettings = {
  footnote: {
    numFormat: '1',
    startAt: 1,
    restart: 'document',
    position: 'page',
    prefix: '',
    suffix: '',
    citationStyle: 'Footnote Symbol',
    bodyStyle: 'Footnote',
  },
  endnote: {
    numFormat: 'i',
    startAt: 1,
    restart: 'document',
    position: 'document',
    prefix: '',
    suffix: '',
    citationStyle: 'Endnote Symbol',
    bodyStyle: 'Endnote',
  },
  // style:footnote-sep as LibreOffice writes it: 0.0071in / 0.0398in.
  separator: {
    relWidthPercent: 25,
    weightPt: 0.5,
    spaceAboveCm: 0.1,
    spaceBelowCm: 0.1,
    align: 'left',
    color: '#000000',
  },
};

// The note text's own size and hanging indent — LibreOffice's Footnote/Endnote
// paragraph styles, which both exports write out and both imports suppress against.
export const NOTE_FONT_SIZE_PT = 10;
export const NOTE_INDENT_CM = 0.6;

const NUM_FORMATS: NoteNumFormat[] = ['1', 'a', 'A', 'i', 'I'];

function clampClass(raw: unknown, fallback: NoteClassSettings): NoteClassSettings {
  const o = (raw ?? {}) as Partial<NoteClassSettings>;
  const start = Number(o.startAt);
  return {
    numFormat: NUM_FORMATS.includes(o.numFormat as NoteNumFormat) ? o.numFormat as NoteNumFormat : fallback.numFormat,
    startAt: Number.isFinite(start) ? Math.min(9999, Math.max(1, Math.round(start))) : fallback.startAt,
    restart: o.restart === 'page' || o.restart === 'chapter' ? o.restart : 'document',
    position: o.position === 'document' ? 'document' : fallback.position,
    prefix: typeof o.prefix === 'string' ? o.prefix.slice(0, 8) : fallback.prefix,
    suffix: typeof o.suffix === 'string' ? o.suffix.slice(0, 8) : fallback.suffix,
    citationStyle: typeof o.citationStyle === 'string' && o.citationStyle ? o.citationStyle : fallback.citationStyle,
    bodyStyle: typeof o.bodyStyle === 'string' && o.bodyStyle ? o.bodyStyle : fallback.bodyStyle,
  };
}

function clampSeparator(raw: unknown): NoteSeparator {
  const o = (raw ?? {}) as Partial<NoteSeparator>;
  const d = DEFAULT_NOTE_SETTINGS.separator;
  const num = (v: unknown, min: number, max: number, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
  return {
    relWidthPercent: num(o.relWidthPercent, 0, 100, d.relWidthPercent),
    weightPt: num(o.weightPt, 0, 20, d.weightPt),
    spaceAboveCm: num(o.spaceAboveCm, 0, 5, d.spaceAboveCm),
    spaceBelowCm: num(o.spaceBelowCm, 0, 5, d.spaceBelowCm),
    align: o.align === 'center' || o.align === 'right' ? o.align : d.align,
    color: /^#[0-9a-fA-F]{6}$/.test(String(o.color)) ? String(o.color) : d.color,
  };
}

export function clampNoteSettings(raw: unknown): NoteSettings {
  const o = (raw ?? {}) as Partial<NoteSettings>;
  return {
    footnote: clampClass(o.footnote, DEFAULT_NOTE_SETTINGS.footnote),
    endnote: clampClass(o.endnote, DEFAULT_NOTE_SETTINGS.endnote),
    separator: clampSeparator(o.separator),
  };
}

export function loadNoteSettings(): NoteSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clampNoteSettings(JSON.parse(raw)) : DEFAULT_NOTE_SETTINGS;
  } catch {
    return DEFAULT_NOTE_SETTINGS;
  }
}

export function saveNoteSettings(s: NoteSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
