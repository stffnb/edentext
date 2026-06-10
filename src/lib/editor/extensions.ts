import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FontWeight } from './fontWeight';
import { FontColor } from './fontColor';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from './tableRow';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { PageBreaks } from './pageBreaks';
import { LineHeight } from './lineHeight';
import { ParagraphSpacing } from './paragraphSpacing';
import { FormattingMarks } from './formattingMarks';
import { TableView } from './tableView';
import { TableColumnResize } from './tableColumnResize';
import { TableRowResize } from './tableRowResize';

export const extensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Strike,
  Subscript,
  Superscript,
  TextStyle,
  FontFamily,
  FontSize,
  FontWeight,
  FontColor,
  // multicolor stores the chosen color on the `highlight` mark's `color` attr;
  // odf-kit exports that natively to fo:background-color (round-trips with
  // LibreOffice and Word). See src/lib/export/odt.ts applyRuns for the
  // custom-attr-paragraph export path.
  Highlight.configure({ multicolor: true }),
  LineHeight,
  ParagraphSpacing,
  Heading.configure({ levels: [1, 2, 3] }),
  BulletList,
  OrderedList,
  ListItem,
  // Columns and rows are flexible and drag-resizable (Word-style). We keep TipTap's
  // own resizable:false (so its columnResizing plugin isn't loaded) and instead supply
  // a custom node view that renders the <colgroup> with *percentage* widths from the
  // `colwidth` cell attrs — so the table is always full text width and stays in sync
  // with the ODT export (export/odt.ts emits per-column widths summing to the text
  // width). TableColumnResize adds the Word-style column drag handles; ResizableTableRow
  // carries a per-row `rowHeight` attr and TableRowResize adds the row drag handles
  // (exported as style:min-row-height). Table alone — unlike TableKit — does NOT
  // auto-add child extensions, so listing ResizableTableRow here is the only tableRow.
  Table.configure({ resizable: false, View: TableView }),
  ResizableTableRow,
  TableHeader,
  TableCell,
  TableColumnResize,
  TableRowResize,
  History,
  Placeholder.configure({ placeholder: 'Start typing…' }),
  TextAlign.configure({
    types: ['paragraph', 'heading'],
    alignments: ['left', 'center', 'right', 'justify'],
    defaultAlignment: 'left',
  }),
  PageBreaks,
  FormattingMarks,
];
