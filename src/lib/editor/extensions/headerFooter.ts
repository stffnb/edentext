import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import { TextEffects, UnderlineStyled, StrikeStyled } from './textEffects';
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
import { ParagraphBox } from './paragraphBox';
import { CharacterStyle } from './characterStyle';
import { PageNumber, PageCount, ChapterField } from './pageField';
import { Image } from './image';
import { Shortcuts } from './shortcuts';
import { TabStops } from './tabStops';
import { ParagraphSpacing } from './paragraphSpacing';
import { BlockFontSize } from './blockFontSize';

// Schema for the header/footer mini editors: exactly one paragraph of formatted
// runs, line breaks, page fields, and inline (as-character) images. Marks mirror
// the main editor's; the ODT export emits images via a draw:frame post-process.

const HfDocument = Document.extend({ content: 'paragraph' });

// The single-paragraph schema can't split, so plain Enter inserts a line break instead
// (Enter in a footer adds a blank line, growing the zone into the page). Shift-/
// Mod-Enter keep their default break binding.
const HfHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: () => this.editor.commands.setHardBreak(),
    };
  },
});

export function hfExtensions(placeholder = '') {
  return [
    HfDocument,
    Paragraph,
    Text,
    Bold,
    Italic,
    UnderlineStyled,
    StrikeStyled,
    Subscript,
    Superscript,
    TextStyle,
    FontFamily,
    FontSize,
    FontWeight,
    FontColor,
    // Letter case, raised/lowered runs and the line styles of underline/strikethrough.
    TextEffects,
    // Paragraph background ("colored field") + rule line, common in letterhead headers.
    ParagraphBox,
    // The centre/right stops a header's left\tcentre\tright layout rides on.
    TabStops.configure({ types: ['paragraph'] }),
    // The zone style's own margins: what the band has to be tall enough for
    // (Editor.svelte's hfReachPx), not a gap the bottom-anchored footer moves by.
    ParagraphSpacing.configure({ types: ['paragraph'] }),
    // The zone is one paragraph, so its mark's font is the band's line height: a 10pt
    // footer reserves 10pt lines, not the body's 12pt.
    BlockFontSize.configure({ types: ['paragraph'] }),
    CharacterStyle,
    Highlight.configure({ multicolor: true }),
    HfHardBreak,
    // Inline (as-character) images only — the single-paragraph zone has no text flow
    // for floating/wrapped frames; imports and inserts force wrap:'inline'.
    Image,
    PageNumber,
    PageCount,
    // The running head's chapter name, resolved per page by HeaderFooterLayer.
    ChapterField,
    History,
    Placeholder.configure({ placeholder }),
    TextAlign.configure({
      types: ['paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    }),
    // Only the shared bindings: this schema has no headings, line spacing or fields.
    Shortcuts,
  ];
}
