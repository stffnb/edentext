import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import { TextEffects, UnderlineStyled, StrikeStyled } from './extensions/textEffects';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import { Link } from './extensions/link';
import { Bookmark } from './extensions/bookmark';
import { Comment } from './extensions/comment';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FontWeight } from './extensions/fontWeight';
import { FontColor } from './extensions/fontColor';
import HardBreak from '@tiptap/extension-hard-break';
import Heading, { type Level } from '@tiptap/extension-heading';
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
import { TextDirection } from './extensions/textDirection';
import { Indent } from './extensions/indent';
import { TabStops } from './extensions/tabStops';
import { FormattingMarks } from './extensions/formattingMarks';
import { SpellCheck } from './extensions/spellCheck';
import { SearchReplace } from './extensions/searchReplace';
import { TableView } from './extensions/tableView';
import { TableColumnResize } from './extensions/tableColumnResize';
import { TableRowResize } from './extensions/tableRowResize';
import { TableSplit } from './extensions/tableSplit';
import { TableFormula } from './extensions/tableFormula';
import { TableSort } from './extensions/tableSort';
import { TableCellBackground } from './extensions/tableCellBackground';
import { TableCellAlign } from './extensions/tableCellAlign';
import { TableCellBorders } from './extensions/tableCellBorders';
import { TableCellPadding } from './extensions/tableCellPadding';
import { TableHeaderRow } from './extensions/tableHeaderRow';
import { TableStyle } from './extensions/tableStyle';
import { TrailingNode } from './extensions/trailingNode';
import { Image } from './extensions/image';
import { DateTimeField } from './extensions/dateTimeField';
import { SequenceField } from './extensions/caption';
import { IndexEntry } from './extensions/indexEntry';
import { BibliographyEntry } from './extensions/bibliographyEntry';
import { CrossReference } from './extensions/crossReference';
import { Ruby } from './extensions/ruby';
import { Formula } from './extensions/formula';
import { TextBox } from './extensions/textBox';
import { Columns } from './extensions/columns';
import { ColumnsFlow } from './extensions/columnsFlow';
import { TableOfContents } from './extensions/tableOfContents';
import { Outline } from './extensions/outline';
import { Note, NoteRef, NoteSection, Notes } from './extensions/notes';
import { Shortcuts } from './extensions/shortcuts';
import { AutoCorrect } from './extensions/autoCorrect';
import { WordCompletion } from './extensions/wordCompletion';
import { AutoText } from './extensions/autoText';
import { HEADING_LEVELS, MAX_HEADING_LEVEL } from '../export/odt';
import { styleSheet } from '../styles/sheet.svelte';
import { noteSettings } from '../storage/notes.svelte';
import { recordChanges } from '../storage/trackChanges.svelte';
import { loadDocProperties } from '../storage/docProperties';
import { Insertion, Deletion, TrackChanges } from './extensions/trackChanges';

