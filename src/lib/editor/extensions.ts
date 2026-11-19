import type { CommandProps } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import { TextEffects, UnderlineStyled, StrikeStyled } from './extensions/textEffects';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import { Link } from './extensions/link';
import { Bookmark } from './extensions/bookmark';
import { Comment } from './extensions/comment';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';

import { FontFamily } from './extensions/fontFamily';
import { FontWeight } from './extensions/fontWeight';
import { FontColor } from './extensions/fontColor';
import HardBreak from '@tiptap/extension-hard-break';
import Heading, { type Level } from '@tiptap/extension-heading';
import { BulletList } from './extensions/bulletList';
import { OrderedList } from './extensions/orderedList';
import ListItem from '@tiptap/extension-list-item';
import { ListMarker } from './extensions/listMarker';
import { ListStyle, sinkListItemWithin, splitListAt } from './extensions/listStyle';
import { Table, TableHeader, TableCell, createTable } from '@tiptap/extension-table';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore } from '@tiptap/pm/tables';
import { ResizableTableRow } from './extensions/tableRow';
import { inheritingInsert } from './extensions/tableInsert';
import History from '@tiptap/extension-history';
import { StateHistory } from './extensions/stateHistory';
import { inNote } from './extensions/notes';
import { Placeholder } from './extensions/placeholder';
import { t } from '../i18n/i18n.svelte';

import { PageBreaks } from './extensions/pageBreaks';
import { LineHeight } from './extensions/lineHeight';
import { ParagraphSpacing } from './extensions/paragraphSpacing';
import { ParagraphBox } from './extensions/paragraphBox';
import { BlockFontSize } from './extensions/blockFontSize';
import { ParagraphStyle } from './extensions/paragraphStyle';
import { CharacterStyle } from './extensions/characterStyle';
import { PageBreak, ZoneSplit } from './extensions/pageBreak';
import { TextDirection } from './extensions/textDirection';
import { Language } from './extensions/language';
import { Indent } from './extensions/indent';
import { TabStops } from './extensions/tabStops';
import { FormattingMarks } from './extensions/formattingMarks';
import { SpellCheck } from './extensions/spellCheck';
import { GrammarCheck } from './extensions/grammarCheck';
import { SearchReplace } from './extensions/searchReplace';
import { TableView, selectionTableRtl, tableArrow } from './extensions/tableView';
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
import { PlaceholderField } from './extensions/placeholderField';
import { SequenceField } from './extensions/caption';
import { IndexEntry } from './extensions/indexEntry';
import { BibliographyEntry } from './extensions/bibliographyEntry';
import { CrossReference } from './extensions/crossReference';
import { Ruby } from './extensions/ruby';
import { Formula } from './extensions/formula';
import { TextBox, TextAlignInFrames } from './extensions/textBox';
import { Columns } from './extensions/columns';
import { ColumnsFlow } from './extensions/columnsFlow';
import { TableOfContents } from './extensions/tableOfContents';
import { Outline } from './extensions/outline';
import { Note, NoteRef, NoteSection, Notes } from './extensions/notes';
import { Shortcuts } from './extensions/shortcuts';
import { PageNumber, PageCount, ChapterField } from './extensions/pageField';
import { AutoCorrect } from './extensions/autoCorrect';
import { WordCompletion } from './extensions/wordCompletion';
import { Dictation } from './extensions/dictation';
import { AutoText } from './extensions/autoText';
import { HEADING_LEVELS, MAX_HEADING_LEVEL } from '../styles/headings';
import { setOutline, styleSheet } from '../styles/sheet.svelte';
import { noteSettings } from '../storage/notes.svelte';
import { recordChanges, recordLock } from '../storage/trackChanges.svelte';
import { markupView } from '../storage/markup.svelte';
import { userName } from '../storage/userName.svelte';
import { Insertion, Deletion, FormatChange, REBUILDING, TrackChanges } from './extensions/trackChanges';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSides: {
      addColumnLeft: () => ReturnType;
      addColumnRight: () => ReturnType;
    };
  }
}

const pxToPt = (size: string): string | null => {
  const px = /^([\d.]+)px$/.exec(size)?.[1];
  return px ? `${Math.round(Number(px) * 0.75 * 10) / 10}pt` : size || null;
};

// A selection running over cells: dropped, its open rows would split the table it lands in.
function cutsCells(slice: Slice): boolean {
  const open = (node: PMNode | null | undefined, depth: number, next: (n: PMNode) => PMNode | null): boolean =>
    depth > 0 && !!node && (!!node.type.spec.tableRole || open(next(node), depth - 1, next));
  return open(slice.content.firstChild, slice.openStart, (n) => n.firstChild) || open(slice.content.lastChild, slice.openEnd, (n) => n.lastChild);
}

