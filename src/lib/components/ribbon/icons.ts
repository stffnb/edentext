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

  cut: ['M4 2.5 11 12', 'M12 2.5 5 12', 'M3.6 13.9a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z', 'M12.4 13.9a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z'],
  copy: ['M5.5 5.5h7.25v8.25H5.5z', 'M10.5 5.5V2.25H3.25V10.5H5.5'],
  paste: ['M4.25 3.25H3v10.5h10V3.25h-1.25', 'M6 2h4v2.25H6z', 'M5.5 7.75h5M5.5 10.5h3.5'],

  superscript: ['M2 12.5 7.5 5.5M2 5.5 7.5 12.5', 'M10.5 5.75a1.5 1.5 0 1 1 2.7.9L10.5 9.5h3'],
  subscript: ['M2 10.5 7.5 3.5M2 3.5 7.5 10.5', 'M10.5 9.75a1.5 1.5 0 1 1 2.7.9L10.5 13.5h3'],
  clearFormat: ['M5.5 3h7.5', 'M9.25 3 6.5 13', 'M2 9.5 5 12.5M5 9.5 2 12.5'],
  changeCase: ['M1.5 10.5 4 4l2.5 6.5M2.4 8.6h3.2', 'M9 12.25c1.2 0 2-.7 2-1.7V8.4c0-1-.7-1.6-1.9-1.6-.9 0-1.6.3-2 .8M11 7v5.25'],

  bulletList: ['M6 4h8.5M6 8h8.5M6 12h8.5', 'M2.5 5.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z', 'M2.5 9.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z', 'M2.5 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z'],
  orderedList: ['M6 4h8.5M6 8h8.5M6 12h8.5', 'M1.6 2.6h.9v2.6M1.4 5.2h1.6', 'M1.3 7.1c.2-.4.6-.5 1-.4.5.1.7.6.4 1L1.4 9.4h1.7', 'M1.4 10.9h1.5l-.9 1.1c.6 0 1 .3 1 .8s-.4.8-1 .8c-.4 0-.8-.1-1-.4'],
  indentMore: ['M6.5 4h8M6.5 8h8M6.5 12h8', 'M1.5 5.5 4 8l-2.5 2.5'],
  indentLess: ['M6.5 4h8M6.5 8h8M6.5 12h8', 'M4 5.5 1.5 8 4 10.5'],

  alignLeft: ['M2 3.5h12M2 6.75h7.5M2 10h12M2 13.25h7.5'],
  alignCenter: ['M2 3.5h12M4.25 6.75h7.5M2 10h12M4.25 13.25h7.5'],
  alignRight: ['M2 3.5h12M6.5 6.75h7.5M2 10h12M6.5 13.25h7.5'],
  alignJustify: ['M2 3.5h12M2 6.75h12M2 10h12M2 13.25h12'],
  lineSpacing: ['M6.5 4h8M6.5 8h8M6.5 12h8', 'M3 4.5 3 11.5', 'M1.6 5.9 3 4.5l1.4 1.4', 'M1.6 10.1 3 11.5l1.4-1.4'],
  pilcrow: ['M9 2.5v11', 'M12 2.5v11', 'M9 2.5H6.75a2.75 2.75 0 0 0 0 5.5H9'],
  borders: ['M2.25 2.25h11.5v11.5H2.25z', 'M8 2.25v11.5M2.25 8h11.5'],
  highlighter: ['M5.5 9.5 10 5l3 3-4.5 4.5H5.5z', 'M9.25 3.25 12.75 6.75', 'M2.5 13.5h4'],
  shading: ['M4 8.5 8.5 4l4 4-4.5 4.5a1.4 1.4 0 0 1-2 0L4 10.5a1.4 1.4 0 0 1 0-2z', 'M6.5 2 8.5 4', 'M2.5 13.5h11'],

  find: ['M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z', 'M11.2 11.2 14 14'],
  replace: ['M2 4.5h6.5M2 4.5 4 2.5M2 4.5l2 2', 'M14 11.5H7.5M14 11.5l-2-2M14 11.5l-2 2'],
  pageBreak: ['M2 4.5h12M2 11.5h12', 'M8 6.5v3', 'M6.4 8.2 8 9.8l1.6-1.6'],
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
