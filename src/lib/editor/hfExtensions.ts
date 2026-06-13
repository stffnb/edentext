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
import HardBreak from '@tiptap/extension-hard-break';
import History from '@tiptap/extension-history';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { FontWeight } from './fontWeight';
import { FontColor } from './fontColor';
import { PageNumber, PageCount } from './pageField';

// Schema for the header/footer mini editors: exactly one paragraph of formatted
// runs, line breaks, and page fields — what odf-kit's HeaderFooterBuilder (and
// thus the ODT export) can express. Marks mirror the main editor's.

const HfDocument = Document.extend({ content: 'paragraph' });

export function hfExtensions(placeholder = '') {
  return [
    HfDocument,
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
    Highlight.configure({ multicolor: true }),
    HardBreak,
    PageNumber,
    PageCount,
    History,
    Placeholder.configure({ placeholder }),
    TextAlign.configure({
      types: ['paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
  ];
}
