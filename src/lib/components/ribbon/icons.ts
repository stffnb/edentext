// Ribbon glyphs on a 16-unit canvas, as bare path data so one <svg> wrapper can
// own stroke, colour and size. STROKED paints outlines, FILLED solid shapes.

export type IconName = keyof typeof STROKED | keyof typeof FILLED;

const DOC_OUTLINE = [
  'M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z',
  'M9 1.75V5.5h3.75',
];

export const STROKED = {
  chevronDown: ['M3.5 6 8 10.5 12.5 6'],
  chevronRight: ['M6 3.5 10.5 8 6 12.5'],
  check: ['M3.5 8.5 6.5 11.5 12.5 5'],
  doc: DOC_OUTLINE,
  newDoc: [...DOC_OUTLINE, 'M8 8v3.5M6.25 9.75h3.5'],
  folder: ['M1.75 12.5V4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 .8.4l.7.95a1 1 0 0 0 .8.4h4.2a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z'],
  save: [
    'M2.75 2.5h7.65L13.5 5.6V12.75a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V3.25a.75.75 0 0 1 .25-.75z',
    'M5 2.5v3h4.5v-3',
    'M4.75 8.75h6.5v4.75h-6.5z',
  ],
  print: [
    'M4.5 6V2.25h7V6',
    'M4.5 12H3.25A1.25 1.25 0 0 1 2 10.75V7.25A1.25 1.25 0 0 1 3.25 6h9.5A1.25 1.25 0 0 1 14 7.25v3.5A1.25 1.25 0 0 1 12.75 12H11.5',
    'M4.5 10h7v4h-7z',
  ],
  export: ['M8 2v7', 'M5 6.25 8 9.25l3-3', 'M2.75 11.5v1.75h10.5V11.5'],
  undo: ['M2.5 6.5h6.75a3.75 3.75 0 0 1 0 7.5H5.5', 'M5.25 3.5 2.5 6.5l2.75 3'],
  redo: ['M13.5 6.5H6.75a3.75 3.75 0 0 0 0 7.5H10.5', 'M10.75 3.5 13.5 6.5l-2.75 3'],
  info: ['M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13z', 'M8 7.25v4'],
  ribbon: ['M2 3.25h12v3.5H2z', 'M2 9.5h4v3.25H2z', 'M7.5 9.5h2.5v3.25H7.5z', 'M11.5 9.5H14v3.25h-2.5z'],
} as const;

export const FILLED = {
  infoDot: ['M8 4.4a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z'],
} as const;

// Constant painted stroke rather than proportional scaling: a 1-unit stroke would
// paint 1.75px at 28px and a hairline at 14px. Units = painted px × 16 / rendered px.
export function pinnedStroke(size: number): number {
  const painted = size >= 20 ? 1.5 : size >= 13 ? 1.25 : 1.1;
  return (painted * 16) / size;
}
