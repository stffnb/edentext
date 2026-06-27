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
import { Link } from './extensions/link';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FontWeight } from './extensions/fontWeight';
import { FontColor } from './extensions/fontColor';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import { OrderedList } from './extensions/orderedList';
import ListItem from '@tiptap/extension-list-item';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from './extensions/tableRow';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { PageBreaks } from './extensions/pageBreaks';
import { LineHeight } from './extensions/lineHeight';
import { ParagraphSpacing } from './extensions/paragraphSpacing';
import { PageBreak } from './extensions/pageBreak';
import { Indent } from './extensions/indent';
import { FormattingMarks } from './extensions/formattingMarks';
import { SpellCheck } from './extensions/spellCheck';
import { SearchReplace } from './extensions/searchReplace';
import { TableView } from './extensions/tableView';
import { TableColumnResize } from './extensions/tableColumnResize';
import { TableRowResize } from './extensions/tableRowResize';
import { TrailingNode } from './extensions/trailingNode';
import { Image } from './extensions/image';

export const extensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Strike,
  Link,
  Subscript,
  Superscript,
  TextStyle,
  FontFamily,
  FontSize,
  FontWeight,
  FontColor,
  // multicolor stores the chosen color on the `highlight` mark's `color` attr;
  // odf-kit exports that natively to fo:background-color. See export/odt.ts
  // applyRuns for the custom-attr-paragraph export path.
  Highlight.configure({ multicolor: true }),
  // Shift+Enter line breaks; round-trips to ODF <text:line-break/> (export/odt.ts
  // replaceHardBreaks, import/odt.ts).
  HardBreak,
  // Inline, as-character image; round-trips to ODF <draw:frame>/<draw:image>
  // (export/odt.ts replaceImages/applyImages, import/odt.ts).
  Image,
  LineHeight,
  ParagraphSpacing,
  PageBreak,
  Indent,
  Heading.configure({ levels: [1, 2, 3] }),
  BulletList,
  OrderedList,
  ListItem,
  // resizable:false keeps TipTap's columnResizing plugin off; TableView, the two
  // resize plugins, and ResizableTableRow supply Word-style drag instead. Table
  // (unlike TableKit) doesn't auto-add children, so ResizableTableRow is listed here.
  Table.configure({ resizable: false, View: TableView }),
  ResizableTableRow,
  TableHeader,
  TableCell,
  TableColumnResize,
  TableRowResize,
  // Guarantees a paragraph after a trailing table so the cursor isn't trapped
  // and the user can keep writing below a table at the document's end.
  TrailingNode,
  History,
  Placeholder.configure({ placeholder: 'Start typing…' }),
  TextAlign.configure({
    types: ['paragraph', 'heading'],
    alignments: ['left', 'center', 'right', 'justify'],
    defaultAlignment: 'left',
  }),
  PageBreaks,
  FormattingMarks,
  SpellCheck,
  SearchReplace,
];
