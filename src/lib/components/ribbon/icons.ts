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

  clearFormat: ['M6 4.15h7.5', 'M9.75 4.15v7.35', 'M2 8.5 5 11.5M5 8.5 2 11.5'],
  changeCase: ['M2.1 11.5 4.8 4.5l2.7 7M3.05 9.4h3.5', 'M11.8 11.5a2.15 2.15 0 1 0 0-4.3 2.15 2.15 0 0 0 0 4.3z', 'M13.95 7.2v4.3'],

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
  highlighter: ['M6.5 12.5 3.5 9.5 9.5 3.5 12.5 6.5z', 'M8 5 11 8'],
  shading: ['M4 8.5 8.5 4l4 4-4.5 4.5a1.4 1.4 0 0 1-2 0L4 10.5a1.4 1.4 0 0 1 0-2z', 'M6.5 2 8.5 4', 'M2.5 13.5h11'],

  rowAbove: ['M1.5 9h13v5.5h-13z', 'M1.5 11.75h13', 'M8 1.5v5M5.5 4h5'],
  rowBelow: ['M1.5 1.5h13V7h-13z', 'M1.5 4.25h13', 'M8 9.5v5M5.5 12h5'],
  colLeft: ['M9 1.5h5.5v13H9z', 'M11.75 1.5v13', 'M1.5 8h5M4 5.5v5'],
  colRight: ['M1.5 1.5H7v13H1.5z', 'M4.25 1.5v13', 'M9.5 8h5M12 5.5v5'],
  deleteRow: ['M1.5 5.5h13v5h-13z', 'M4 3 12 13M12 3 4 13'],
  deleteCol: ['M5.5 1.5h5v13h-5z', 'M3 4 13 12M13 4 3 12'],
  deleteTable: ['M2 2.5h12v11H2z', 'M2 6h12M2 10h12M6 2.5v11M10 2.5v11', 'M3 3 13 13'],
  merge: ['M2 3h12v10H2z', 'M2 8h4M10 8h4', 'M6.5 6 8.5 8l-2 2M9.5 6 7.5 8l2 2'],
  split: ['M2 3h12v10H2z', 'M8 3v10', 'M5 6.5 3 8l2 1.5M11 6.5 13 8l-2 1.5'],
  headerRow: ['M2 3h12v10H2z', 'M2 6.25h12', 'M3.4 4.6h9.2'],
  firstColumn: ['M2 3h12v10H2z', 'M5.5 3v10', 'M3.75 5v6'],
  alignTop: ['M2 3h12', 'M8 5.5v7M5.5 8 8 5.5 10.5 8'],
  alignMiddle: ['M2 8h12', 'M8 2.5v3M8 10.5v3'],
  alignBottom: ['M2 13h12', 'M8 3.5v7M5.5 8 8 10.5 10.5 8'],
  cellMargins: ['M2 2.5h12v11H2z', 'M4.5 5h7v6h-7z'],
  wrapInline: ['M2 4h12M2 8h12M2 12h12'],
  wrapLeft: ['M2 3.5h6v9H2z', 'M9.5 4.5h4.5M9.5 7h4.5M9.5 9.5h4.5M9.5 12h4.5'],
  wrapRight: ['M8 3.5h6v9H8z', 'M2 4.5h4.5M2 7h4.5M2 9.5h4.5M2 12h4.5'],
  wrapTopBottom: ['M4 6.5h8v3H4z', 'M2 3h12M2 13h12'],
  shapeRect: ['M2 4h12v8H2z'],
  shapeRound: ['M4 4h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  shapeEllipse: ['M8 12.5c3.6 0 6.5-2 6.5-4.5S11.6 3.5 8 3.5 1.5 5.5 1.5 8s2.9 4.5 6.5 4.5z'],
  toc: ['M2 3h6M2 6.5h5M2 10h6M2 13.5h4', 'M11 3h3M10 6.5h4M11 10h3M10 13.5h4'],
  tocLevels: ['M2.5 3.5h11M4.5 7h9M6.5 10.5h7M8.5 14h5'],
  wordCount: ['M2.5 2.5h11v11h-11z', 'M5 6h6M5 9h4'],
  ruler: ['M1.5 5.5h13v5h-13z', 'M4 5.5v2.2M6.5 5.5v3M9 5.5v2.2M11.5 5.5v3'],
  zoomIn: ['M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z', 'M11.2 11.2 14 14', 'M5.25 7.25h4M7.25 5.25v4'],
  zoomOut: ['M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z', 'M11.2 11.2 14 14', 'M5.25 7.25h4'],
  zoomReset: ['M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z', 'M11.2 11.2 14 14'],
  find: ['M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5z', 'M11.2 11.2 14 14'],
  replace: ['M2 4.5h6.5M2 4.5 4 2.5M2 4.5l2 2', 'M14 11.5H7.5M14 11.5l-2-2M14 11.5l-2 2'],
  margins: ['M1.75 1.75h12.5v12.5H1.75z', 'M4.5 1.75v12.5M11.5 1.75v12.5', 'M1.75 4.5h12.5M1.75 11.5h12.5'],
  orientation: ['M2.5 2h7v12h-7z', 'M11 6.5h3v6h-3z'],
  pageSize: ['M2.5 1.75h11v12.5h-11z', 'M5 5h6M5 8h6M5 11h4'],
  columns: ['M2 2.5h4.5v11H2zM9.5 2.5H14v11H9.5z'],
  image: ['M2 3.25h12v9.5H2z', 'M2 10.5 5.75 7l3 2.75L11 7.5l3 3', 'M10.6 6.4a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z'],
  textBox: ['M1.75 4h12.5v8H1.75z', 'M5 6.5h6M5 9h4'],
  link: ['M6.6 9.4 9.4 6.6', 'M7.4 4.4 9 2.8a2.7 2.7 0 0 1 3.8 3.8l-1.6 1.6', 'M8.6 11.6 7 13.2a2.7 2.7 0 0 1-3.8-3.8l1.6-1.6'],
  bookmark: ['M4 2.25h8v11.5L8 10.5l-4 3.25z'],
  crossRef: ['M2.5 3.5h6M2.5 6.5h4M2.5 9.5h5', 'M8.5 12.5h5M11 10l2.5 2.5L11 15'],
  header: ['M2 2.5h12v3H2z', 'M2 8h12M2 11h8'],
  footer: ['M2 10.5h12v3H2z', 'M2 5h12M2 8h8'],
  pageNumber: ['M3.25 1.75h9.5v12.5h-9.5z', 'M6.75 10.5h2.5', 'M8 5.5v5'],
  formula: ['M9 3.5h4', 'M9.5 8h3', 'M2.5 13.5c1.6 0 2-.9 2.4-2.4L7.2 3.4C7.5 2.3 8 2 8.8 2', 'M2.5 6.5h4'],
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