const CELL_CONTENT = '(paragraph | heading | bulletList | orderedList | table)+';
// An item opening with a sub-list is ODF's item without a paragraph of its own: no label,
// no count — what a list continued past a table opens with below its first level.
const LIST_ITEM_CONTENT = '(paragraph | heading | bulletList | orderedList) (paragraph | heading | bulletList | orderedList)*';

export const extensions = [
  // columns has its own group so only the document (not cells/lists) admits it; the
  // note section is last or nowhere. A text box is inline and rides a paragraph.
  // Spelled as an alternation, not `… + noteSection?`: with the trailing optional the
  // match state after the first block offers noteSection first, and that is the type
  // TipTap's clearNodes converts a block into (`contentMatchAt(i).defaultType`).
  Document.extend({
    content: '((block | columns)+ noteSection) | (block | columns)+',
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
  // Neither format can raise and lower the same run, and the file keeps whichever it
  // writes last — so each drops the other instead of stacking with it.
  Subscript.extend({ excludes: 'subscript superscript' }),
  Superscript.extend({ excludes: 'subscript superscript' }),
  TextStyle,
  FontFamily,
  // The browser's own editing and a web page's paste style a size in px; the model, the
  // size box and both formats count in pt.
  FontSize.extend({
    addGlobalAttributes() {
      return (this.parent?.() ?? []).map((g) => ({ ...g, attributes: { fontSize: { ...g.attributes.fontSize,
        parseHTML: (el: HTMLElement) => pxToPt(el.style.fontSize) } } }));
    },
  }),
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
  // A template placeholder the user clicks and types over; round-trips to ODF
  // <text:placeholder> and a tagged DOCX content control.
  PlaceholderField,
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
  // Inline text box / basic shape with editable block content; round-trips to ODF
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
  Language,
  Indent,
  TabStops,
  // Its own Mod-Alt-N is dropped: a keymap plugin runs ahead of every plugin from
  // addProseMirrorPlugins, so it would beat the code-based binding in shortcuts.ts
  // and set the level without the heading's named style.
  Heading.extend({ addKeyboardShortcuts: () => ({}) }).configure({ levels: HEADING_LEVELS as Level[] }),
  BulletList,
  OrderedList.configure({ headingNumbering: { get: () => styleSheet().outline, set: setOutline } }),
  // The tail is narrower than `block*`: neither file keeps a table (or a table of
  // contents) in a list item, and a list toggle over one would wrap it in silently.
  // Indenting stops at the ninth level, as at any other limit: deeper has no .docx form.
  ListItem.extend({ content: LIST_ITEM_CONTENT, addCommands: () => ({ sinkListItem: sinkListItemWithin }) }),
  // Bullet/number formatting: it follows the item's first text portion, as in
  // LibreOffice (the sheet resolves a character style on that portion).
  ListMarker.configure({ sheet: styleSheet }),
  // Named list style on the outermost list (LibreOffice Listenformatvorlage / Word
  // numbering style); also owns the effective-marker walk both list types render by.
  ListStyle.configure({ sheet: styleSheet }),
  // resizable:false keeps TipTap's columnResizing plugin off; TableView, the two
  // resize plugins, and ResizableTableRow supply the drag handling instead. Table
  // (unlike TableKit) doesn't auto-add children, so ResizableTableRow is listed here.
  // No table in a note (whose inline content would take it wrapped in a text box); a cell
  // and a columns section may hold one. In a list it goes between the list's two parts, as in both word
  // processors: neither format keeps one in a list item, and the second part counts on.
  Table.extend({
    addProseMirrorPlugins() {
      return [...(this.parent?.() ?? []), new Plugin({ props: { handleDrop: (_view, _event, slice) => cutsCells(slice) } })];
    },
    addKeyboardShortcuts() {
      return {
        ...this.parent?.(),
        ArrowLeft: ({ editor }) => tableArrow(editor.view, 'left', false),
        ArrowRight: ({ editor }) => tableArrow(editor.view, 'right', false),
        'Shift-ArrowLeft': ({ editor }) => tableArrow(editor.view, 'left', true),
        'Shift-ArrowRight': ({ editor }) => tableArrow(editor.view, 'right', true),
      };
    },
    addCommands() {
      const parent = this.parent?.() ?? {};
      // A split cell regroups a table as a merge does; neither has a form for a change.
      const rebuilding = (command: keyof typeof parent) => () => (props: CommandProps) => {
        props.tr.setMeta(REBUILDING, true);
        return (parent[command] as () => (p: CommandProps) => boolean)()(props);
      };
      return { ...parent, mergeCells: rebuilding('mergeCells'), splitCell: rebuilding('splitCell'), mergeOrSplit: rebuilding('mergeOrSplit'), insertTable: (options) => (props) => {
        if (inNote(props.state)) return false;
        const { $from } = props.state.selection;
        let item = 0;
        for (let d = $from.depth; d > 0 && !item; d--) if ($from.node(d).type.name === 'listItem') item = d;
        if (!item) {
          if (!parent.insertTable?.(options)(props)) return false;
          // A table ending a columns section keeps a paragraph after it: the caret would
          // have nowhere to go there, as at the document end (trailingNode.ts).
          const { $from: $in } = props.tr.selection;
          for (let d = $in.depth; d > 1; d--) {
            if ($in.node(d).type.name !== 'table' || $in.node(d - 1).type.name !== 'columns') continue;
            if ($in.index(d - 1) === $in.node(d - 1).childCount - 1) props.tr.insert($in.after(d), props.state.schema.nodes.paragraph.create());
            break;
          }
          return true;
        }
        const { tr, state } = props;
        const at = splitListAt(tr, $from, item);
        if (at == null) return false;
        tr.insert(at, createTable(state.schema, options?.rows ?? 3, options?.cols ?? 3, options?.withHeaderRow ?? true));
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))).scrollIntoView();
        return true;
      },
      addRowBefore: () => ({ state, dispatch }) => inheritingInsert(addRowBefore, 'row', 'before')(state, dispatch),
      addRowAfter: () => ({ state, dispatch }) => inheritingInsert(addRowAfter, 'row', 'after')(state, dispatch),
      addColumnBefore: () => ({ state, dispatch }) => inheritingInsert(addColumnBefore, 'column', 'before')(state, dispatch),
      addColumnAfter: () => ({ state, dispatch }) => inheritingInsert(addColumnAfter, 'column', 'after')(state, dispatch),
      // A side the reader sees: a right-to-left table's columns run mirrored.
      addColumnLeft: () => ({ state, view, commands }) => (selectionTableRtl(view, state.selection.from) ? commands.addColumnAfter() : commands.addColumnBefore()),
      addColumnRight: () => ({ state, view, commands }) => (selectionTableRtl(view, state.selection.from) ? commands.addColumnBefore() : commands.addColumnAfter()) };
    },
  }).configure({ resizable: false, View: TableView }),
  ResizableTableRow,
  // A cell holds what both exporters can write into one, a nested table included.
  TableHeader.extend({ content: CELL_CONTENT }),
  TableCell.extend({ content: CELL_CONTENT }),
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
  StateHistory,
  Placeholder.configure({ placeholder: () => t().app.startTyping }),
  // No defaultAlignment: it would put textAlign:'left' on every block, and that inline
  // style beats the paragraph style's alignment. Unset = follow the style; an explicit
  // 'left' stays direct formatting that overrides it, as in Word/LibreOffice.
  // Taught that a selected box means the block it sits in (textBox.ts).
  TextAlignInFrames.configure({
    types: ['paragraph', 'heading'],
    alignments: ['left', 'center', 'right', 'justify'],
  }),
  PageBreaks,
  FormattingMarks,
  SpellCheck,
  GrammarCheck,
  // Last of the typing extensions: its handleTextInput runs after every input rule.
  // Recorded revisions: an insertion is marked text, a deletion is text kept and
  // marked. Round-trips to ODF <text:tracked-changes> and DOCX w:ins/w:del.
  Insertion,
  Deletion,
  FormatChange,
  TrackChanges.configure({
    recording: recordChanges,
    author: userName,
    plain: () => markupView().plainRevisions,
    locked: () => !!recordLock(),
  }),
  AutoCorrect,
  WordCompletion,
  // Named blocks of text kept beside the documents; F3 expands a typed shortcut.
  AutoText,
  // Spoken words at the caret, from the dictation session (docs/architecture/dictation.md).
  Dictation,
  SearchReplace.configure({ sheet: styleSheet }),
  // Word/LibreOffice key bindings that aren't TipTap defaults.
  Shortcuts,
];

// What a header or footer has no use for: the page flow, notes, generated indexes,
// comments, and the typing aids that watch the body.
const BODY_ONLY = new Set([
  'doc', 'placeholder', 'noteRef', 'note', 'noteSection', 'notes', 'pageBreak', 'pageBreaks',
  'columns', 'columnsFlow', 'tableOfContents', 'outline', 'comment', 'searchReplace', 'autoText', 'wordCompletion', 'autoCorrect', 'spellCheck', 'grammarCheck',
  // A zone's live editor undoes on the body's stack (stateHistory.ts).
  'undoRedo', 'stateHistory',
]);

// A header or footer is a text area like the body, with the page fields on top.
// Only a zone being edited records: the others show a stored zone, never an edit of it.
export function zoneExtensions(placeholder = '', live = false) {
  return [
    Document.extend({ content: 'block+' }),
    ...extensions.filter((e) => !BODY_ONLY.has(e.name)).map((e) => (e.name === 'trackChanges' && !live ? (e as typeof TrackChanges).configure({ recording: () => false }) : e)),
    ZoneSplit,
    PageNumber,
    PageCount,
    // The running head's chapter name, resolved per page by HeaderFooterLayer.
    ChapterField,
    Placeholder.configure({ placeholder }),
  ];
}