export const extensions = [
  // textBox and columns have their own groups so only the document (not
  // cells/lists/boxes) admits them; the note section is last or nowhere.
  // Spelled as an alternation, not `… + noteSection?`: with the trailing optional the
  // match state after the first block offers noteSection first, and that is the type
  // TipTap's clearNodes converts a block into (`contentMatchAt(i).defaultType`).
  Document.extend({
    content: '((block | textBox | columns)+ noteSection) | (block | textBox | columns)+',
  }),
  Paragraph,
  Text,
  Bold,
  Italic,
  UnderlineStyled,
  StrikeStyled,
  Link,
  // Named range of text, the target of a cross-reference or an internal link;
  // round-trips to ODF text:bookmark-start/-end and DOCX w:bookmarkStart/End.
  Bookmark,
  // An annotation on a range of text; round-trips to ODF office:annotation and DOCX
  // w:commentRangeStart/-End + word/comments.xml.
  Comment,
  Subscript,
  Superscript,
  TextStyle,
  FontFamily,
  FontSize,
  FontWeight,
  FontColor,
  // Letter case, raised/lowered runs and the line styles of underline/strikethrough.
  TextEffects,
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
  // A caption's running number, one counter per category in document order. Round-trips
  // to an ODF <text:sequence> and a DOCX SEQ field.
  SequenceField,
  // A place marked for the alphabetical index. Round-trips to ODF
  // <text:alphabetical-index-mark> and a Word XE field.
  IndexEntry,
  // A citation carrying its whole source record. Round-trips to ODF
  // <text:bibliography-mark> and a Word CITATION field over a custom-XML source.
  BibliographyEntry,
  // Inline reference to a bookmark, showing its text or its page; kept live by its
  // node view. Round-trips to ODF <text:bookmark-ref> and DOCX REF/PAGEREF fields.
  CrossReference,
  // A reading printed over its base text; round-trips to ODF <text:ruby> and DOCX w:ruby.
  Ruby,
  // Mathematical formula; stores LaTeX, renders native MathML, round-trips to an ODF
  // embedded formula object and DOCX OMML. See docs/architecture/formulas.md.
  Formula,
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
  // The document's chapters for the Navigator pane, plus LibreOffice's move and
  // promote/demote of a whole chapter.
  Outline.configure({ maxLevel: MAX_HEADING_LEVEL }),
  // Footnotes and endnotes: the anchor rides the text, the note text lives in the one
  // noteSection at the document end. pageBreaks.ts lifts a footnote to the foot of its
  // anchor's page. Round-trips to ODF <text:note> and DOCX word/footnotes.xml.
  NoteRef,
  Note,
  NoteSection,
  Notes.configure({ settings: () => noteSettings() }),
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
  // Per-block base direction, overriding the page's (storage/writingMode.ts).
  TextDirection,
  Indent,
  TabStops,
  Heading.configure({ levels: HEADING_LEVELS as Level[] }),
  BulletList,
  OrderedList,
  ListItem,
  // Bullet/number formatting: it follows the item's first text portion, as in
  // LibreOffice (the sheet resolves a character style on that portion).
  ListMarker.configure({ sheet: styleSheet }),
  // resizable:false keeps TipTap's columnResizing plugin off; TableView, the two
  // resize plugins, and ResizableTableRow supply the drag handling instead. Table
  // (unlike TableKit) doesn't auto-add children, so ResizableTableRow is listed here.
  Table.configure({ resizable: false, View: TableView }),
  ResizableTableRow,
  TableHeader,
  TableCell,
  TableColumnResize,
  TableRowResize,
  // "Split Cells…" (N×M); merge uses extension-table's built-in mergeCells.
  TableSplit,
  TableFormula,
  TableSort,
  // Cell shading: backgroundColor attr on tableCell/tableHeader (→ fo:background-color).
  TableCellBackground,
  // Cell content set against the middle/bottom of its box (→ style:vertical-align).
  TableCellAlign,
  // Border presets: per-side border attrs on cells (→ fo:border-*).
  TableCellBorders,
  // The table's cell margins (→ w:tblCellMar / fo:padding on the cell style).
  TableCellPadding,
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
  // Last of the typing extensions: its handleTextInput runs after every input rule.
  // Recorded revisions: an insertion is marked text, a deletion is text kept and
  // marked. Round-trips to ODF <text:tracked-changes> and DOCX w:ins/w:del.
  Insertion,
  Deletion,
  TrackChanges.configure({ recording: recordChanges, author: () => loadDocProperties().author.trim() }),
  AutoCorrect,
  WordCompletion,
  // Named blocks of text kept beside the documents; F3 expands a typed shortcut.
  AutoText,
  SearchReplace.configure({ sheet: styleSheet }),
  // Word/LibreOffice key bindings that aren't TipTap defaults; body:true adds the
  // ones the header/footer schema has no commands for (headings, line spacing, fields).
  Shortcuts.configure({ body: true }),
];
