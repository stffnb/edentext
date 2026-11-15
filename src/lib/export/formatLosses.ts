import type { StyleSheet, TextProps } from '../styles/styleSheet';

// What a save format cannot carry of a document, so the app can say so once. Each
// feature is one rule: the formats that lose it and the run formatting that shows it.
export type FormatLoss = 'textEffects';
type Attrs = Record<string, unknown>;
type Json = { marks?: { type: string; attrs?: Attrs }[]; content?: Json[] };

const RULES: { key: FormatLoss; formats: string[]; text: (a: Attrs | TextProps) => boolean }[] = [
  // ODF has a plain shadow at most (textEffects.ts effectsToOdf).
  { key: 'textEffects', formats: ['odt', 'ott'], text: (a) => !!(a.textOutline || a.textShadow || a.textGlow || a.textFxRaw) },
];

/** The features of `doc` (and its styles) that a file of `format` drops, in rule order. */
export function formatLosses(doc: Json, format: string, sheet?: StyleSheet): FormatLoss[] {
  const rules = RULES.filter((r) => r.formats.includes(format));
  const found = new Set<FormatLoss>();
  const styles = sheet ? [...Object.values(sheet.paragraph), ...Object.values(sheet.character)] : [];
  for (const r of rules) if (styles.some((s) => r.text(s.text))) found.add(r.key);
  const walk = (n: Json) => {
    for (const m of n.marks ?? []) for (const r of rules) if (m.type === 'textStyle' && m.attrs && r.text(m.attrs)) found.add(r.key);
    if (found.size < rules.length) n.content?.forEach(walk);
  };
  walk(doc);
  return rules.map((r) => r.key).filter((k) => found.has(k));
}
