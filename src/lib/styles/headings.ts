// LibreOffice's heading defaults, shown in the editor (editor.css) and written over
// odf-kit's Heading_20_N styles on export. The importers use them as the fallback
// yardstick when a file declares no style. Levels 4 and 6 are italic, as in LibreOffice.
export const HEADING_STYLE_OVERRIDES: { name: string; fontSize: string; marginTop: string; marginBottom: string; italic?: true }[] = [
  { name: 'Heading_20_1', fontSize: '18pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_2', fontSize: '16pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_3', fontSize: '14pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_4', fontSize: '13pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
  { name: 'Heading_20_5', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_6', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
  // 7–10 continue level 6 rather than adding a step of our own: probed, LibreOffice
  // writes these styles with no properties at all and resolves them from its own pool.
  { name: 'Heading_20_7', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_8', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
  { name: 'Heading_20_9', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_10', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
];

// Headings are sans (LibreOffice's Heading style). On screen the bundled 'Arial'
// @font-face maps to Liberation Sans, so the declared name is metric-identical —
// the same trick as EXPORT_FONT for the serif body font.
export const HEADING_FONT = 'Arial';

// Highest heading level the editor offers (extensions.ts, both importers, TOC).
export const MAX_HEADING_LEVEL = HEADING_STYLE_OVERRIDES.length;
export const HEADING_LEVELS = HEADING_STYLE_OVERRIDES.map((_, i) => i + 1);
