import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { FontWeight } from './fontWeight';
import { FontColor } from './fontColor';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { PageBreaks } from './pageBreaks';
import { LineHeight } from './lineHeight';
import { ParagraphSpacing } from './paragraphSpacing';
import { FormattingMarks } from './formattingMarks';

export const extensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
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
