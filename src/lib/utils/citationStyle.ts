// How a bibliography prints its sources and how a citation names one. Both word
// processors offer a list of styles; these are the four common shapes plus LibreOffice's
// own default, which cites by the source's short name.
//
// A row is a token list — a field, or the literal between two of them — because that is
// exactly what ODF's entry template is (<text:index-entry-bibliography> next to
// <text:index-entry-span>), so LibreOffice regenerates the same rows we print.

export type CitationStyle = 'key' | 'numbered' | 'apa' | 'mla' | 'chicago';

export const CITATION_STYLES: CitationStyle[] = ['key', 'numbered', 'apa', 'mla', 'chicago'];

export type BibToken = { field: string } | { text: string };

const F = (field: string): BibToken => ({ field });
const T = (text: string): BibToken => ({ text });

// Word's own names for the styles it ships, so a .docx says which one it is.
export const DOCX_STYLE_NAME: Record<CitationStyle, string> = {
  key: 'APA', numbered: 'ISO690Numerical', apa: 'APA', mla: 'MLA', chicago: 'Chicago',
};

const FROM_DOCX_STYLE: Record<string, CitationStyle> = {
  APA: 'apa', MLA: 'mla', Chicago: 'chicago', ChicagoAuthorDate: 'chicago',
  ISO690Numerical: 'numbered', IEEE2006: 'numbered',
};

export function citationStyleFromDocx(name: string): CitationStyle | null {
  return FROM_DOCX_STYLE[name.replace(/^\\|\.XSL$/gi, '')] ?? null;
}

export function isCitationStyle(v: unknown): v is CitationStyle {
  return typeof v === 'string' && (CITATION_STYLES as string[]).includes(v);
}

/** The row template: what a bibliography entry of this style reads, field by field. */
export function rowTemplate(style: CitationStyle): BibToken[] {
  switch (style) {
    case 'apa':
      return [F('author'), T(' ('), F('year'), T('). '), F('title'), T('. '), F('publisher'), T('.')];
    case 'mla':
      return [F('author'), T('. '), F('title'), T('. '), F('publisher'), T(', '), F('year'), T('.')];
    case 'chicago':
      return [F('author'), T('. '), F('title'), T('. '), F('address'), T(': '), F('publisher'), T(', '), F('year'), T('.')];
    case 'numbered':
      return [F('author'), T(', '), F('title'), T(', '), F('year')];
    default:
      return [F('identifier'), T(': '), F('author'), T(', '), F('title'), T(', '), F('year')];
  }
}

type Source = { identifier: string; fields: Record<string, string> };

const valueOf = (source: Source, field: string): string =>
  (field === 'identifier' ? source.identifier : source.fields[field] ?? '').trim();

/**
 * One bibliography row. A field the source leaves empty takes its neighbouring literal
 * with it, so a missing publisher never leaves a stray ", " behind.
 */
export function formatBibRow(source: Source, style: CitationStyle, number = 0): string {
  let out = '';
  let pending = '';
  let skipNext = false;
  for (const token of rowTemplate(style)) {
    if ('text' in token) {
      if (skipNext) skipNext = false;
      else pending += token.text;
      continue;
    }
    const value = valueOf(source, token.field);
    if (!value) {
      // The empty field takes the literal after it, keeping the one before as the
      // separator — unless that one opens a bracket the closing half just went with.
      skipNext = !!out;
      if (!out) pending = '';
      else if (pending.trimEnd().endsWith('(')) pending = '. ';
      continue;
    }
    out += (out ? pending : '') + value;
    pending = '';
  }
  // A trailing literal is the style's own full stop; it belongs to what was written.
  if (out && pending.trim() === '.') out += '.';
  if (!out) out = source.identifier;
  return style === 'numbered' && number > 0 ? `[${number}] ${out}` : out;
}

// The surname a citation names: "Knuth, Donald" → Knuth, "Donald Knuth" → Knuth. More
// than one author is cited by the first plus et al., as all three styles do.
function surname(author: string): string {
  const first = author.split(/;| and /i)[0].trim();
  const name = first.includes(',') ? first.slice(0, first.indexOf(',')) : first.split(/\s+/).pop() ?? '';
  return /;| and /i.test(author) ? `${name} et al.` : name;
}

/** What the citation itself shows in the text. */
export function citationLabel(source: Source, style: CitationStyle, number = 0): string {
  const author = surname(valueOf(source, 'author'));
  const year = valueOf(source, 'year');
  if (style === 'numbered') return `[${number > 0 ? number : 1}]`;
  if (style === 'key' || !author) return `[${source.identifier}]`;
  if (style === 'apa') return year ? `(${author}, ${year})` : `(${author})`;
  if (style === 'chicago') return year ? `(${author} ${year})` : `(${author})`;
  return `(${author})`;
}

/** Which style a file's entry template is, matching field order — null if none does. */
export function citationStyleFromTemplate(fields: string[]): CitationStyle | null {
  const key = fields.join('|');
  for (const style of CITATION_STYLES) {
    const own = rowTemplate(style).filter((t): t is { field: string } => 'field' in t).map((t) => t.field);
    if (own.join('|') === key) return style;
  }
  return null;
}
