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
import { BulletList } from './extensions/bulletList';
import { OrderedList } from './extensions/orderedList';
import ListItem from '@tiptap/extension-list-item';
import { ListMarker } from './extensions/listMarker';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from './extensions/tableRow';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { PageBreaks } from './extensions/pageBreaks';
import { LineHeight } from './extensions/lineHeight';
import { ParagraphSpacing } from './extensions/paragraphSpacing';
import { ParagraphBox } from './extensions/paragraphBox';
import { BlockFontSize } from './extensions/blockFontSize';
import { ParagraphStyle } from './extensions/paragraphStyle';
import { CharacterStyle } from './extensions/characterStyle';
import { PageBreak } from './extensions/pageBreak';
import { Indent } from './extensions/indent';
import { TabStops } from './extensions/tabStops';
import { FormattingMarks } from './extensions/formattingMarks';
import { SpellCheck } from './extensions/spellCheck';
import { SearchReplace } from './extensions/searchReplace';
import { TableView } from './extensions/tableView';
import { TableColumnResize } from './extensions/tableColumnResize';
import { TableRowResize } from './extensions/tableRowResize';
import { TableSplit } from './extensions/tableSplit';
import { TableCellBackground } from './extensions/tableCellBackground';
import { TableCellBorders } from './extensions/tableCellBorders';
import { TableHeaderRow } from './extensions/tableHeaderRow';
import { TableStyle } from './extensions/tableStyle';
import { TrailingNode } from './extensions/trailingNode';
import { Image } from './extensions/image';
import { DateTimeField } from './extensions/dateTimeField';
import { TextBox } from './extensions/textBox';
import { Columns } from './extensions/columns';
import { ColumnsFlow } from './extensions/columnsFlow';
import { TableOfContents } from './extensions/tableOfContents';
import { Shortcuts } from './extensions/shortcuts';
import { styleSheet } from '../styles/sheet.svelte';

export const extensions = [
  // textBox and columns have their own groups so only the document (not
  // cells/lists/boxes) admits them.
  Document.extend({ content: '(block | textBox | columns)+' }),
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
  // Inline date/time field (fixed or auto-updating); round-trips to ODF
  // <text:date>/<text:time> and DOCX DATE/TIME fields.
  DateTimeField,
  // Block-level text box / basic shape with editable content; round-trips to ODF
  // draw:frame/draw:text-box + draw:custom-shape and DOCX wps:wsp/wps:txbx.
  TextBox,
  // Multi-column (newspaper) section; round-trips to ODF <text:section> +
  // style:columns and DOCX continuous sections with w:cols. ColumnsFlow splits a
  // section into per-page fragments so the text flows across page breaks.
  Columns,
  ColumnsFlow,
  // Generated table of contents from headings; round-trips to ODF
  // <text:table-of-content> (export/odt.ts, import/odt.ts) and a DOCX TOC field.
  TableOfContents,
  LineHeight,
  ParagraphSpacing,
  // Paragraph background ("colored field") + borders ("colored rule line"); round-trips
  // to ODF fo:background-color/fo:border-* and DOCX w:shd/w:pBdr.
  ParagraphBox,
  // Paragraph-mark font size: sizes empty lines (and text typed into them).
  BlockFontSize,
  // Named paragraph style (LibreOffice style:style / Word w:pStyle); the document
  // stylesheet in Editor.svelte renders it, direct formatting still wins.
  ParagraphStyle.configure({ sheet: styleSheet }),
  // Named character style on a run (LibreOffice style:family="text" / Word w:rStyle).
  CharacterStyle,
  PageBreak,
  Indent,
  TabStops,
  Heading.configure({ levels: [1, 2, 3, 4, 5] }),
  BulletList,
  OrderedList,
  ListItem,
  // Bullet/number formatting: it follows the item's first text portion, as in
  // LibreOffice (the sheet resolves a character style on that portion).
  ListMarker.configure({ sheet: styleSheet }),
  // resizable:false keeps TipTap's columnResizing plugin off; TableView, the two
  // resize plugins, and ResizableTableRow supply Word-style drag instead. Table
  // (unlike TableKit) doesn't auto-add children, so ResizableTableRow is listed here.
  Table.configure({ resizable: false, View: TableView }),
  ResizableTableRow,
  TableHeader,
  TableCell,
  TableColumnResize,
  TableRowResize,
  // "Split Cells…" (N×M); merge uses extension-table's built-in mergeCells.
  TableSplit,
  // Cell shading: backgroundColor attr on tableCell/tableHeader (→ fo:background-color).
  TableCellBackground,
  // Border presets: per-side border attrs on cells (→ fo:border-*).
  TableCellBorders,
  // "Header row" styling preset: bold + light shading on the first row (toggle).
  TableHeaderRow,
  // Named table style (Word table style / LibreOffice AutoFormat): paints the table's
  // conditional regions into cell attrs and re-bands on structural changes.
  TableStyle.configure({ styles: () => styleSheet().table }),
  // Guarantees a paragraph after a trailing table so the cursor isn't trapped
  // and the user can keep writing below a table at the document's end.
  TrailingNode,
  History,
  Placeholder.configure({ placeholder: 'Start typing…' }),
  // No defaultAlignment: it would put textAlign:'left' on every block, and that inline
  // style beats the paragraph style's alignment. Unset = follow the style; an explicit
  // 'left' stays direct formatting that overrides it, as in Word/LibreOffice.
  TextAlign.configure({
    types: ['paragraph', 'heading'],
    alignments: ['left', 'center', 'right', 'justify'],
  }),
  PageBreaks,
  FormattingMarks,
  SpellCheck,
  SearchReplace,
  // Word/LibreOffice key bindings that aren't TipTap defaults; body:true adds the
  // ones the header/footer schema has no commands for (headings, line spacing, fields).
  Shortcuts.configure({ body: true }),
];
